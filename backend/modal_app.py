"""Run the VisionGuard engine on Modal (https://modal.com) — free Starter plan.

One-time setup (opens a browser to log in):
    deploy_modal.bat setup
Deploy / update:
    deploy_modal.bat

How it behaves on Modal:
- Scales to zero when idle (no credit burn) and wakes on the first request
  (~30-60 s cold start; model downloads are baked into the image).
- Enrolled faces, uploads and the face-embeddings cache live on a persistent
  Volume. The SQLite event DB runs on container-local disk (SQLite is unsafe
  on network volumes) and is backed up to the Volume every minute and restored
  on cold start — so at most the last minute of events can be lost.
- max_containers=1 because sessions are in-memory state: every request must
  reach the same engine instance.
"""
from pathlib import Path

import modal

HERE = Path(__file__).parent

app = modal.App("visionguard")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0", "libgl1", "libgomp1")
    # CPU-only torch: ~200 MB instead of the multi-GB CUDA build
    .pip_install("torch", "torchvision", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("tensorflow", "tf-keras")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    # bake runtime model downloads (EasyOCR ~100 MB, ArcFace ~130 MB) into the
    # image so cold starts don't re-download them
    .run_commands(
        "python -c \"import easyocr; easyocr.Reader(['en'], gpu=False)\"",
        "python -c \"from deepface import DeepFace; DeepFace.build_model('ArcFace')\"",
    )
    .add_local_dir(HERE / "app", "/root/app", ignore=["**/__pycache__"])
    .add_local_dir(HERE / "models", "/root/models")
    .add_local_dir(HERE / "demo_videos", "/root/demo_videos")
    .add_local_dir(HERE / "faces_db", "/root/faces_db_seed")
)

data_volume = modal.Volume.from_name("visionguard-data", create_if_missing=True)

DB_LOCAL = Path("/root/db/visionguard.db")
DB_BACKUP = Path("/data/db_backup/visionguard.db")


@app.function(
    image=image,
    cpu=2,
    memory=8192,
    volumes={"/data": data_volume},
    scaledown_window=300,  # sleep 5 min after the last request
    max_containers=1,
    timeout=3600,  # allow long MJPEG streaming requests
)
@modal.concurrent(max_inputs=50)
@modal.asgi_app(label="visionguard")
def engine():
    import os
    import shutil
    import sqlite3
    import threading
    import time

    # app.config reads env at import time — set everything before importing
    os.environ["DATA_DIR"] = "/data"  # uploads + embeddings cache persist
    os.environ["FACES_DIR"] = "/data/faces_db"
    os.environ["DB_PATH"] = str(DB_LOCAL)

    # seed the enrolled-faces folder from the bundled photos on first ever boot
    faces = Path("/data/faces_db")
    faces.mkdir(parents=True, exist_ok=True)
    if not any(faces.iterdir()):
        shutil.copytree("/root/faces_db_seed", faces, dirs_exist_ok=True)

    # restore the event DB from the last backup after a cold start
    DB_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    if not DB_LOCAL.exists() and DB_BACKUP.exists():
        shutil.copy2(DB_BACKUP, DB_LOCAL)

    from app.main import app as fastapi_app

    def backup_loop():
        while True:
            time.sleep(60)
            try:
                if DB_LOCAL.exists():
                    DB_BACKUP.parent.mkdir(parents=True, exist_ok=True)
                    src = sqlite3.connect(DB_LOCAL)
                    dst = sqlite3.connect(DB_BACKUP)
                    with dst:
                        src.backup(dst)
                    src.close()
                    dst.close()
                    data_volume.commit()
            except Exception:
                pass  # a failed backup must never take the engine down

    threading.Thread(target=backup_loop, daemon=True).start()
    return fastapi_app
