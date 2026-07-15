"""Common interface every detection module implements.

A module receives raw frames and returns (annotated_frame, events).
Events are dicts: {"type": str, "label": str, "confidence": float|None, "extra": dict|None}
and are persisted by the session runner — modules never touch the database.
"""
from abc import ABC, abstractmethod

import numpy as np

# Shared annotation colors (BGR)
COLOR_OK = (80, 200, 60)
COLOR_ALERT = (60, 60, 230)
COLOR_NEUTRAL = (200, 160, 40)


class BaseModule(ABC):
    #: registry key, e.g. "face_attendance"
    key: str = ""
    #: human name shown in the UI
    title: str = ""
    description: str = ""

    @abstractmethod
    def process_frame(self, frame: np.ndarray, ts: float) -> tuple[np.ndarray, list[dict]]:
        """Analyse one frame; return the annotated frame and any new events."""

    @abstractmethod
    def get_stats(self) -> dict:
        """Live, use-case-specific stats for the dashboard side panel."""

    def close(self) -> None:
        """Release any resources (optional)."""


def draw_box(frame: np.ndarray, box, label: str, color) -> None:
    x1, y1, x2, y2 = (int(v) for v in box)
    import cv2

    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    ty = max(th + 6, y1 - 4)
    cv2.rectangle(frame, (x1, ty - th - 6), (x1 + tw + 6, ty + 2), color, -1)
    cv2.putText(frame, label, (x1 + 3, ty - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (255, 255, 255), 2)
