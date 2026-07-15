"""REST API routes."""
import csv
import io
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import config, database
from .core.session_manager import manager
from .modules import list_use_cases

router = APIRouter(prefix="/api")

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class SessionRequest(BaseModel):
    use_case: str
    source_type: str  # rtsp | upload | demo
    source: str       # RTSP URL, uploaded file name, or demo file name


def _safe_name(name: str) -> str:
    cleaned = Path(name).name
    if not cleaned or cleaned.startswith("."):
        raise HTTPException(400, "Invalid file name")
    return cleaned


# ---------- meta ----------

@router.get("/health")
def health() -> dict:
    return {"status": "ok", "time": time.time()}


@router.get("/usecases")
def usecases() -> list[dict]:
    return list_use_cases()


# ---------- video inputs ----------

@router.get("/demos")
def demos() -> list[dict]:
    return [
        {"name": p.name, "size_mb": round(p.stat().st_size / 1e6, 1)}
        for p in sorted(config.DEMO_DIR.iterdir())
        if p.suffix.lower() in VIDEO_EXTS
    ]


@router.post("/videos")
def upload_video(file: UploadFile = File(...)) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VIDEO_EXTS:
        raise HTTPException(400, f"Unsupported video type '{ext}'. Use: {', '.join(sorted(VIDEO_EXTS))}")
    name = f"{uuid.uuid4().hex[:8]}_{_safe_name(file.filename)}"
    dest = config.UPLOADS_DIR / name
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    with dest.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds {config.MAX_UPLOAD_MB} MB limit")
            out.write(chunk)
    return {"name": name, "size_mb": round(written / 1e6, 1)}


@router.get("/videos")
def list_uploads() -> list[dict]:
    return [
        {"name": p.name, "size_mb": round(p.stat().st_size / 1e6, 1)}
        for p in sorted(config.UPLOADS_DIR.iterdir(), key=lambda p: -p.stat().st_mtime)
        if p.suffix.lower() in VIDEO_EXTS
    ]


# ---------- sessions ----------

@router.post("/sessions")
def create_session(req: SessionRequest) -> dict:
    try:
        session = manager.create(req.use_case, req.source_type, req.source)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(
            503, f"Dependency missing for '{req.use_case}': {exc}. "
                 "Install the full requirements.txt (or use the Docker image).",
        ) from exc
    return session.to_dict()


@router.get("/sessions")
def list_sessions() -> dict:
    live = {s["id"]: s for s in manager.list_live()}
    history = database.list_sessions()
    for row in history:
        if row["id"] in live:
            row["status"] = live[row["id"]]["status"]
    return {"live": [s for s in live.values() if s["status"] in ("starting", "running")],
            "history": history}


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    live = manager.get(session_id)
    if live is not None:
        return live.to_dict()
    row = database.get_session(session_id)
    if row is None:
        raise HTTPException(404, "Session not found")
    return row


@router.post("/sessions/{session_id}/stop")
def stop_session(session_id: str) -> dict:
    if not manager.stop(session_id):
        raise HTTPException(404, "Session not found or already finished")
    return {"stopped": True}


@router.get("/sessions/{session_id}/stream")
def stream(session_id: str):
    session = manager.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found (streams are only available while running)")
    return StreamingResponse(
        session.mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/sessions/{session_id}/snapshot")
def snapshot(session_id: str):
    session = manager.get(session_id)
    jpeg = session.latest_jpeg() if session else None
    if jpeg is None:
        raise HTTPException(404, "No frame available")
    return StreamingResponse(io.BytesIO(jpeg), media_type="image/jpeg")


@router.get("/sessions/{session_id}/stats")
def session_stats(session_id: str) -> dict:
    session = manager.get(session_id)
    if session is not None:
        return {"session": session.to_dict(), "stats": session.module.get_stats()}
    row = database.get_session(session_id)
    if row is None:
        raise HTTPException(404, "Session not found")
    stats: dict = {}
    if row["use_case"] == "face_attendance":
        stats = {"people": database.attendance_log(session_id)}
    return {"session": row, "stats": stats}


# ---------- events ----------

@router.get("/events")
def events(
    session_id: Optional[str] = None,
    use_case: Optional[str] = None,
    type: Optional[str] = None,
    q: Optional[str] = None,
    hours: Optional[float] = None,
    limit: int = Query(200, le=1000),
    offset: int = 0,
) -> list[dict]:
    since = time.time() - hours * 3600 if hours else None
    return database.query_events(session_id, use_case, type, q, since, limit, offset)


@router.get("/events/export")
def export_events(
    session_id: Optional[str] = None,
    use_case: Optional[str] = None,
    hours: Optional[float] = None,
) -> StreamingResponse:
    since = time.time() - hours * 3600 if hours else None
    rows = database.query_events(session_id, use_case, since=since, limit=100_000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp_utc", "use_case", "type", "label", "confidence", "session_id"])
    for r in reversed(rows):  # chronological order in the file
        writer.writerow([
            datetime.fromtimestamp(r["ts"], tz=timezone.utc).isoformat(),
            r["use_case"], r["type"], r["label"],
            r["confidence"] if r["confidence"] is not None else "",
            r["session_id"],
        ])
    buf.seek(0)
    filename = f"visionguard_events_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/stats/summary")
def stats_summary(hours: int = Query(24, le=24 * 30)) -> dict:
    return {"per_hour": database.events_per_hour(hours)}


# ---------- face enrollment ----------

@router.get("/faces")
def faces() -> list[dict]:
    from .modules.face_attendance import list_identities

    return list_identities()


@router.post("/faces/{name}")
def add_face(name: str, files: list[UploadFile] = File(...)) -> dict:
    person_dir = config.FACES_DIR / _safe_name(name)
    person_dir.mkdir(exist_ok=True)
    saved = 0
    for f in files:
        ext = Path(f.filename or "").suffix.lower()
        if ext not in IMAGE_EXTS:
            continue
        dest = person_dir / f"{uuid.uuid4().hex[:8]}{ext}"
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        saved += 1
    if not saved:
        raise HTTPException(400, f"No valid images. Use: {', '.join(sorted(IMAGE_EXTS))}")
    return {"name": name, "saved": saved,
            "note": "Call POST /api/faces/rebuild to refresh embeddings."}


@router.delete("/faces/{name}")
def delete_face(name: str) -> dict:
    person_dir = config.FACES_DIR / _safe_name(name)
    if not person_dir.is_dir():
        raise HTTPException(404, "Identity not found")
    shutil.rmtree(person_dir)
    return {"deleted": name, "note": "Call POST /api/faces/rebuild to refresh embeddings."}


@router.post("/faces/rebuild")
def rebuild_faces() -> dict:
    from .modules.face_attendance import build_database

    known = build_database(force=True)
    return {"identities": len(known), "names": sorted(known)}
