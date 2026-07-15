from ultralytics import YOLO
import cv2

# Load the pretrained YOLO11 model
model = YOLO("yolo11mcoco.pt")

# Open webcam (0 = default camera)
cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # Run YOLO inference on the frame
    results = model(frame, stream=True)

    # Display results
    for result in results:
        annotated_frame = result.plot()  # draw boxes, labels, etc.
        cv2.imshow("YOLO11 Webcam", annotated_frame)

    # Press 'q' to quit
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Clean up
cap.release()
cv2.destroyAllWindows()
