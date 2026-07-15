# Multiple face samples per user
# ArcFace model for robust embeddings

from ultralytics import YOLO
from deepface import DeepFace
import cv2
import os
import numpy as np
import json

# =====================================================
# CONFIGURATION
# =====================================================
MODEL_PATH = "yolov12s-face.pt"
FACES_DIR = "faces_db"           # Each subfolder = person name
CACHE_FILE = "face_embeddings.json"
THRESHOLD = 0.4                  # Smaller = stricter match
USE_WEBCAM = True                # Set False for single-image testing
TEST_IMAGE_PATH = "test_image.jpg"

# Initialize YOLO model
model = YOLO(MODEL_PATH)


# =====================================================
# UTILS
# =====================================================
def cosine_distance(a, b):
    """Compute cosine distance between two embeddings."""
    a = np.array(a)
    b = np.array(b)
    return 1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


# =====================================================
# LOAD OR BUILD FACE DATABASE (with multi-sample support)
# =====================================================
def build_or_load_database():
    if os.path.exists(CACHE_FILE):
        print("📂 Loading cached embeddings...")
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    else:
        print("🧠 Building face database using ArcFace...")
        known_faces = {}

        for person_name in os.listdir(FACES_DIR):
            person_path = os.path.join(FACES_DIR, person_name)
            if not os.path.isdir(person_path):
                continue

            embeddings = []
            for file in os.listdir(person_path):
                if file.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp")):
                    img_path = os.path.join(person_path, file)
                    try:
                        rep = DeepFace.represent(
                            img_path=img_path,
                            model_name="ArcFace",
                            enforce_detection=False
                        )
                        if rep and "embedding" in rep[0]:
                            embeddings.append(rep[0]["embedding"])
                            print(f"  ✅ {person_name} ← {file}")
                    except Exception as e:
                        print(f"  ⚠️ Skipped {file}: {e}")

            if embeddings:
                # Average multiple embeddings for speed and stability
                avg_embedding = np.mean(np.array(embeddings), axis=0).tolist()
                known_faces[person_name] = {
                    "embedding": avg_embedding,
                    "count": len(embeddings)
                }

        # Save cache
        with open(CACHE_FILE, "w") as f:
            json.dump(known_faces, f)

        print(f"💾 Saved {len(known_faces)} identities to {CACHE_FILE}\n")
        return known_faces


known_faces = build_or_load_database()
print(f"✅ Total known identities: {len(known_faces)}\n")


# =====================================================
# FACE RECOGNITION FUNCTION
# =====================================================
def recognize_face(face_crop):
    """Compare detected face embedding with known identities."""
    try:
        rep = DeepFace.represent(face_crop, model_name="ArcFace", enforce_detection=False)
        if not rep or "embedding" not in rep[0]:
            return "Unknown"
        emb = rep[0]["embedding"]

        min_dist = 1.0
        identity = "Unknown"

        for name, data in known_faces.items():
            dist = cosine_distance(data["embedding"], emb)
            if dist < min_dist:
                min_dist = dist
                identity = name

        return identity if min_dist < THRESHOLD else "Unknown"

    except Exception as e:
        print("Recognition error:", e)
        return "Error"


