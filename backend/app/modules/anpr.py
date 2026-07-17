"""License plate recognition: YOLO plate detector + EasyOCR.

Instead of logging every OCR read, detections are grouped into per-vehicle
*visits* (tracks). Reads accumulate on the track — partial reads fold into
fuller ones ("ABC12" merges into "ABC123"), fuzzy-similar reads vote for the
same candidate — and exactly one event is emitted per visit, carrying the
best-supported reading, the detection zone and a small plate thumbnail.
A visit ends when the plate hasn't been seen for PLATE_TRACK_TTL_S (or the
vehicle stays long enough to be logged while still in view).

Optional detection zones (normalized rects with labels, set per session via
``configure``) restrict recognition to the areas the user drew; everything
outside is ignored and each event records the zone it happened in.
"""
import base64
import re
from difflib import SequenceMatcher

import cv2
import numpy as np
from ultralytics import YOLO

from .. import config
from .base import BaseModule, COLOR_NEUTRAL, COLOR_OK, draw_box

_PLATE_CLEAN = re.compile(r"[^A-Z0-9]")

# BGR colors cycled across zones for the frame overlay
_ZONE_COLORS = [(230, 160, 40), (60, 180, 230), (170, 90, 230), (80, 200, 120)]


def plate_similarity(a: str, b: str) -> float:
    """1.0 when one read is contained in the other (partial vs full plate),
    otherwise plain sequence similarity."""
    if not a or not b:
        return 0.0
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= config.PLATE_MIN_CHARS and shorter in longer:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


class PlateTrack:
    """One vehicle visit: accumulates OCR reads and picks the best one."""

    def __init__(self, zone: str | None, box: tuple, ts: float):
        self.zone = zone
        self.box = box
        self.first_seen = ts
        self.last_seen = ts
        self.total_reads = 0
        # candidate text -> {"count", "conf_sum", "best_conf", "thumb", "thumb_conf"}
        self.reads: dict[str, dict] = {}
        self.logged = False
        self.visit: dict | None = None  # stats record, set once logged

    def add_read(self, text: str, conf: float, thumb: str | None) -> None:
        self.total_reads += 1
        count, conf_sum = 1, conf
        best_thumb, best_thumb_conf = thumb, conf if thumb is not None else -1.0
        # fold existing partial candidates into this fuller read
        for partial in [t for t in self.reads if t != text and t in text]:
            rec = self.reads.pop(partial)
            count += rec["count"]
            conf_sum += rec["conf_sum"]
            if rec["thumb"] is not None and rec["thumb_conf"] > best_thumb_conf:
                best_thumb, best_thumb_conf = rec["thumb"], rec["thumb_conf"]
        # or, if this read is itself a fragment of a known candidate, credit that one
        target = next((t for t in self.reads if t != text and text in t), text)
        rec = self.reads.setdefault(
            target,
            {"count": 0, "conf_sum": 0.0, "best_conf": 0.0, "thumb": None, "thumb_conf": -1.0},
        )
        rec["count"] += count
        rec["conf_sum"] += conf_sum
        rec["best_conf"] = max(rec["best_conf"], conf)
        if best_thumb is not None and best_thumb_conf > rec["thumb_conf"]:
            rec["thumb"], rec["thumb_conf"] = best_thumb, best_thumb_conf

    def matches_text(self, text: str) -> float:
        return max((plate_similarity(text, t) for t in self.reads), default=0.0)

    def best(self) -> tuple[str, dict] | None:
        """Best-supported candidate: most accumulated confidence, longest wins ties."""
        if not self.reads:
            return None
        text = max(self.reads, key=lambda t: (self.reads[t]["conf_sum"], len(t)))
        return text, self.reads[text]


