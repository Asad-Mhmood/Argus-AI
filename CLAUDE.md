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
# Backend (venv already exists at backend/.venv with all deps incl. tensorflow/deepface)
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
(A `BrowserSource` "Use my camera" feature existed briefly — removed at the owner's request,
recoverable from commit `7ee52a2`; don't re-add it unasked. Consequence: live testing against
the cloud engine needs an internet-reachable RTSP camera.)

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
  `backend/faces_db/<person>/*.jpg`; rebuild via `POST /api/faces/rebuild` (enroll/delete
  auto-rebuild, degrading gracefully when deepface is missing). Unrecognized faces are
  ignored entirely — no box drawn, no event logged. Cross-session dashboard data
  comes from `GET /api/attendance` (person + date filters); frontend pages: `/faces`
  (enrollment) and `/attendance` (dashboard).
- **anpr**: logs **one event per vehicle visit**, not per read. Detections are grouped
  into tracks by fuzzy plate-text similarity (partial reads like "ABC12" fold into
  "ABC123"; contradicting text forces a new track even at the same spot) with spatial
  matching as fallback; the best-supported read wins and the event carries
  `extra: {zone, first_seen, last_seen, reads, thumb}` (thumb = small data-URI JPEG of
  the winning read's crop). A visit is logged when the track expires
  (`PLATE_TRACK_TTL_S`), when a vehicle lingers (`PLATE_LOG_MAX_WAIT_S`), or at session
  end via `BaseModule.flush()`; lone low-confidence reads are rejected
  (`PLATE_SINGLE_READ_CONF`), re-appearances within `PLATE_COOLDOWN_S` are merged.
  Optional **detection zones** (normalized labeled rects, drawn in the UI on a
  `POST /api/preview` frame, passed via the session-create `zones` field) restrict
  detection and tag every event with its zone.
- **ppe** deduplicates events with a cooldown window (`VIOLATION_COOLDOWN_S`) so the
  log isn't flooded.

**Frontend**: five pages — `app/page.jsx` (use-case → source wizard; sources are upload + RTSP,
the demo tab was removed), `app/session/[id]/page.jsx` (live MJPEG + per-use-case stats panels,
polling every ~2.5s), `app/faces/page.jsx` (person enrollment), `app/attendance/page.jsx`
(cross-session attendance dashboard), `app/history/page.jsx` (filters + custom SVG stacked-bar
chart + event table). Use-case colors are fixed slots in `app/globals.css` / `lib/api.js` —
keep the assignment stable, it's a validated accessible palette. The engine URL can be
overridden per-browser via the ⚙ Engine panel (localStorage, beats `NEXT_PUBLIC_API_URL`).

## Deployment

Current live setup (July 2026):

- **Frontend** → Vercel project `visionguard` (team asadmayo42), live at
  https://visionguard-eta.vercel.app. Connected to GitHub `Asad-Mhmood/Argus-AI`:
  **push to `main` auto-deploys production**. Root Directory = `frontend` (set in project
  settings — repo root also holds the backend, builds fail without it). Env:
  `NEXT_PUBLIC_API_URL=https://asadmayo42--visionguard.modal.run` (baked at build time —
  changing it needs a redeploy). Manual deploy fallback: `cd frontend && vercel deploy --prod`
  (the CLI is linked; never deploy from repo root — CLI 55's service detection generates a
  broken vercel.json there).
- **Backend** → Modal serverless container, live at
  https://asadmayo42--visionguard.modal.run (workspace `asadmayo42`, app `visionguard`).
  Free Starter plan: $30/mo credits, no card (HF Spaces is NOT an option — Docker Spaces
  went PRO-only for new accounts in 2026). Defined in `backend/modal_app.py`; deploy with
  `deploy_modal.bat` from the repo root (`modal` is installed in `backend/.venv`; this
  machine is already logged in — new machines run `deploy_modal.bat setup` once). Scales
  to zero when idle (~10–30 s cold start); faces/uploads/embeddings persist on Volume
  `visionguard-data`, the SQLite DB is local-disk with a per-minute Volume backup.
  `max_containers=1` is load-bearing — sessions are in-memory. README §7.1.
- **Backend fallback for local demos** → this machine via `start_demo.bat` (venv engine +
  Cloudflare quick tunnel). The tunnel prints a fresh `https://*.trycloudflare.com` URL each
  start; paste it into the dashboard's ⚙ Engine override (and *Reset to default* afterwards,
  or the override keeps beating the Modal URL).
- **Backend alternative for 24/7 production** → Oracle Always Free ARM VM via Docker (needs
  a card for signup); `CORS_ORIGINS` set to the frontend URL + HTTPS via Caddy + DuckDNS.
  Full steps in README.md §7.2.
