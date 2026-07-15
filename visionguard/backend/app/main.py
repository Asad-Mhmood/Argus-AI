"""VisionGuard AI — video analytics backend.

Run locally:   uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, database
from .api import router
from .core.session_manager import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield
    manager.shutdown()


app = FastAPI(
    title="VisionGuard AI",
    description="Multi-use-case AI video surveillance: attendance, PPE compliance, "
                "activity monitoring and license plate recognition.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
