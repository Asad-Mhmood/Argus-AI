"""Module registry — each use case is a pluggable BaseModule implementation.

Modules are imported lazily so a missing optional dependency (e.g. tensorflow
for face recognition) only disables that one use case, not the whole API.
"""
from importlib import import_module

from .base import BaseModule

_REGISTRY = {
    "face_attendance": (
        ".face_attendance", "FaceAttendanceModule",
        "Face Recognition / Attendance",
        "Recognizes enrolled faces and keeps an attendance log with in/out times.",
    ),
    "ppe": (
        ".ppe", "PPEModule",
        "PPE / Safety Compliance",
        "Detects safety-gear violations (missing helmet, vest, ...) and tracks compliance rate.",
    ),
    "activity": (
        ".activity", "ActivityModule",
        "Idle Worker / Activity Detection",
        "Tracks people via pose keypoints and flags workers idle beyond a threshold.",
    ),
    "anpr": (
        ".anpr", "ANPRModule",
        "License Plate Recognition (ANPR)",
        "Detects and reads vehicle license plates, logging each unique plate with time.",
    ),
}


def list_use_cases() -> list[dict]:
    return [
        {"key": key, "title": title, "description": desc}
        for key, (_, _, title, desc) in _REGISTRY.items()
    ]


def create_module(key: str) -> BaseModule:
    if key not in _REGISTRY:
        raise ValueError(f"Unknown use case: {key}")
    mod_path, cls_name, title, desc = _REGISTRY[key]
    cls = getattr(import_module(mod_path, package=__name__), cls_name)
    instance = cls()
    instance.key, instance.title, instance.description = key, title, desc
    return instance
