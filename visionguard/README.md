# VisionGuard AI

AI video surveillance platform with four pluggable analytics modules, a FastAPI
inference engine, and a Next.js dashboard.

| Module | What it does |
|---|---|
| **Face Recognition / Attendance** | Recognizes enrolled faces, keeps an attendance log with in/out times |
| **PPE / Safety Compliance** | Detects safety-gear violations, tracks compliance rate |
| **Idle Worker / Activity** | Pose-based tracking, flags workers idle beyond a threshold |
| **License Plate Recognition** | Reads vehicle plates, logs each unique plate with time |

Every module accepts three video sources: **live IP camera (RTSP)**, **uploaded
recording**, or a **bundled demo video**. Analysis runs at a configurable low FPS
with frame-dropping, so everything works on CPU — no GPU required.

```
┌──────────────────────┐   REST + MJPEG   ┌─────────────────────────────┐
│ Next.js dashboard    │ ───────────────▶ │ FastAPI engine (CPU)        │
│ (Vercel / anywhere)  │                  │ YOLO · DeepFace · EasyOCR   │
└──────────────────────┘                  │ SQLite events · sessions    │
                                          └─────────────────────────────┘
```

## Repository layout

```
backend/
  app/
    main.py            FastAPI app
    api.py             REST routes
    config.py          all settings (env-overridable)
    database.py        SQLite event store
    core/
      video_source.py  RTSP (frame-dropping) / file / demo sources
      session_manager.py  threaded inference sessions + MJPEG
    modules/           one pluggable module per use case
  models/              *.pt weights
  demo_videos/         bundled demos
  faces_db/            one folder per enrolled person
  Dockerfile           ARM64 + x86_64 compatible
frontend/              Next.js dashboard
docker-compose.yml     local development
```

---

## 1 · Run locally

### With Docker (recommended)

```bash
cd visionguard
docker compose up --build
```

- Dashboard: http://localhost:3000
- API docs: http://localhost:8000/docs

First build takes a while (torch + tensorflow). The first face-recognition
session also builds the embedding cache (~1 min).

### Without Docker

```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend (second terminal)
cd frontend
npm install
copy .env.example .env.local                        # points at http://localhost:8000
npm run dev
```

---

## 2 · Deploy the backend on Oracle Cloud (Always Free)

The engine fits comfortably in Oracle's free **Ampere A1** shape (4 OCPU / 24 GB,
ARM64). All Python dependencies ship aarch64 wheels — no paddle anywhere.

### 2.1 Create the VM

1. Sign up at cloud.oracle.com, then **Compute → Instances → Create instance**.
2. Image: **Ubuntu 22.04 (aarch64)**. Shape: **VM.Standard.A1.Flex** — 4 OCPUs,
   24 GB (all within Always Free). If you see *Out of capacity*, try another
   availability domain or retry later; capacity frees up regularly.
3. Add your SSH public key, create, and note the **public IP**.

### 2.2 Open the firewall (both layers!)

Oracle has a cloud firewall *and* the OS firewall — you must open both.

- Console → your instance → **Virtual Cloud Network → Security Lists → Default**
  → **Add Ingress Rule**: source `0.0.0.0/0`, protocol TCP, destination port `8000`
  (and `80,443` if you set up HTTPS below).
- On the VM:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 8000 -j ACCEPT
  sudo netfilter-persistent save
  ```

### 2.3 Install Docker and deploy

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER && newgrp docker

# Get the code onto the VM (git clone, or from your machine:)
#   scp -r visionguard ubuntu@<PUBLIC_IP>:~
cd visionguard/backend
docker build -t visionguard .
docker run -d --name visionguard --restart unless-stopped \
  -p 8000:8000 \
  -v visionguard_data:/app/data \
  -e CORS_ORIGINS="https://your-app.vercel.app" \
  visionguard
```

Check: `curl http://<PUBLIC_IP>:8000/api/health` → `{"status":"ok"}`.

### 2.4 HTTPS (required for a Vercel frontend)

Browsers block an `https://` page from calling a plain `http://` API
(mixed content), so give the backend a free domain + TLS:

1. Get a free subdomain at **duckdns.org** pointing to your VM's public IP
   (e.g. `myvisionguard.duckdns.org`).
2. Run Caddy as an auto-HTTPS reverse proxy:
   ```bash
   sudo apt install -y caddy
   echo 'myvisionguard.duckdns.org {
     reverse_proxy localhost:8000
   }' | sudo tee /etc/caddy/Caddyfile
   sudo systemctl restart caddy
   ```
3. Open ports 80 + 443 in both firewalls (step 2.2).

Your API is now `https://myvisionguard.duckdns.org` — use that as
`NEXT_PUBLIC_API_URL`.

> **Live cameras & networks:** a cloud backend can only reach cameras that are
> reachable *from the internet*. For cameras on a private site LAN, run this same
> Docker image on any on-site PC instead — the dashboard works identically.

---

## 3 · Deploy the frontend on Vercel (free)

1. Push this repo to GitHub.
2. On vercel.com → **Add New Project** → import the repo.
3. **Root Directory:** `frontend` (Framework preset: Next.js — auto-detected).
4. Environment variable: `NEXT_PUBLIC_API_URL = https://myvisionguard.duckdns.org`
   (or `http://<PUBLIC_IP>:8000` if you'll only open the dashboard over http).
5. Deploy. Then make sure the backend's `CORS_ORIGINS` includes your Vercel URL.

CLI alternative: `cd frontend && npx vercel --prod`.

---

## 4 · Using the system

1. **Dashboard → New Analysis**: pick a use case, pick a source
   (demo video / upload / RTSP URL), press **Start analysis**.
2. Watch the live annotated feed; the side panel shows use-case specific stats
   (attendance log, compliance %, idle workers, vehicle log).
3. **History** page: filter and search all events, see events-per-hour, export CSV.

### Enrolling faces

Each person is a folder of photos under `backend/faces_db/`:

```
faces_db/
  Jane Doe/
    front.jpg
    side.jpg
```

Or via API: `POST /api/faces/{name}` with image files, then
`POST /api/faces/rebuild`. More photos per person → better recognition.

### Key settings (backend `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANALYSIS_FPS` | 2 | frames analysed per second (CPU load knob) |
| `MAX_CONCURRENT_SESSIONS` | 2 | parallel analyses |
| `CORS_ORIGINS` | * | set to your dashboard URL in production |
| `FACE_THRESHOLD` | 0.4 | lower = stricter face match |
| `IDLE_SECONDS` | 10 | stillness before a worker counts as idle |
| `PPE_VIOLATION_PREFIXES` | no,without | class-name prefixes that count as violations |
| `PLATE_COOLDOWN_S` | 60 | dedupe window for repeated plate reads |

Full list: `backend/.env.example`.

---

## API overview

Interactive docs at `/docs`. Highlights:

| Endpoint | Purpose |
|---|---|
| `POST /api/sessions` | start an analysis `{use_case, source_type, source}` |
| `GET /api/sessions/{id}/stream` | live annotated MJPEG |
| `GET /api/sessions/{id}/stats` | use-case specific live stats |
| `POST /api/sessions/{id}/stop` | stop a session |
| `POST /api/videos` | upload a recording |
| `GET /api/events` | search events (`q`, `use_case`, `hours`, …) |
| `GET /api/events/export` | CSV export |
| `POST /api/faces/{name}` / `rebuild` | face enrollment |
