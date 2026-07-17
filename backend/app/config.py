"""Central configuration. Every value can be overridden via environment variable."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_path(name: str, default: Path) -> Path:
    p = Path(os.getenv(name, str(default)))
    p.mkdir(parents=True, exist_ok=True)
    return p


# --- Directories ---
MODELS_DIR = _env_path("MODELS_DIR", BASE_DIR / "models")
DATA_DIR = _env_path("DATA_DIR", BASE_DIR / "data")
DEMO_DIR = _env_path("DEMO_DIR", BASE_DIR / "demo_videos")
FACES_DIR = _env_path("FACES_DIR", BASE_DIR / "faces_db")
UPLOADS_DIR = _env_path("UPLOADS_DIR", DATA_DIR / "uploads")

DB_PATH = Path(os.getenv("DB_PATH", str(DATA_DIR / "visionguard.db")))

# --- Model files ---
FACE_MODEL = os.getenv("FACE_MODEL", str(MODELS_DIR / "yolov12s-face.pt"))
PPE_MODEL = os.getenv("PPE_MODEL", str(MODELS_DIR / "hse11s.pt"))
POSE_MODEL = os.getenv("POSE_MODEL", str(MODELS_DIR / "yolov8n-pose.pt"))
PLATE_MODEL = os.getenv("PLATE_MODEL", str(MODELS_DIR / "license_plate_detector.pt"))

# --- Runtime / performance (CPU-friendly defaults) ---
ANALYSIS_FPS = float(os.getenv("ANALYSIS_FPS", "2"))          # inference rate
STREAM_FPS = float(os.getenv("STREAM_FPS", "10"))             # MJPEG push rate
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "80"))
MAX_FRAME_WIDTH = int(os.getenv("MAX_FRAME_WIDTH", "960"))    # downscale before inference
MAX_CONCURRENT_SESSIONS = int(os.getenv("MAX_CONCURRENT_SESSIONS", "2"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "500"))
BROWSER_FRAME_TIMEOUT_S = float(os.getenv("BROWSER_FRAME_TIMEOUT_S", "30"))  # browser-camera session ends after this long without a pushed frame

# --- Module tuning ---
FACE_THRESHOLD = float(os.getenv("FACE_THRESHOLD", "0.4"))            # cosine distance
FACE_EMBED_MODEL = os.getenv("FACE_EMBED_MODEL", "ArcFace")
ATTENDANCE_GAP_MIN = float(os.getenv("ATTENDANCE_GAP_MIN", "5"))      # re-log after N min away
UNKNOWN_FACE_COOLDOWN_S = float(os.getenv("UNKNOWN_FACE_COOLDOWN_S", "30"))  # dedupe unknown-face events
PPE_VIOLATION_PREFIXES = [
    p.strip().lower()
    for p in os.getenv("PPE_VIOLATION_PREFIXES", "no,without").split(",")
    if p.strip()
]
PPE_NEUTRAL_CLASSES = [
    c.strip().lower()
    for c in os.getenv("PPE_NEUTRAL_CLASSES", "person").split(",")
    if c.strip()
]
PPE_CONFIDENCE = float(os.getenv("PPE_CONFIDENCE", "0.4"))
VIOLATION_COOLDOWN_S = float(os.getenv("VIOLATION_COOLDOWN_S", "10"))
IDLE_SECONDS = float(os.getenv("IDLE_SECONDS", "10"))                 # stillness → idle
MOVEMENT_THRESHOLD = float(os.getenv("MOVEMENT_THRESHOLD", "5.0"))    # px displacement
PLATE_COOLDOWN_S = float(os.getenv("PLATE_COOLDOWN_S", "60"))         # same plate = same visit within this window
PLATE_MIN_CHARS = int(os.getenv("PLATE_MIN_CHARS", "3"))
PLATE_MAX_CHARS = int(os.getenv("PLATE_MAX_CHARS", "10"))              # reject longer (garbage) reads
PLATE_OCR_MIN_CONF = float(os.getenv("PLATE_OCR_MIN_CONF", "0.3"))     # drop OCR fragments below this
PLATE_OCR_UPSCALE_W = int(os.getenv("PLATE_OCR_UPSCALE_W", "120"))     # 2x-upscale narrower crops before OCR
PLATE_MATCH_RATIO = float(os.getenv("PLATE_MATCH_RATIO", "0.6"))       # text similarity to treat reads as one plate
PLATE_TRACK_MAX_DIST = float(os.getenv("PLATE_TRACK_MAX_DIST", "0.2")) # spatial match limit (fraction of frame width)
PLATE_TRACK_TTL_S = float(os.getenv("PLATE_TRACK_TTL_S", "3"))         # unseen for this long = visit over, log it
PLATE_CONFIRM_READS = int(os.getenv("PLATE_CONFIRM_READS", "2"))       # reads needed to log a still-present vehicle
PLATE_SINGLE_READ_CONF = float(os.getenv("PLATE_SINGLE_READ_CONF", "0.5"))  # lone unconfirmed read needs this conf
PLATE_LOG_MAX_WAIT_S = float(os.getenv("PLATE_LOG_MAX_WAIT_S", "10"))  # log a still-present vehicle after this long
PLATE_THUMB_W = int(os.getenv("PLATE_THUMB_W", "160"))                 # plate thumbnail width (px) stored on events
OCR_LANGS = [l.strip() for l in os.getenv("OCR_LANGS", "en").split(",") if l.strip()]

# --- API ---
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
