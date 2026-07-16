# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VisionGuard AI — a two-part AI video surveillance platform:

- `backend/` — FastAPI inference engine (Python). Runs YOLO/DeepFace/EasyOCR models on CPU.
- `frontend/` — Next.js dashboard (App Router, plain JS + CSS, no UI library). Talks to the backend only via REST + MJPEG; the backend URL comes from `NEXT_PUBLIC_API_URL`.
- `legacy/` — archived prototype scripts the platform was built from. Reference only; never develop here.

There is no test suite.

## Commands

```bash
# Backend (venv already exists at backend/.venv with all deps except tensorflow/deepface)
cd backend
.venv/Scripts/python -m uvicorn app.main:app --port 8000   # Windows paths

# Frontend
cd frontend
npm run dev     # http://localhost:3000
npm run build   # production build (this is what Vercel runs)

# Full stack incl. face recognition
docker compose up --build
```

Interactive API docs at `http://localhost:8000/docs`.

## Hard constraints

- **CPU-only, no GPU.** The whole design assumes low-FPS analysis (`ANALYSIS_FPS=2`, frame-dropping for live streams). Don't add anything that requires real-time full-FPS inference.
- **ARM64 deploy target** (Oracle Cloud Ampere, via `backend/Dockerfile`). Every backend dependency must ship aarch64 Linux wheels — no paddle/paddleocr (EasyOCR is the OCR engine).
- **Face recognition runs everywhere, including this Windows machine** (TF ≥2.21 ships Windows py3.13 wheels; installed in `backend/.venv` and verified July 2026). DeepFace is used with `detector_backend="skip"` — detection is always our YOLO face model; never rely on DeepFace's own detectors (opencv 5 headless doesn't ship haarcascades). Heavy imports stay lazy, so a missing dep 503s only that use case.
- **Docker inference does NOT work on this dev machine either** — the host has 4 GB RAM (Docker/WSL2 gets ~1.8 GB) and the kernel OOM-kills the engine mid-inference, even at 640px frames (verified July 2026). The image itself is correct (builds, API works, face module verified). Local dev/demo runs use the venv (`start_demo.bat`); Docker is for ≥8 GB machines and servers.
- All backend tuning lives in `backend/app/config.py`, entirely env-overridable — never hardcode paths or thresholds elsewhere. Documented in `backend/.env.example`.

## Architecture

The core abstraction is a **session**: `POST /api/sessions {use_case, source_type, source}` →
`SessionManager` (`app/core/session_manager.py`) builds a `VideoSource` + a detection module,
then runs a daemon thread that:

1. pulls a frame from the source,
2. calls `module.process_frame(frame, ts)` → `(annotated_frame, events)`,
3. persists events to SQLite (`app/database.py` — modules never touch the DB),
4. publishes the annotated JPEG for the MJPEG endpoint (`/api/sessions/{id}/stream`),
5. paces itself to `ANALYSIS_FPS`.

**Video sources** (`app/core/video_source.py`): `RTSPSource` runs a grab thread keeping only
the newest frame (so slow inference never lags a live stream); `FileSource` skips frames to
match the analysis rate. Both downscale to `MAX_FRAME_WIDTH`. File names are traversal-guarded.

**Detection modules** (`app/modules/`): one file per use case, registered in
`app/modules/__init__.py` (`_REGISTRY`), all implementing `BaseModule`
(`process_frame`, `get_stats`, `close`). Modules are imported lazily via `create_module()`.
To add a use case: write the module file, add one registry entry, add a color/label entry in
`frontend/lib/api.js` — nothing else.

Module-specific semantics worth knowing:
- **ppe**: violation classes are derived from the model's own class names by prefix
  (`PPE_VIOLATION_PREFIXES`, default `no,without` — also catches `none`); `Person` is neutral
  via `PPE_NEUTRAL_CLASSES` and excluded from the compliance rate.
- **face_attendance**: embeddings cache in `backend/data/face_embeddings.json`, built from
  `backend/faces_db/<person>/*.jpg`; rebuild via `POST /api/faces/rebuild`.
- **anpr** and **ppe** deduplicate events with cooldown windows (`PLATE_COOLDOWN_S`,
  `VIOLATION_COOLDOWN_S`) so the log isn't flooded.

**Frontend**: three pages — `app/page.jsx` (use-case → source wizard), `app/session/[id]/page.jsx`
(live MJPEG + per-use-case stats panels, polling every ~2.5s), `app/history/page.jsx`
(filters + custom SVG stacked-bar chart + event table). Use-case colors are fixed slots in
`app/globals.css` / `lib/api.js` — keep the assignment stable, it's a validated accessible palette.

## Deployment

- Backend → Oracle Always Free ARM VM via Docker; needs `CORS_ORIGINS` set to the frontend URL,
  and HTTPS (Caddy + DuckDNS) because a Vercel (https) frontend can't call a plain-http API.
- Frontend → Vercel, Root Directory = `frontend`, env `NEXT_PUBLIC_API_URL`.
- Full steps are in README.md §2–3.
