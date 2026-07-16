---
title: VisionGuard AI Engine
emoji: 🎥
colorFrom: blue
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

# VisionGuard AI — inference engine

FastAPI backend for the VisionGuard AI video surveillance platform:
face attendance, PPE compliance, idle-worker detection and license plate
recognition on CPU.

- Interactive API docs: `/docs`
- Health check: `/api/health`
- Dashboard frontend: deployed separately (Vercel), pointed here via
  `NEXT_PUBLIC_API_URL`.

Full project documentation lives in the main repository README.

**Note (Hugging Face Spaces):** storage is ephemeral on the free tier — the
event database, uploads and face-embedding cache reset when the Space restarts.
Fine for demos; for persistent production use, run this same image on a VM.
