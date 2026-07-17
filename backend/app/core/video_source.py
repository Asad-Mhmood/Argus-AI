"""Video input abstraction: live RTSP (frame-dropping), uploaded file, or bundled demo.

Live sources run a grab thread that keeps only the *latest* frame, so slow CPU
inference never falls behind the stream. File sources are paced by skipping
frames to match the analysis FPS.
"""
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .. import config


class VideoSource(ABC):
    is_live: bool = False

    @abstractmethod
    def read(self) -> Optional[np.ndarray]:
        """Return the next frame to analyse, or None when the source is exhausted/broken."""

    @abstractmethod
    def release(self) -> None: ...


def _downscale(frame: np.ndarray) -> np.ndarray:
    h, w = frame.shape[:2]
    if w > config.MAX_FRAME_WIDTH:
        scale = config.MAX_FRAME_WIDTH / w
        frame = cv2.resize(frame, (config.MAX_FRAME_WIDTH, int(h * scale)))
    return frame


class RTSPSource(VideoSource):
    """Live IP camera. A background thread grabs continuously and keeps the newest frame."""

    is_live = True

    def __init__(self, url: str):
        self.url = url
        self._cap = cv2.VideoCapture(url)
        if not self._cap.isOpened():
            raise ValueError(f"Cannot open stream: {url}")
        self._latest: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._stopped = False
        self._failed = False
        self._thread = threading.Thread(target=self._grab_loop, daemon=True)
        self._thread.start()

    def _grab_loop(self) -> None:
        failures = 0
        while not self._stopped:
            ok, frame = self._cap.read()
            if ok:
                failures = 0
                with self._lock:
                    self._latest = frame
            else:
                failures += 1
                if failures > 50:  # stream dropped
                    self._failed = True
                    return
                time.sleep(0.2)

    def read(self) -> Optional[np.ndarray]:
        # wait briefly for the first frame
        deadline = time.time() + 10
        while time.time() < deadline:
            if self._failed or self._stopped:
                return None
            with self._lock:
                if self._latest is not None:
                    frame, self._latest = self._latest, None
                    return _downscale(frame)
            time.sleep(0.02)
        return None

    def release(self) -> None:
        self._stopped = True
        self._thread.join(timeout=2)
        self._cap.release()


class FileSource(VideoSource):
    """Recorded video. Skips frames so analysis advances at native speed but only
    ANALYSIS_FPS frames per second of footage are actually processed."""

    is_live = False

    def __init__(self, path: str):
        self.path = path
        self._cap = cv2.VideoCapture(path)
        if not self._cap.isOpened():
            raise ValueError(f"Cannot open video file: {path}")
        native_fps = self._cap.get(cv2.CAP_PROP_FPS) or 30
        self._skip = max(0, int(round(native_fps / config.ANALYSIS_FPS)) - 1)

    def read(self) -> Optional[np.ndarray]:
        ok, frame = self._cap.read()
        if not ok:
            return None
        for _ in range(self._skip):
            self._cap.grab()
        return _downscale(frame)

    def release(self) -> None:
        self._cap.release()


def _safe_path(base: Path, name: str) -> Path:
    """Resolve name inside base, refusing path traversal."""
    p = (base / name).resolve()
    if base.resolve() not in p.parents and p != base.resolve():
        raise ValueError("Invalid file name")
    if not p.is_file():
        raise ValueError(f"File not found: {name}")
    return p


def create_source(source_type: str, source: str) -> VideoSource:
    if source_type == "rtsp":
        if not source.lower().startswith(("rtsp://", "http://", "https://")):
            raise ValueError("Live source must be an rtsp:// or http(s):// URL")
        return RTSPSource(source)
    if source_type == "upload":
        return FileSource(str(_safe_path(config.UPLOADS_DIR, source)))
    if source_type == "demo":
        return FileSource(str(_safe_path(config.DEMO_DIR, source)))
    raise ValueError(f"Unknown source type: {source_type}")