# =====================================================
# MAIN EXECUTION
# =====================================================
if USE_WEBCAM:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("❌ Could not access webcam.")
    print("🎥 Webcam started. Press 'q' to quit.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model(frame)
        boxes = results[0].boxes.xyxy.cpu().numpy()

        for box in boxes:
            x1, y1, x2, y2 = map(int, box)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
            face = frame[y1:y2, x1:x2]

            if face.shape[0] < 50 or face.shape[1] < 50:
                continue

            name = recognize_face(face)
            color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, name, (x1, max(20, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

        cv2.imshow("YOLOv12 + ArcFace Face Recognition", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

else:
    frame = cv2.imread(TEST_IMAGE_PATH)
    results = model(frame)
    boxes = results[0].boxes.xyxy.cpu().numpy()

    for box in boxes:
        x1, y1, x2, y2 = map(int, box)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
        face = frame[y1:y2, x1:x2]

        if face.shape[0] < 50 or face.shape[1] < 50:
            continue

        name = recognize_face(face)
        color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(frame, name, (x1, max(20, y1 - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

    cv2.imshow("YOLOv12 + ArcFace (Image Test)", frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


















# Single Image in DataBase

# ====================================================
# YOLOv12 + DeepFace Face Recognition
# ====================================================
'''from ultralytics import YOLO
from deepface import DeepFace
import cv2
import os
import numpy as np
import json

# ==========================================
# CONFIGURATION
# ==========================================
model = YOLO("yolov12s-face.pt")
faces_dir = "faces_db"
cache_file = "face_embeddings.json"

USE_WEBCAM = True   # True = webcam mode, False = single image mode
TEST_IMAGE_PATH = "licensed-image.webp"
threshold = 0.45  # lower = stricter match (0.3–0.5 is typical)


# ==========================================
# LOAD OR BUILD FACE DATABASE (auto-updating)
# ==========================================
def build_or_update_face_db():
    """Load cached embeddings and update with new or removed images."""
    known_faces = []
    cache_changed = False

    # Step 1: Load existing cache if present
    if os.path.exists(cache_file):
        with open(cache_file, "r") as f:
            try:
                known_faces = json.load(f)
                print(f"📂 Loaded {len(known_faces)} cached embeddings.")
            except Exception:
                print("⚠️ Cache file is corrupted. Rebuilding...")
                known_faces = []
                cache_changed = True
    else:
        print("🧠 No cache found. Building new database...")
        cache_changed = True

    # Step 2: Get all face_db image filenames
    valid_exts = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
    db_files = [f for f in os.listdir(faces_dir) if f.lower().endswith(valid_exts)]
    db_names = [os.path.splitext(f)[0] for f in db_files]
    cached_names = [f["name"] for f in known_faces]

    # Step 3: Add new faces (not in cache)
    for file in db_files:
        name = os.path.splitext(file)[0]
        if name not in cached_names:
            path = os.path.join(faces_dir, file)
            try:
                embedding = DeepFace.represent(
                    img_path=path, model_name="Facenet", enforce_detection=False
                )[0]["embedding"]
                known_faces.append({"name": name, "embedding": embedding})
                print(f"➕ Added new face: {file}")
                cache_changed = True
            except Exception as e:
                print(f"⚠️ Could not process {file}: {e}")

    # Step 4: Remove missing faces (deleted from folder)
    updated_faces = [f for f in known_faces if f["name"] in db_names]
    if len(updated_faces) != len(known_faces):
        removed = set(cached_names) - set(db_names)
        for r in removed:
            print(f"🗑️ Removed missing face from cache: {r}")
        cache_changed = True
        known_faces = updated_faces

    # Step 5: Save cache if modified
    if cache_changed:
        with open(cache_file, "w") as f:
            json.dump(known_faces, f)
        print(f"💾 Cache updated. Total faces: {len(known_faces)}\n")
    else:
        print("✅ Cache is up to date.\n")

    return known_faces


known_faces = build_or_update_face_db()


# ==========================================
# UTILS
# ==========================================
def cosine_distance(a, b):
    """Compute cosine distance between two embeddings."""
    a = np.array(a)
    b = np.array(b)
    return 1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


def recognize_face(face_crop):
    """Compare face crop with embeddings in database."""
    try:
        rep = DeepFace.represent(face_crop, model_name="Facenet", enforce_detection=False)
        if not rep or "embedding" not in rep[0]:
            return "Unknown", 1.0
        emb = rep[0]["embedding"]

        min_dist = 1.0
        identity = "Unknown"

        for person in known_faces:
            dist = cosine_distance(person["embedding"], emb)
            if dist < min_dist:
                min_dist = dist
                identity = person["name"]

        if min_dist < threshold:
            return identity, min_dist
        else:
            return "Unknown", min_dist

    except Exception as e:
        print("Recognition error:", e)
        return "Error", 1.0


# ==========================================
# MAIN LOOP
# ==========================================
if USE_WEBCAM:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("❌ Could not access webcam.")
    print("🎥 Webcam started. Press 'q' to quit.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model(frame)
        boxes = results[0].boxes.xyxy.cpu().numpy()

        for box in boxes:
            x1, y1, x2, y2 = map(int, box)
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
            face = frame[y1:y2, x1:x2]

            if face.shape[0] < 50 or face.shape[1] < 50:
                continue

            name, dist = recognize_face(face)
            label = f"{name} ({dist:.2f})" if name != "Unknown" else "Unknown"

            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, label, (x1, max(20, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        cv2.imshow("YOLOv12 + DeepFace Recognition", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

else:
    frame = cv2.imread(TEST_IMAGE_PATH)
    results = model(frame)
    boxes = results[0].boxes.xyxy.cpu().numpy()

    for box in boxes:
        x1, y1, x2, y2 = map(int, box)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
        face = frame[y1:y2, x1:x2]

        if face.shape[0] < 50 or face.shape[1] < 50:
            continue

        name, dist = recognize_face(face)
        label = f"{name} ({dist:.2f})" if name != "Unknown" else "Unknown"

        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, label, (x1, max(20, y1 - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    cv2.imshow("YOLOv12 + DeepFace (Image Test)", frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()'''











# Simple Face Detection
"""from ultralytics import YOLO
import cv2

# Load the YOLOv12 face detection model
model = YOLO("yolov12s-face.pt")

# Open webcam (0 is the default webcam)
cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Run face detection
    results = model(frame)

    # Draw detections on the frame
    annotated_frame = results[0].plot()

    # Show the frame
    cv2.imshow("YOLOv12 Face Detection", annotated_frame)

    # Press 'q' to quit
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Release resources
cap.release()
cv2.destroyAllWindows()"""
