# Legacy scripts

Original standalone prototypes that VisionGuard AI was built from. Kept for
reference — everything here has been superseded by `../visionguard/`:

| File | Became |
|---|---|
| `face_detection.py` | `visionguard/backend/app/modules/face_attendance.py` |
| `hse.py` | `visionguard/backend/app/modules/ppe.py` |
| `activity_detection.py` | `visionguard/backend/app/modules/activity.py` |
| `number_plate_detection.py` | `visionguard/backend/app/modules/anpr.py` |
| `person.py`, `test.py` | experiments (COCO detection, age estimation) — not ported |
| `yolo11mcoco.pt` | generic COCO model, unused by VisionGuard |
| `face_embeddings.json` | old cache; VisionGuard rebuilds its own in `backend/data/` |

Model weights and the demo video now live in `visionguard/backend/models/`
and `visionguard/backend/demo_videos/`.
