"""License plate recognition: YOLO plate detector + EasyOCR.

Each readable plate is logged once per PLATE_COOLDOWN_S window so a car sitting
in front of the camera doesn't flood the log.
"""
import re

import numpy as np
from ultralytics import YOLO

from .. import config
from .base import BaseModule, COLOR_NEUTRAL, COLOR_OK, draw_box

_PLATE_CLEAN = re.compile(r"[^A-Z0-9]")


class ANPRModule(BaseModule):
    def __init__(self) -> None:
        self.model = YOLO(config.PLATE_MODEL)
        import easyocr  # heavy import, keep at module construction

        self.reader = easyocr.Reader(config.OCR_LANGS, gpu=False, verbose=False)
        # normalized plate -> {"first_seen", "last_seen", "count", "best_conf"}
        self.plates: dict[str, dict] = {}
        self._last_logged: dict[str, float] = {}

    def _read_plate(self, crop: np.ndarray) -> tuple[str | None, float]:
        results = self.reader.readtext(crop)
        if not results:
            return None, 0.0
        # join multi-line plates, keep the mean confidence
        text = "".join(r[1] for r in results)
        conf = float(np.mean([r[2] for r in results]))
        normalized = _PLATE_CLEAN.sub("", text.upper())
        if len(normalized) < config.PLATE_MIN_CHARS:
            return None, conf
        return normalized, conf

    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        events: list[dict] = []
        results = self.model(frame, verbose=False)[0]
        h, w = frame.shape[:2]
        for box in results.boxes:
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
            if x2 - x1 < 20 or y2 - y1 < 10:
                continue
            plate, conf = self._read_plate(frame[y1:y2, x1:x2])
            if plate is None:
                draw_box(frame, (x1, y1, x2, y2), "plate", COLOR_NEUTRAL)
                continue
            draw_box(frame, (x1, y1, x2, y2), plate, COLOR_OK)
            rec = self.plates.setdefault(
                plate, {"first_seen": ts, "last_seen": ts, "count": 0, "best_conf": 0.0}
            )
            rec["last_seen"] = ts
            rec["count"] += 1
            rec["best_conf"] = max(rec["best_conf"], conf)
            if ts - self._last_logged.get(plate, 0) >= config.PLATE_COOLDOWN_S:
                self._last_logged[plate] = ts
                events.append({
                    "type": "plate_detected", "label": plate,
                    "confidence": round(conf, 3), "ts": ts,
                })
        return frame, events

    def get_stats(self) -> dict:
        return {
            "unique_plates": len(self.plates),
            "plates": [
                {"plate": plate, **{k: (round(v, 3) if isinstance(v, float) else v)
                                    for k, v in rec.items()}}
                for plate, rec in sorted(self.plates.items(),
                                         key=lambda kv: -kv[1]["last_seen"])
            ],
        }
