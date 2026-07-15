# VisionGuard AI backend — works on x86_64 and aarch64 (Oracle Ampere) alike.
FROM python:3.11-slim

# Minimal system libs for opencv-headless / torch runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + bundled assets
COPY app ./app
COPY models ./models
COPY demo_videos ./demo_videos
COPY faces_db ./faces_db

# Writable state (SQLite DB, uploads, embedding cache) lives in /app/data — mount a volume here
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -sf http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
