"""Runs analysis sessions: one background thread per session pulling frames from a
VideoSource through a detection module at a CPU-friendly rate, publishing the
latest annotated JPEG for MJPEG streaming and persisting events to SQLite."""
import logging
import threading
import time
import uuid
from typing import Iterator, Optional

import cv2

from .. import config, database
from ..modules import create_module
from .video_source import VideoSource, create_source

log = logging.getLogger("visionguard.session")


class AnalysisSession:
    def __init__(self, use_case: str, source_type: str, source: str):
        self.id = uuid.uuid4().hex[:12]
        self.use_case = use_case
        self.source_type = source_type
        self.source_desc = source
        self.status = "starting"
        self.error: Optional[str] = None
        self.started_at = time.time()
        self.frames_processed = 0

        # validate the (cheap) video source before loading (heavy) models
        self.video: VideoSource = create_source(source_type, source)
        try:
            self.module = create_module(use_case)
        except Exception:
            self.video.release()
            raise

        self._jpeg: Optional[bytes] = None
        self._jpeg_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        database.create_session(self.id, self.use_case, self.source_type, self.source_desc)
        self._thread.start()

    def _run(self) -> None:
        self.status = "running"
        interval = 1.0 / config.ANALYSIS_FPS
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY]
        try:
            while not self._stop.is_set():
                t0 = time.time()
                frame = self.video.read()
                if frame is None:
                    self.status = "completed" if not self.video.is_live else "error"
                    if self.status == "error":
                        self.error = "Live stream dropped or produced no frames"
                    break
                annotated, events = self.module.process_frame(frame, t0)
                if events:
                    database.insert_events(self.id, self.use_case, events)
                ok, buf = cv2.imencode(".jpg", annotated, encode_params)
                if ok:
                    with self._jpeg_lock:
                        self._jpeg = buf.tobytes()
                self.frames_processed += 1
                # pace to ANALYSIS_FPS (only matters when inference is faster than target)
                elapsed = time.time() - t0
                if elapsed < interval:
                    self._stop.wait(interval - elapsed)
            if self._stop.is_set():
                self.status = "stopped"
        except Exception as exc:  # noqa: BLE001 — session must record any failure
            log.exception("Session %s crashed", self.id)
            self.status = "error"
            self.error = str(exc)
        finally:
            self.video.release()
            self.module.close()
            database.set_session_status(self.id, self.status)

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    @property
    def is_active(self) -> bool:
        return self._thread.is_alive()

    def latest_jpeg(self) -> Optional[bytes]:
        with self._jpeg_lock:
            return self._jpeg

    def mjpeg_stream(self) -> Iterator[bytes]:
        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
        interval = 1.0 / config.STREAM_FPS
        # keep serving the last frame briefly after completion so the viewer
        # sees the final state instead of a broken image
        grace_until = None
        while True:
            jpeg = self.latest_jpeg()
            if jpeg is not None:
                yield boundary + jpeg + b"\r\n"
            if not self.is_active:
                if grace_until is None:
                    grace_until = time.time() + 3
                elif time.time() > grace_until:
                    return
            time.sleep(interval)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "use_case": self.use_case,
            "source_type": self.source_type,
            "source": self.source_desc,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at,
            "frames_processed": self.frames_processed,
        }


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, AnalysisSession] = {}
        self._lock = threading.Lock()

    def create(self, use_case: str, source_type: str, source: str) -> AnalysisSession:
        with self._lock:
            active = sum(1 for s in self._sessions.values() if s.is_active)
            if active >= config.MAX_CONCURRENT_SESSIONS:
                raise RuntimeError(
                    f"Maximum of {config.MAX_CONCURRENT_SESSIONS} concurrent sessions reached. "
                    "Stop a running session first."
                )
            session = AnalysisSession(use_case, source_type, source)
            self._sessions[session.id] = session
        session.start()
        return session

    def get(self, session_id: str) -> Optional[AnalysisSession]:
        return self._sessions.get(session_id)

    def stop(self, session_id: str) -> bool:
        session = self._sessions.get(session_id)
        if session is None:
            return False
        session.stop()
        return True

    def list_live(self) -> list[dict]:
        return [s.to_dict() for s in self._sessions.values()]

    def shutdown(self) -> None:
        for s in list(self._sessions.values()):
            if s.is_active:
                s.stop()


manager = SessionManager()
