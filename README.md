# VisionGuard AI

**AI video surveillance platform** — four computer-vision analytics modules behind one
dashboard, built to run on **CPU only** (no GPU required) and deploy for **free**
(Oracle Cloud Always Free + Vercel).

| Module | What it does | Model |
|---|---|---|
| 🧑 **Face Recognition / Attendance** | Recognizes enrolled faces, keeps an attendance log with in/out times | YOLOv12-face + ArcFace (DeepFace) |
| 🦺 **PPE / Safety Compliance** | Detects safety-gear violations (no helmet, no gloves, …), tracks a live compliance rate | YOLO11 (custom HSE) |
| 🏃 **Idle Worker / Activity** | Tracks people via pose keypoints, flags anyone idle beyond a threshold | YOLOv8-pose |
| 🚗 **License Plate Recognition (ANPR)** | Reads vehicle plates and logs **one event per vehicle visit** (best read wins, plate thumbnail included), with optional user-drawn **detection zones** (e.g. Entry / Exit) | YOLO (custom) + EasyOCR |

Every module accepts **two video sources**, chosen per analysis session:

1. **Live IP camera** — any RTSP/HTTP stream URL
2. **Uploaded recording** — MP4 / AVI / MOV / MKV / WebM

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Repository layout](#2-repository-layout)
3. [Running locally](#3-running-locally)
4. [Configuration reference](#4-configuration-reference)
5. [Using the system](#5-using-the-system)
6. [API reference](#6-api-reference)
7. [Deployment — backend in the cloud (free)](#7-deployment--backend-in-the-cloud-free)
8. [Deployment — frontend on Vercel (free)](#8-deployment--frontend-on-vercel-free)
9. [Updating a deployed system](#9-updating-a-deployed-system)
10. [Adding a new detection module](#10-adding-a-new-detection-module)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Architecture

```
┌───────────────────────┐        REST (JSON)        ┌──────────────────────────────┐
│  Next.js dashboard    │ ────────────────────────▶ │  FastAPI inference engine    │
│  (Vercel / any host)  │ ◀──────────────────────── │  (Docker, CPU-only)          │
│                       │     MJPEG video stream    │                              │
│  - use-case wizard    │                           │  - SessionManager (threads)  │
│  - live annotated view│                           │  - 4 pluggable modules       │
│  - stats panels       │                           │  - VideoSource (RTSP/file)   │
│  - history + charts   │                           │  - SQLite event store        │
└───────────────────────┘                           └──────────────────────────────┘
```

**Why two parts?** The AI models need Python, PyTorch and OpenCV — they cannot run on a
static-site host. So the *engine* runs anywhere Python/Docker runs (a cloud VM, an on-site
PC), and the *dashboard* is a lightweight web app that can be hosted anywhere and pointed
at any engine via one environment variable (`NEXT_PUBLIC_API_URL`).

**How an analysis session works** (the core flow, `backend/app/core/session_manager.py`):

1. The dashboard calls `POST /api/sessions` with `{use_case, source_type, source}`.
2. The engine opens the video source and loads the module's model, then starts a
   background thread.
3. The thread loop: grab frame → downscale → run the module → draw annotations →
   publish JPEG (for the MJPEG stream) → write events to SQLite → sleep to hold
   `ANALYSIS_FPS`.
4. The dashboard shows `GET /api/sessions/{id}/stream` (live annotated MJPEG) and polls
   `GET /api/sessions/{id}/stats` + `GET /api/events`.

**CPU-friendliness — the key design decisions:**

- Analysis runs at a **low, configurable FPS** (default 2/s) — enough for attendance,
  compliance, idle detection and gate ANPR, and light enough for any modern CPU.
- **Live streams never lag**: a dedicated grab thread keeps only the *newest* frame and
  throws the rest away, so slow inference can never fall behind a 25 FPS camera.
- **Recorded files are frame-skipped** to the same analysis rate.
- Frames are **downscaled** to `MAX_FRAME_WIDTH` (default 960 px) before inference.

## 2. Repository layout

```
backend/
  app/
    main.py               FastAPI app + lifespan (DB init, session shutdown)
    api.py                all REST routes
    config.py             every setting, env-overridable — the single source of config
    database.py           thread-safe SQLite store (sessions + events tables)
    core/
      video_source.py     RTSPSource (frame-dropping) / FileSource (frame-skipping) / BrowserSource (frames pushed by the viewer's browser)
      session_manager.py  AnalysisSession threads, MJPEG generator, concurrency cap
    modules/
      __init__.py         module registry (use-case key → class + title)
      base.py             BaseModule interface + shared drawing helpers
      face_attendance.py  ppe.py  activity.py  anpr.py
  models/                 *.pt model weights (baked into the Docker image)
  demo_videos/            bundled demo clips
  faces_db/               one folder per enrolled person (photos)
  data/                   runtime state: SQLite DB, uploads, embeddings cache (gitignored)
  Dockerfile              multi-arch (x86_64 + ARM64/aarch64)
  requirements.txt        all deps ship aarch64 wheels — no paddle
frontend/
  app/                    Next.js App Router pages (modules / session / faces / attendance / history / status)
  components/             Nav, module workspace views, start-analysis wizard + zone editor, custom SVG chart
  lib/api.js              API client + use-case catalog/colors/labels
docker-compose.yml        local full-stack development
deploy_modal.bat          one-command backend deploy to Modal (definition: backend/modal_app.py)
legacy/                   original prototype scripts (reference only)
```

## 3. Running locally

### Option A — Docker (runs everything incl. face recognition)

Prerequisite: Docker Desktop (Windows/macOS) or Docker Engine (Linux), and a machine
with **at least 8 GB RAM** — model inference inside the container needs ~2–3 GB; on
smaller machines the kernel OOM-kills the engine mid-session (use Option B there).

```bash
docker compose up --build
```

- Dashboard → http://localhost:3000
- API + interactive docs → http://localhost:8000/docs

First build takes ~10–15 min (downloads torch + tensorflow); later builds are cached.
The first face-recognition session also builds the embeddings cache (~1 min).

### Option B — bare processes (fast dev loop, all 4 modules)

```bash
# Backend — always use a virtual environment
cd backend
python -m venv .venv
.venv\Scripts\activate                      # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# Frontend (second terminal)
cd frontend
npm install
copy .env.example .env.local                # sets NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                                 # http://localhost:3000
```

## 4. Configuration reference

All backend settings live in `backend/app/config.py` and are overridable via environment
variables (see `backend/.env.example`). The important ones:

| Variable | Default | Meaning |
|---|---|---|
| `ANALYSIS_FPS` | `2` | Frames analysed per second — the main CPU-load knob |
| `MAX_FRAME_WIDTH` | `960` | Downscale frames wider than this before inference |
| `MAX_CONCURRENT_SESSIONS` | `2` | Parallel analyses allowed on one engine |
| `MAX_UPLOAD_MB` | `500` | Upload size limit |
| `CORS_ORIGINS` | `*` | **Set to your dashboard URL in production** (comma-separated) |
| `FACE_THRESHOLD` | `0.4` | Cosine distance for a face match — lower = stricter |
| `ATTENDANCE_GAP_MIN` | `5` | Minutes away before a person is logged as checked-in again |
| `UNKNOWN_FACE_COOLDOWN_S` | `30` | Dedupe window for unknown-face events |
| `PPE_VIOLATION_PREFIXES` | `no,without` | Class-name prefixes treated as violations |
| `PPE_NEUTRAL_CLASSES` | `person` | Classes excluded from compliance math |
| `PPE_CONFIDENCE` | `0.4` | Minimum detection confidence for PPE |
| `VIOLATION_COOLDOWN_S` | `10` | Dedupe window per violation class |
| `IDLE_SECONDS` | `10` | Stillness duration before a worker counts as idle |
| `MOVEMENT_THRESHOLD` | `5.0` | Pixel displacement below which a person is "still" |
| `OCR_LANGS` | `en` | EasyOCR language codes |
| `PLATE_COOLDOWN_S` | `60` | Same plate seen again within this window = same visit, not re-logged |
| `PLATE_MIN_CHARS` / `PLATE_MAX_CHARS` | `3` / `10` | Reads outside this length are rejected as garbage |
| `PLATE_OCR_MIN_CONF` | `0.3` | OCR fragments below this confidence are dropped |
| `PLATE_OCR_UPSCALE_W` | `120` | Plate crops narrower than this are 2×-upscaled before OCR |
| `PLATE_MATCH_RATIO` | `0.6` | Text similarity for two reads to count as the same plate |
| `PLATE_TRACK_MAX_DIST` | `0.2` | Spatial track-match limit (fraction of frame width) |
| `PLATE_TRACK_TTL_S` | `3` | Plate unseen for this long → visit over, event logged |
| `PLATE_CONFIRM_READS` | `2` | Reads needed before logging a vehicle that stays in view |
| `PLATE_LOG_MAX_WAIT_S` | `10` | A vehicle still in view after this long gets logged anyway |
| `PLATE_SINGLE_READ_CONF` | `0.5` | A visit backed by a single read needs at least this confidence |
| `PLATE_THUMB_W` | `160` | Width (px) of the plate thumbnail stored with each event |
| `MODELS_DIR` / `DATA_DIR` / `DEMO_DIR` / `FACES_DIR` | baked paths | Only override for custom layouts |

Frontend has exactly one variable: `NEXT_PUBLIC_API_URL` — the engine's base URL
(no trailing slash). It is baked in at **build time**.

## 5. Using the system

1. **Dashboard → New Analysis**: pick a use case → pick a source (upload / **Use my
   camera** — streams your own phone/laptop camera to the engine, no setup / RTSP URL) →
   **Start analysis**.
2. Watch the live annotated feed. The right-hand panel is use-case specific:
   attendance log, compliance % and per-class counts, active/idle table, or vehicle log.
3. **History** page: search and filter every event across all sessions, see the
   events-per-hour chart, **export CSV**.

### Enrolling faces (People page)

**Dashboard → People**: type the person's name, select several photos in one go
(different angles → better recognition), click **Enroll person**. The photos are stored
one-folder-per-person and the embeddings cache is **rebuilt automatically**, so the
person is recognized in the next session — no manual steps:

```
backend/faces_db/
  Jane Doe/          ← the folder name is the label shown on recognition
    front.jpg
    side.jpg
```

Anyone not enrolled is labeled **Unknown** and logged as an `unknown_face` event
(deduped by `UNKNOWN_FACE_COOLDOWN_S`). The People page also lists every identity
with photo counts, per-person delete, and a manual rebuild button.

Equivalent API: `POST /api/faces/{name}` (multipart images; auto-rebuilds — pass
`?rebuild=false` to skip), `DELETE /api/faces/{name}`, `POST /api/faces/rebuild`.
On an engine without deepface/tensorflow, enrollment still saves photos and reports
`rebuilt: false`; run the rebuild later on a full engine.

### Attendance dashboard

**Dashboard → Attendance**: cross-session attendance built from recognition events —
per day: who was present, **arrival time** (first detection), last seen, check-in
count; plus an **unknown-faces log** linking each detection to its session. Filter by
**person** and **date range** (Today / Last 7 days / All time presets).

### License plates (ANPR module)

**One event per vehicle visit, not per read.** The module tracks each vehicle across
frames and accumulates OCR reads as votes: partial reads merge into fuller ones
("ABC12" folds into "ABC123"), fuzzy-similar reads support the same candidate, and
obviously bad reads (too short/long, low confidence) are rejected. The event is logged
when the vehicle leaves view (or lingers past `PLATE_LOG_MAX_WAIT_S`), carrying the
**best-supported reading**, the **detection zone**, first/last-seen times and a small
**plate thumbnail**. A plate re-appearing within `PLATE_COOLDOWN_S` is treated as the
same visit.

**Detection zones (optional).** When starting an ANPR analysis, click
**Load preview & draw zones**, then **drag rectangles directly on the preview frame**
— e.g. one zone over the entry lane, one over the exit — and name each one. Plates
outside your zones are ignored; every event records the zone it was detected in, and
the session's vehicle log can be filtered per zone. Draw nothing to analyse the whole
frame.

The session page shows the live vehicle log (thumbnail, plate, zone, first seen,
confidence, read count) plus vehicles currently being read; the same table remains
available after the session ends.

## 6. API reference

Interactive documentation at **`/docs`** (Swagger UI). Summary:

| Method + path | Purpose |
|---|---|
| `GET /api/health` | liveness check |
| `GET /api/usecases` | the four modules with titles/descriptions |
| `GET /api/demos` · `GET /api/videos` | list demo clips / uploaded videos |
| `POST /api/videos` | upload a recording (multipart `file`) |
| `POST /api/preview` | one frame of a source as JPEG (for drawing zones): `{source_type, source}` |
| `POST /api/sessions` | start an analysis: `{use_case, source_type: rtsp\|upload\|demo\|browser, source, zones?}` — `zones` is an optional list of `{label, x, y, w, h}` rects normalized to 0–1 (ANPR) |
| `POST /api/sessions/{id}/frames` | push one camera frame (JPEG request body) into a `browser` session — used by the dashboard's “Use my camera” source; the session ends after `BROWSER_FRAME_TIMEOUT_S` without frames |
| `GET /api/sessions` | running + recent sessions |
| `GET /api/sessions/{id}` · `POST /api/sessions/{id}/stop` | inspect / stop |
| `GET /api/sessions/{id}/stream` | **live annotated MJPEG** (`multipart/x-mixed-replace`) |
| `GET /api/sessions/{id}/snapshot` | latest annotated frame as JPEG |
| `GET /api/sessions/{id}/stats` | use-case-specific live stats for the side panel |
| `GET /api/events` | search events: `session_id, use_case, type, q, hours, limit, offset` |
| `GET /api/events/export` | CSV download (same filters) |
| `GET /api/stats/summary?hours=24` | events-per-hour buckets for the chart |
| `GET/POST/DELETE /api/faces/{name}` · `POST /api/faces/rebuild` | face enrollment; enroll/delete auto-rebuild embeddings (see §5) |
| `GET /api/attendance` | per-day attendance + unknown-face log: `person, date_from, date_to` (YYYY-MM-DD) |

Events are stored in SQLite (`backend/data/visionguard.db`, WAL mode) with schema
`events(session_id, use_case, type, label, confidence, ts, extra JSON)`.

---

## 7. Deployment — backend in the cloud (free)

Two free options:

| | Option A — Modal | Option B — Oracle Cloud VM |
|---|---|---|
| Cost | **$30/month free credits, no card ever** | free, card needed for identity check |
| Hardware | 2 vCPU / 8 GB, sleeps when idle | up to 4 OCPU / 24 GB RAM (ARM64), always on |
| HTTPS | built in | DIY (DuckDNS + Caddy) |
| Storage | persistent Volume (event DB backed up per minute) | persistent (Docker volume) |
| Best for | demos, client testing | 24/7 production |

(Hugging Face Spaces used to be the free no-card option, but since 2026 Docker
Spaces require a PRO subscription for new accounts.)

> **Reality check for live cameras:** a cloud engine can only *pull* RTSP from
> cameras reachable *from the internet* (public IP / DDNS / VPN). Anyone can still
> test live with the dashboard's **“Use my camera”** source — the browser pushes
> phone/laptop camera frames to the engine, which works behind any NAT. For
> cameras on a private site LAN, run this same Docker image on any on-site PC
> instead — the dashboard works identically, just point `NEXT_PUBLIC_API_URL` at it.

### 7.1 Option A — Modal (free, no card)

> **Current live setup:** the engine is deployed at
> **https://asadmayo42--visionguard.modal.run** (Modal workspace `asadmayo42`,
> app `visionguard`), and the Vercel frontend points at it via
> `NEXT_PUBLIC_API_URL`. Update it any time with `deploy_modal.bat`.

[Modal](https://modal.com) runs the engine as a serverless container:
**$30 of compute credits every month on the free Starter plan, no card**,
sign-in via GitHub or Google. The engine sleeps when nobody uses it (credits
don't drain) and wakes on the first request, so the monthly credits cover
**~150+ hours of actual testing** — and they reset every month.
`backend/modal_app.py` defines the whole deployment:

1. Sign up at [modal.com](https://modal.com) (GitHub/Google — no card).
2. One-time login from this machine: **`deploy_modal.bat setup`** (opens a browser).
3. Deploy: **`deploy_modal.bat`** — the first run builds the image remotely
   (~10–15 min: torch + tensorflow + baked model weights); code-only updates
   later deploy in seconds thanks to layer caching.
4. The engine URL is printed at the end —
   **`https://<workspace>--visionguard.modal.run`** — open `/api/health` to
   verify, then use it as `NEXT_PUBLIC_API_URL` (§8).

Behavior to know about:

- **Cold start**: the first request after an idle period takes ~30–60 s while
  the container boots; after that it's normal speed. It sleeps again 5 min
  after the last request (`scaledown_window`).
- **Persistence**: enrolled faces, uploads and the embeddings cache live on a
  Modal Volume and survive restarts. The SQLite event DB runs on local disk
  (SQLite is unsafe on network volumes) and is backed up to the Volume every
  minute — at worst the last minute of events is lost on scale-down.
- Long MJPEG streams are capped at 1 h per connection (`timeout`); reload the
  session page to reconnect.

### 7.2 Option B — Oracle Cloud VM

An Ampere A1 VM in Oracle's **Always Free** tier — permanently free, and plenty for
this workload. All Python dependencies ship aarch64 wheels (this is why the project
uses EasyOCR instead of PaddleOCR).

#### Create the VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (card needed for identity
   verification — not charged for Always Free resources).
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 22.04** (aarch64)
   - Shape: **VM.Standard.A1.Flex** → 4 OCPUs, 24 GB RAM (max Always Free)
   - Paste your **SSH public key**
3. Create, wait for *Running*, note the **public IP**.

> **"Out of capacity"?** Ampere instances are popular. Try a different availability
> domain, reduce to 2 OCPU/12 GB, or retry later (early morning works best). Once
> created, the instance is yours to keep.

#### Open the firewall — BOTH layers

Oracle has a **cloud firewall (Security List)** *and* the **OS firewall (iptables)**.
Traffic must pass both — forgetting one is the #1 deployment problem.

**Cloud layer** — Console → Instance → *Virtual Cloud Network* → *Security Lists* →
*Default Security List* → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest. port | Purpose |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | HTTPS certificate issuance |
| `0.0.0.0/0` | TCP | `443` | HTTPS API |
| `0.0.0.0/0` | TCP | `8000` | direct API (optional, for testing) |

**OS layer** — SSH in (`ssh ubuntu@<PUBLIC_IP>`) and run:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443,8000 -j ACCEPT
sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```

#### Install Docker and deploy the engine

```bash
# On the VM
sudo apt update && sudo apt install -y docker.io
sudo usermod -aG docker $USER && newgrp docker

# Get the code (either)
git clone https://github.com/<your-user>/<your-repo>.git app && cd app/backend
# ...or copy from your machine:  scp -r AGS ubuntu@<PUBLIC_IP>:~/app

# Build and run
docker build -t visionguard .
docker run -d --name visionguard --restart unless-stopped \
  -p 8000:8000 \
  -v visionguard_data:/app/data \
  -e CORS_ORIGINS="https://<your-app>.vercel.app" \
  visionguard
```

Verify:

```bash
curl http://localhost:8000/api/health          # on the VM
curl http://<PUBLIC_IP>:8000/api/health        # from your laptop
```

Both must return `{"status":"ok"}`. If the second fails, re-check the firewall step above.

#### HTTPS — required before connecting the Vercel frontend

Browsers **block** an `https://` page (your Vercel dashboard) from calling a plain
`http://` API ("mixed content"). Give the engine a domain + TLS certificate — free:

1. **Free subdomain** — at [duckdns.org](https://www.duckdns.org) create e.g.
   `myvisionguard.duckdns.org` and set it to your VM's public IP.
2. **Caddy reverse proxy** (automatic Let's Encrypt certificates):

   ```bash
   sudo apt install -y caddy
   echo 'myvisionguard.duckdns.org {
     reverse_proxy localhost:8000
   }' | sudo tee /etc/caddy/Caddyfile
   sudo systemctl restart caddy
   ```

3. Test: `https://myvisionguard.duckdns.org/api/health` from any browser.

Your production API base URL is now **`https://myvisionguard.duckdns.org`**.

---

## 8. Deployment — frontend on Vercel (free)

> **Current live setup:** the dashboard is deployed at
> **https://visionguard-eta.vercel.app** — Vercel project `visionguard`, connected to
> the GitHub repo `Asad-Mhmood/Argus-AI` with **Root Directory = `frontend`**.
> Every push to `main` auto-deploys production.

### 8.1 One-time setup (from scratch)

1. Push the repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New… → Project** → import the repo.
   (If the repo isn't listed: link GitHub under *Account Settings → Authentication →
   Login Connections*, then install the **Vercel GitHub App** on the repo at
   github.com/apps/vercel.)
3. **Root Directory:** `frontend` — *this is the critical setting*: the repo root also
   contains the backend, so builds fail without it. Set it under *Project Settings →
   Build and Deployment → Root Directory*. The framework preset (Next.js) is then
   auto-detected.
4. **Environment variable** (baked in at build time — changing it needs a redeploy):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | your engine's HTTPS URL, e.g. `https://asadmayo42--visionguard.modal.run` |

5. **Deploy.** You'll get `https://<project>.vercel.app`.
6. **Close the CORS loop** — the backend must allow the dashboard's origin.
   (Modal engine: nothing to do — it ships with the default `CORS_ORIGINS=*`.) On a VM:

   ```bash
   docker rm -f visionguard
   docker run -d --name visionguard --restart unless-stopped \
     -p 8000:8000 -v visionguard_data:/app/data \
     -e CORS_ORIGINS="https://<project>.vercel.app" \
     visionguard
   ```

7. Open the dashboard — the nav bar should show **“Engine online.”**

### 8.2 Deploying updates

- **Automatic:** push to `main` → Vercel builds and promotes production
  (~1 min; watch it on the project's *Deployments* tab).
- **Manual (no git trigger needed):** `cd frontend && vercel deploy --prod`.
  Always run it **from the `frontend` folder** — deploying from the repo root makes the
  CLI detect "services" and generate a broken `vercel.json`.

### 8.3 Quick public demo — no cloud VM needed

The engine can run on any local machine and be exposed with a free Cloudflare quick
tunnel; the Vercel dashboard connects to it per-browser:

1. Run **`start_demo.bat`** (repo root). It opens two windows: the venv engine on
   port 8000 and `cloudflared`, which prints a public URL like
   `https://random-words.trycloudflare.com` (scroll to the top of that window).
2. Open the Vercel dashboard → **⚙ Engine** (top right) → paste the tunnel URL →
   **Save & reload**. This browser-local override beats the build-time
   `NEXT_PUBLIC_API_URL`; *Reset to default* removes it.
3. The tunnel URL **changes on every restart** — re-paste it each demo session.

Tunnel traffic is HTTPS, so no mixed-content problem, and the backend's default
`CORS_ORIGINS=*` accepts the Vercel origin.

### Deployment checklist

- [ ] Engine reachable over **HTTPS**: `https://<domain>/api/health` in a browser
      (Oracle path: also `curl http://<PUBLIC_IP>:8000/api/health` first)
- [ ] Vercel Root Directory = `frontend`
- [ ] Vercel env `NEXT_PUBLIC_API_URL` = the **https** engine URL (no trailing slash) —
      or the tunnel URL pasted in ⚙ Engine for demos
- [ ] Backend `CORS_ORIGINS` = the exact Vercel URL (scheme + host, no trailing slash)
- [ ] Dashboard nav shows *Engine online*; an uploaded-video session streams live

---

## 9. Updating a deployed system

**Backend** (Modal): re-run `deploy_modal.bat` — code-only changes deploy in seconds
(the image layers are cached; only dependency changes trigger a rebuild).

**Backend** (on the VM):

```bash
cd ~/app && git pull
cd backend && docker build -t visionguard .
docker rm -f visionguard
docker run -d --name visionguard --restart unless-stopped \
  -p 8000:8000 -v visionguard_data:/app/data \
  -e CORS_ORIGINS="https://<project>.vercel.app" visionguard
```

The named volume `visionguard_data` preserves the event database, uploads and face
embeddings across updates.

**Frontend**: just `git push` to `main` — the repo is connected to Vercel, so every push
redeploys production automatically (manual fallback: `cd frontend && vercel deploy --prod`).
Changing `NEXT_PUBLIC_API_URL` requires a **redeploy** (it's baked at build time).

## 10. Adding a new detection module

1. Create `backend/app/modules/<name>.py` implementing `BaseModule`
   (`process_frame(frame, ts) -> (annotated_frame, events)`, `get_stats() -> dict`).
   Keep heavy imports (torch, model load) inside `__init__`, not at module top level.
2. Register it in `backend/app/modules/__init__.py` → `_REGISTRY` (key, class name,
   title, description).
3. Add the use-case color + label in `frontend/lib/api.js` (and a matching CSS variable
   in `frontend/app/globals.css`).
4. Optional: a dedicated stats panel in `frontend/app/session/[id]/page.jsx`.

Events you emit (`{type, label, confidence?, extra?}`) are persisted, searchable,
charted and exported automatically.

## 11. Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Dashboard says *Engine offline* | Wrong `NEXT_PUBLIC_API_URL`, CORS not set, or engine down. Check browser dev-tools console: CORS errors name the missing origin. |
| Works via IP, fails from Vercel | Mixed content — you're calling `http://` from an `https://` page. Do §7.4. |
| `curl http://<IP>:8000` times out | One of the two firewall layers (§7.2) is closed. |
| Face session returns 503 | deepface/tensorflow not installed in the environment — `pip install tensorflow tf-keras deepface`. Only the face module is affected. |
| First ANPR session very slow to start | EasyOCR downloads its OCR models (~100 MB) once; subsequent sessions are fast. |
| "Maximum concurrent sessions reached" | Stop a session or raise `MAX_CONCURRENT_SESSIONS` (watch CPU). |
| RTSP session errors immediately | URL wrong/unreachable *from the engine machine*. Test with VLC on that machine first. |
| Docker engine restarts mid-session, no error in logs | Out-of-memory kill — the host gives Docker too little RAM (needs ~2–3 GB free for inference). Run the bare-Python engine instead, or use a machine with ≥8 GB. |
| Oracle "Out of capacity" | See §7.1 tip — retry, smaller shape, or another availability domain. |
| Video chops/stutters in live view | That's expected: analysis runs at `ANALYSIS_FPS` (2/s). Raise it if your CPU allows. |