class ANPRModule(BaseModule):
    def __init__(self) -> None:
        self.model = YOLO(config.PLATE_MODEL)
        import easyocr  # heavy import, keep at module construction

        self.reader = easyocr.Reader(config.OCR_LANGS, gpu=False, verbose=False)
        self.zones: list[dict] = []
        self.tracks: list[PlateTrack] = []
        self.visits: list[dict] = []          # logged plates, oldest first
        self._recent_logged: dict[str, float] = {}  # plate -> last log/extend ts

    def configure(self, options: dict) -> None:
        zones = []
        for z in options.get("zones") or []:
            x = min(max(float(z.get("x", 0)), 0.0), 1.0)
            y = min(max(float(z.get("y", 0)), 0.0), 1.0)
            zones.append({
                "label": str(z.get("label") or f"Zone {len(zones) + 1}").strip(),
                "x": x, "y": y,
                "w": min(max(float(z.get("w", 0)), 0.0), 1.0 - x),
                "h": min(max(float(z.get("h", 0)), 0.0), 1.0 - y),
            })
        self.zones = [z for z in zones if z["w"] > 0.01 and z["h"] > 0.01]

    # ---------- OCR ----------

    def _read_plate(self, crop: np.ndarray) -> tuple[str | None, float]:
        if crop.shape[1] < config.PLATE_OCR_UPSCALE_W:
            crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        results = [r for r in self.reader.readtext(crop) if r[2] >= config.PLATE_OCR_MIN_CONF]
        if not results:
            return None, 0.0
        # join multi-line plates, keep the mean confidence
        text = "".join(r[1] for r in results)
        conf = float(np.mean([r[2] for r in results]))
        normalized = _PLATE_CLEAN.sub("", text.upper())
        if not config.PLATE_MIN_CHARS <= len(normalized) <= config.PLATE_MAX_CHARS:
            return None, conf
        return normalized, conf

    @staticmethod
    def _thumb(crop: np.ndarray) -> str | None:
        h, w = crop.shape[:2]
        if w > config.PLATE_THUMB_W:
            crop = cv2.resize(crop, (config.PLATE_THUMB_W, int(h * config.PLATE_THUMB_W / w)))
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf).decode()

    # ---------- zones ----------

    def _zone_for(self, cx: float, cy: float) -> str | None:
        """Zone label containing the point (normalized coords), or None."""
        for z in self.zones:
            if z["x"] <= cx <= z["x"] + z["w"] and z["y"] <= cy <= z["y"] + z["h"]:
                return z["label"]
        return None

    def _draw_zones(self, frame: np.ndarray) -> None:
        h, w = frame.shape[:2]
        for i, z in enumerate(self.zones):
            color = _ZONE_COLORS[i % len(_ZONE_COLORS)]
            x1, y1 = int(z["x"] * w), int(z["y"] * h)
            x2, y2 = int((z["x"] + z["w"]) * w), int((z["y"] + z["h"]) * h)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, z["label"], (x1 + 5, max(16, y1 + 18)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    # ---------- tracking ----------

    def _match_track(self, zone: str | None, box: tuple, text: str | None,
                     frame_w: int, used: set) -> PlateTrack | None:
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        limit = config.PLATE_TRACK_MAX_DIST * frame_w
        best, best_score = None, 0.0
        for tr in self.tracks:
            if id(tr) in used or tr.zone != zone:
                continue
            score = 0.0
            if text:
                sim = tr.matches_text(text)
                if sim >= config.PLATE_MATCH_RATIO:
                    score = 1.0 + sim  # text agreement beats any spatial match
                elif tr.reads:
                    continue  # read contradicts this track — it's a different vehicle
            if score == 0.0:
                tx, ty = (tr.box[0] + tr.box[2]) / 2, (tr.box[1] + tr.box[3]) / 2
                dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5
                if dist < limit:
                    score = 1.0 - dist / limit  # always < any text score
            if score > best_score:
                best, best_score = tr, score
        return best

    def _log_visit(self, track: PlateTrack, ts: float) -> list[dict]:
        """Close out a visit: one event with the best read — unless a similar
        plate was logged recently (then it's the same visit continuing)."""
        best = track.best()
        if best is None:
            track.logged = True
            return []
        text, rec = best
        # a lone unconfirmed read must be confident, otherwise it's noise —
        # don't mark logged, so the visit can still qualify with later reads
        if rec["count"] < 2 and rec["best_conf"] < config.PLATE_SINGLE_READ_CONF:
            return []
        for logged_text, logged_ts in self._recent_logged.items():
            if (ts - logged_ts < config.PLATE_COOLDOWN_S
                    and plate_similarity(text, logged_text) >= config.PLATE_MATCH_RATIO):
                track.logged = True
                self._recent_logged[logged_text] = ts
                for v in reversed(self.visits):  # keep the visible record fresh
                    if v["plate"] == logged_text:
                        v["last_seen"] = track.last_seen
                        track.visit = v
                        break
                return []
        track.logged = True
        self._recent_logged[text] = ts
        confidence = round(rec["conf_sum"] / rec["count"], 3)
        visit = {
            "plate": text, "zone": track.zone,
            "first_seen": track.first_seen, "last_seen": track.last_seen,
            "reads": track.total_reads, "confidence": confidence,
            "thumb": rec["thumb"],
        }
        self.visits.append(visit)
        track.visit = visit
        return [{
            "type": "plate_detected", "label": text,
            "confidence": confidence, "ts": ts,
            "extra": {k: visit[k] for k in ("zone", "first_seen", "last_seen", "reads", "thumb")},
        }]

    # ---------- BaseModule ----------

    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        events: list[dict] = []
        h, w = frame.shape[:2]
        results = self.model(frame, verbose=False)[0]

        detections = []  # crop BEFORE drawing anything on the frame
        for box in results.boxes:
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
            if x2 - x1 < 20 or y2 - y1 < 10:
                continue
            cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
            zone = self._zone_for(cx, cy)
            if self.zones and zone is None:
                continue  # outside every detection zone
            detections.append(((x1, y1, x2, y2), zone, frame[y1:y2, x1:x2].copy()))

        self._draw_zones(frame)

        used: set = set()
        for box, zone, crop in detections:
            text, conf = self._read_plate(crop)
            track = self._match_track(zone, box, text, w, used)
            if track is None:
                track = PlateTrack(zone, box, ts)
                self.tracks.append(track)
            used.add(id(track))
            track.box, track.last_seen = box, ts
            if track.visit is not None:
                track.visit["last_seen"] = ts
            if text is not None:
                track.add_read(text, conf, self._thumb(crop))
            best = track.best()
            label = best[0] if best else "reading..."
            draw_box(frame, box, label, COLOR_OK if best else COLOR_NEUTRAL)

        # end-of-visit / long-stay logging, and track expiry
        alive: list[PlateTrack] = []
        for tr in self.tracks:
            if ts - tr.last_seen > config.PLATE_TRACK_TTL_S:
                if not tr.logged:
                    events += self._log_visit(tr, ts)
                continue  # visit over — drop the track
            if (not tr.logged and tr.total_reads >= config.PLATE_CONFIRM_READS
                    and ts - tr.first_seen >= config.PLATE_LOG_MAX_WAIT_S):
                events += self._log_visit(tr, ts)  # parked vehicle: log it now
            alive.append(tr)
        self.tracks = alive
        return frame, events

    def flush(self) -> list[dict]:
        events: list[dict] = []
        for tr in self.tracks:
            if not tr.logged:
                events += self._log_visit(tr, tr.last_seen)
        self.tracks = []
        return events

    def get_stats(self) -> dict:
        pending = []
        for tr in self.tracks:
            if tr.logged:
                continue
            best = tr.best()
            pending.append({
                "plate": best[0] if best else None,
                "zone": tr.zone,
                "reads": tr.total_reads,
                "first_seen": tr.first_seen,
            })
        return {
            "unique_plates": len(self.visits),
            "in_view": len(self.tracks),
            "zones": [z["label"] for z in self.zones],
            "plates": list(reversed(self.visits[-50:])),  # newest first
            "pending": pending,
        }
