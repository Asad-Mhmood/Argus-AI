#Simplified multi-person
import cv2
import numpy as np
from ultralytics import YOLO
from collections import deque
import time
import uuid

# Configuration
MODEL_PATH = "yolov8n-pose.pt"
VIDEO_SOURCE = 0 
FPS = 30
INACTIVITY_SECONDS = 10
MOVEMENT_THRESHOLD = 5.0
#KEYPOINTS = [0, 5, 6, 11, 12]  # Nose, left/right shoulder, left/right hip
KEYPOINTS = [0, 5, 6, 7, 8, 9, 10, 11, 12]  # Nose, shoulders, elbows, wrists, hips
FRAME_WINDOW = FPS * INACTIVITY_SECONDS

class Person:
    def __init__(self, bbox, keypoints):
        self.id = str(uuid.uuid4())
        self.keypoints = deque(maxlen=FRAME_WINDOW)
        self.keypoints.append(keypoints)
        self.bbox = bbox
        self.last_moved = time.time()
        self.is_sleeping = False

    def update(self, keypoints, bbox):
        self.bbox = bbox
        if self.keypoints and keypoints:
            displacement = np.mean([
                np.sqrt((curr[0] - prev[0])**2 + (curr[1] - prev[1])**2)
                for prev, curr in zip(self.keypoints[-1], keypoints)
                if prev is not None and curr is not None
            ]) if any(prev is not None and curr is not None for prev, curr in zip(self.keypoints[-1], keypoints)) else float('inf')
            self.is_sleeping = displacement < MOVEMENT_THRESHOLD and time.time() - self.last_moved >= INACTIVITY_SECONDS
            if displacement >= MOVEMENT_THRESHOLD:
                self.last_moved = time.time()
        self.keypoints.append(keypoints)

def load_model():
    return YOLO(MODEL_PATH)

def get_detections(model, frame):
    results = model(frame, verbose=False)[0]
    bboxes = results.boxes.xyxy.cpu().numpy()
    keypoints = results.keypoints.xy.cpu().numpy()
    return [
        (box, [kp[i] if kp[i][0] > 0 and kp[i][1] > 0 else None for i in KEYPOINTS])
        for box, kp in zip(bboxes, keypoints)
    ]

def match_persons(persons, detections):
    new_persons = []
    used_ids = set()
    for bbox, keypoints in detections:
        best_match, min_dist = None, float('inf')
        curr_center = np.array([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])
        for person in persons:
            if person.id in used_ids:
                continue
            prev_center = np.array([(person.bbox[0] + person.bbox[2]) / 2, (person.bbox[1] + person.bbox[3]) / 2])
            dist = np.sqrt(np.sum((curr_center - prev_center) ** 2))
            if dist < min_dist and dist < 100:
                min_dist, best_match = dist, person
        if best_match:
            best_match.update(keypoints, bbox)
            used_ids.add(best_match.id)
            new_persons.append(best_match)
        else:
            new_persons.append(Person(bbox, keypoints))
    return new_persons

def draw_detections(frame, persons):
    for person in persons:
        x1, y1, x2, y2 = map(int, person.bbox)
        color = (0, 0, 255) if person.is_sleeping else (0, 255, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(frame, "Not Working" if person.is_sleeping else "Working", 
                    (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

def main():
    model = load_model()
    cap = cv2.VideoCapture(VIDEO_SOURCE)
    if not cap.isOpened():
        print("Error: Could not open video source.")
        return

    persons = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            print("Error: Failed to read frame.")
            break

        detections = get_detections(model, frame)
        persons = match_persons(persons, detections)
        draw_detections(frame, persons)
        cv2.imshow("Sleep Detection", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
