# VisionGuard AI backend — works on x86_64 and aarch64 (Oracle Ampere) alike.
FROM python:3.11-slim

# Minimal system libs for opencv-headless / torch runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies in separate layers so a failed download resumes from the
# last completed layer instead of restarting everything. Torch comes from the
# CPU-only index: ~200 MB instead of the 3+ GB CUDA build pip would pull on amd64.
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 180 --retries 10 \
        torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --timeout 180 --retries 10 tensorflow tf-keras
RUN pip install --no-cache-dir --timeout 180 --retries 10 -r requirements.txt

# Application code + bundled assets
COPY app ./app
COPY models ./models
COPY demo_videos ./demo_videos
COPY faces_db ./faces_db

# Writable state (SQLite DB, uploads, embedding cache) lives in /app/data — mount a volume here
ENV DATA_DIR=/app/data

# Non-root user (required by Hugging Face Spaces, good practice everywhere).
# HOME must be writable: ultralytics/easyocr/deepface cache models under $HOME.
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app
ENV HOME=/home/appuser
USER appuser

# Bake runtime model downloads into the image (EasyOCR ~100MB, ArcFace ~130MB)
# so first sessions start instantly and containers work offline.
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False)" \
    && python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -sf http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
