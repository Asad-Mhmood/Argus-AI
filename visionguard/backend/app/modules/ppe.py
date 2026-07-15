"""PPE / safety compliance: YOLO HSE model.

Violation classes are inferred from the model's own class names — anything whose
name starts with a configured prefix ("no", "without", ...) counts as a violation
(e.g. "NO-Hardhat", "no_vest"). Compliance rate = compliant detections / all
gear detections. Violations are logged as events, deduplicated per class.
"""
import time

import numpy as np
from ultralytics import YOLO

from .. import config
from .base import BaseModule, COLOR_ALERT, COLOR_NEUTRAL, COLOR_OK, draw_box


class PPEModule(BaseModule):
    def __init__(self) -> None:
        self.model = YOLO(config.PPE_MODEL)
        self.names: dict[int, str] = self.model.names
        self.violation_ids = {
            i for i, n in self.names.items()
            if any(n.lower().replace("-", " ").replace("_", " ").startswith(p)
                   for p in config.PPE_VIOLATION_PREFIXES)
        }
        # classes that are neither compliant gear nor a violation (e.g. "Person")
        self.neutral_ids = {
            i for i, n in self.names.items()
            if n.lower() in config.PPE_NEUTRAL_CLASSES
        }
        self.compliant = 0
        self.violations = 0
        self.class_counts: dict[str, int] = {}
        self._last_violation_ts: dict[str, float] = {}

    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        events: list[dict] = []
        results = self.model(frame, verbose=False)[0]
        for box in results.boxes:
            conf = float(box.conf[0])
            if conf < config.PPE_CONFIDENCE:
                continue
            cls_id = int(box.cls[0])
            name = self.names.get(cls_id, str(cls_id))
            xyxy = box.xyxy[0].tolist()
            if cls_id in self.neutral_ids:
                draw_box(frame, xyxy, f"{name} {conf:.0%}", COLOR_NEUTRAL)
                continue  # neither compliant nor a violation
            is_violation = cls_id in self.violation_ids
            draw_box(frame, xyxy, f"{name} {conf:.0%}",
                     COLOR_ALERT if is_violation else COLOR_OK)
            self.class_counts[name] = self.class_counts.get(name, 0) + 1
            if is_violation:
                self.violations += 1
                last = self._last_violation_ts.get(name, 0)
                if ts - last >= config.VIOLATION_COOLDOWN_S:
                    self._last_violation_ts[name] = ts
                    events.append({
                        "type": "violation", "label": name,
                        "confidence": round(conf, 3), "ts": ts,
                        "extra": {"box": [round(v) for v in xyxy]},
                    })
            else:
                self.compliant += 1
        return frame, events

    def get_stats(self) -> dict:
        total = self.compliant + self.violations
        return {
            "compliance_rate": round(self.compliant / total, 4) if total else None,
            "compliant_detections": self.compliant,
            "violation_detections": self.violations,
            "class_counts": dict(sorted(self.class_counts.items(),
                                        key=lambda kv: -kv[1])),
            "violation_classes": sorted(self.names[i] for i in self.violation_ids),
        }
