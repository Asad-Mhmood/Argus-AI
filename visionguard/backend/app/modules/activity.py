"""Idle worker / activity detection: YOLO pose keypoints + centroid tracking.

A person whose tracked keypoints move less than MOVEMENT_THRESHOLD px for
IDLE_SECONDS is flagged idle. Events are emitted on each transition
(idle_start / active again) with the idle duration.
"""
import time

import numpy as np
from ultralytics import YOLO

from .. import config
from .base import BaseModule, COLOR_ALERT, COLOR_OK, draw_box

# Nose, shoulders, elbows, wrists, hips
KEYPOINT_IDS = [0, 5, 6, 7, 8, 9, 10, 11, 12]
MATCH_DISTANCE = 100  # px, centroid gate for track association


class _Person:
    _counter = 0

    def __init__(self, bbox, keypoints, ts: float):
        _Person._counter += 1
        self.label = f"P{_Person._counter}"
        self.bbox = bbox
        self.keypoints = keypoints
        self.last_moved = ts
        self.last_seen = ts
        self.is_idle = False
        self.idle_since: float | None = None

    def update(self, keypoints, bbox, ts: float) -> None:
        self.bbox = bbox
        self.last_seen = ts
        pairs = [
            (prev, curr)
            for prev, curr in zip(self.keypoints, keypoints)
            if prev is not None and curr is not None
        ]
        if pairs:
            displacement = float(np.mean([
                np.hypot(curr[0] - prev[0], curr[1] - prev[1]) for prev, curr in pairs
            ]))
            if displacement >= config.MOVEMENT_THRESHOLD:
                self.last_moved = ts
        self.keypoints = keypoints

    @property
    def center(self) -> np.ndarray:
        return np.array([(self.bbox[0] + self.bbox[2]) / 2, (self.bbox[1] + self.bbox[3]) / 2])


class ActivityModule(BaseModule):
    def __init__(self) -> None:
        self.model = YOLO(config.POSE_MODEL)
        self.persons: list[_Person] = []
        self.total_idle_events = 0

    def _detect(self, frame: np.ndarray) -> list[tuple]:
        results = self.model(frame, verbose=False)[0]
        if results.keypoints is None:
            return []
        bboxes = results.boxes.xyxy.cpu().numpy()
        keypoints = results.keypoints.xy.cpu().numpy()
        return [
            (box, [kp[i] if kp[i][0] > 0 and kp[i][1] > 0 else None for i in KEYPOINT_IDS])
            for box, kp in zip(bboxes, keypoints)
        ]

    def _match(self, detections: list[tuple], ts: float) -> None:
        matched: list[_Person] = []
        used = set()
        for bbox, keypoints in detections:
            center = np.array([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])
            best, best_dist = None, MATCH_DISTANCE
            for person in self.persons:
                if id(person) in used:
                    continue
                dist = float(np.linalg.norm(center - person.center))
                if dist < best_dist:
                    best, best_dist = person, dist
            if best is not None:
                best.update(keypoints, bbox, ts)
                used.add(id(best))
                matched.append(best)
            else:
                matched.append(_Person(bbox, keypoints, ts))
        self.persons = matched

    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        events: list[dict] = []
        self._match(self._detect(frame), ts)
        for person in self.persons:
            idle_now = ts - person.last_moved >= config.IDLE_SECONDS
            if idle_now and not person.is_idle:
                person.is_idle = True
                person.idle_since = person.last_moved
                self.total_idle_events += 1
                events.append({
                    "type": "idle_start", "label": person.label, "ts": ts,
                    "extra": {"idle_seconds": round(ts - person.last_moved, 1)},
                })
            elif not idle_now and person.is_idle:
                duration = round(ts - (person.idle_since or ts), 1)
                person.is_idle = False
                person.idle_since = None
                events.append({
                    "type": "active_again", "label": person.label, "ts": ts,
                    "extra": {"idle_duration_s": duration},
                })
            status = "Idle" if person.is_idle else "Active"
            if person.is_idle and person.idle_since:
                status += f" {int(ts - person.idle_since)}s"
            draw_box(frame, person.bbox, f"{person.label} · {status}",
                     COLOR_ALERT if person.is_idle else COLOR_OK)
        return frame, events

    def get_stats(self) -> dict:
        now = time.time()
        idle = [p for p in self.persons if p.is_idle]
        return {
            "people_in_view": len(self.persons),
            "active": len(self.persons) - len(idle),
            "idle": len(idle),
            "total_idle_events": self.total_idle_events,
            "persons": [
                {
                    "label": p.label,
                    "status": "idle" if p.is_idle else "active",
                    "idle_seconds": round(now - p.idle_since, 1) if p.idle_since else 0,
                }
                for p in self.persons
            ],
        }
