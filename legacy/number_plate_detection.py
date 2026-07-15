# Easy OCR
from ultralytics import YOLO
import cv2
import easyocr

# Load your custom YOLO model
model = YOLO("license_plate_detector.pt")

# Initialize OCR reader
reader = easyocr.Reader(['en'])

# Open webcam
cap = cv2.VideoCapture("demo_anpr6.mp4")


while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Run YOLO inference
    results = model(frame, stream=True)

    for result in results:
        for box in result.boxes:
            # Get bounding box coordinates
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            plate_crop = frame[y1:y2, x1:x2]

            # Run OCR on the cropped plate
            ocr_result = reader.readtext(plate_crop)

            # Draw box and OCR text
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            if ocr_result:
                text = ocr_result[0][-2]
                cv2.putText(frame, text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 
                            0.8, (0, 255, 0), 2)

    # Show the result
    cv2.imshow("License Plate Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Cleanup
cap.release()
cv2.destroyAllWindows()
