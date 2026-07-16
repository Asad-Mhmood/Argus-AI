"""Face recognition & attendance: YOLO face detector + DeepFace (ArcFace) embeddings.

Enrollment: each subfolder of FACES_DIR is one person, holding one or more photos.
Embeddings are averaged per person and cached to JSON. A person is 'checked in'
the first time they are recognized, and re-logged if they reappear after
ATTENDANCE_GAP_MIN minutes away. Faces matching nobody are labeled "Unknown"
and logged as 'unknown_face' events, deduped by UNKNOWN_FACE_COOLDOWN_S.
"""
import json
import logging
import threading
import time
from pathlib import Path

import numpy as np

from .. import config
from .base import BaseModule, COLOR_ALERT, COLOR_OK, draw_box

log = logging.getLogger("visionguard.face")

CACHE_FILE = config.DATA_DIR / "face_embeddings.json"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
_db_lock = threading.Lock()


def _represent(img) -> list:
    """Embed an already-cropped face. detector_backend='skip' because detection is
    always done by our YOLO face model — DeepFace's own detectors (haarcascade)
    aren't shipped by every opencv build. Lazy import so the rest of the app
    works without tensorflow."""
    from deepface import DeepFace

    return DeepFace.represent(
        img,
        model_name=config.FACE_EMBED_MODEL,
        enforce_detection=False,
        detector_backend="skip",
    )


def _crop_largest_face(img: np.ndarray, detector) -> np.ndarray:
    """Crop the most prominent face from an enrollment photo (fallback: whole image)."""
    boxes = detector(img, verbose=False)[0].boxes.xyxy.cpu().numpy()
    if len(boxes) == 0:
        return img
    x1, y1, x2, y2 = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    h, w = img.shape[:2]
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w, int(x2)), min(h, int(y2))
    return img[y1:y2, x1:x2]


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    return 1 - float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def build_database(force: bool = False) -> dict:
    """Build or load the {name: {embedding, count}} cache from FACES_DIR."""
    with _db_lock:
        if not force and CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text())
        # Fail fast if the embedding stack is missing — otherwise every image would
        # be skipped below and a good cache silently overwritten with an empty one.
        from deepface import DeepFace  # noqa: F401
        import cv2
        from ultralytics import YOLO

        detector = YOLO(config.FACE_MODEL)
        known: dict = {}
        for person_dir in sorted(Path(config.FACES_DIR).iterdir()):
            if not person_dir.is_dir():
                continue
            embeddings = []
            for img_path in sorted(person_dir.iterdir()):
                if img_path.suffix.lower() not in IMAGE_EXTS:
                    continue
                try:
                    img = cv2.imread(str(img_path))
                    if img is None:
                        raise ValueError("unreadable image")
                    rep = _represent(_crop_largest_face(img, detector))
                    if rep and "embedding" in rep[0]:
                        embeddings.append(rep[0]["embedding"])
                except Exception as exc:  # noqa: BLE001 — skip bad images, keep enrolling
                    log.warning("Skipped %s: %s", img_path.name, exc)
            if embeddings:
                known[person_dir.name] = {
                    "embedding": np.mean(np.array(embeddings), axis=0).tolist(),
                    "count": len(embeddings),
                }
        CACHE_FILE.write_text(json.dumps(known))
        log.info("Face database built: %d identities", len(known))
        return known


def list_identities() -> list[dict]:
    out = []
    for person_dir in sorted(Path(config.FACES_DIR).iterdir()):
        if person_dir.is_dir():
            n = sum(1 for f in person_dir.iterdir() if f.suffix.lower() in IMAGE_EXTS)
            out.append({"name": person_dir.name, "samples": n})
    return out


class FaceAttendanceModule(BaseModule):
    def __init__(self) -> None:
        from ultralytics import YOLO  # heavy import — only when a session starts

        self.detector = YOLO(config.FACE_MODEL)
        self.known = {
            name: np.array(data["embedding"])
            for name, data in build_database().items()
        }
        # name -> {"first_seen": ts, "last_seen": ts, "sightings": int}
        self.people: dict[str, dict] = {}
        self.unknown_detections = 0
        self._last_unknown_ts = 0.0

    def _recognize(self, face_crop: np.ndarray) -> tuple[str, float]:
        try:
            rep = _represent(face_crop)
            if not rep or "embedding" not in rep[0]:
                return "Unknown", 1.0
            emb = np.array(rep[0]["embedding"])
        except Exception as exc:  # noqa: BLE001
            log.warning("Recognition failed: %s", exc)
            return "Unknown", 1.0
        best_name, best_dist = "Unknown", 1.0
        for name, known_emb in self.known.items():
            dist = _cosine_distance(known_emb, emb)
            if dist < best_dist:
                best_name, best_dist = name, dist
        if best_dist < config.FACE_THRESHOLD:
            return best_name, best_dist
        return "Unknown", best_dist

    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        events: list[dict] = []
        results = self.detector(frame, verbose=False)
        boxes = results[0].boxes.xyxy.cpu().numpy()
        h, w = frame.shape[:2]
        for box in boxes:
            x1, y1, x2, y2 = (int(v) for v in box)
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
            face = frame[y1:y2, x1:x2]
            if face.shape[0] < 40 or face.shape[1] < 40:
                continue
            name, dist = self._recognize(face)
            known = name != "Unknown"
            confidence = round(1 - dist, 3) if known else None
            draw_box(frame, (x1, y1, x2, y2), name, COLOR_OK if known else COLOR_ALERT)
            if not known:
                if ts - self._last_unknown_ts >= config.UNKNOWN_FACE_COOLDOWN_S:
                    self._last_unknown_ts = ts
                    self.unknown_detections += 1
                    events.append({"type": "unknown_face", "label": "Unknown",
                                   "confidence": None, "ts": ts})
                continue
            record = self.people.get(name)
            gap = config.ATTENDANCE_GAP_MIN * 60
            if record is None or ts - record["last_seen"] > gap:
                events.append({
                    "type": "check_in", "label": name, "confidence": confidence, "ts": ts,
                    "extra": {"returning": record is not None},
                })
                if record is None:
                    record = self.people[name] = {"first_seen": ts, "sightings": 0}
            record["last_seen"] = ts
            record["sightings"] += 1
        return frame, events

    def get_stats(self) -> dict:
        now = time.time()
        return {
            "enrolled": len(self.known),
            "unknown_detections": self.unknown_detections,
            "people": [
                {
                    "name": name,
                    "first_seen": rec["first_seen"],
                    "last_seen": rec["last_seen"],
                    "sightings": rec["sightings"],
                    "present": now - rec["last_seen"] < config.ATTENDANCE_GAP_MIN * 60,
                }
                for name, rec in sorted(self.people.items(), key=lambda kv: kv[1]["first_seen"])
            ],
        }
