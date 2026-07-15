# Age estimation
from deepface import DeepFace
import cv2

# Load image
img_path = "faces_db\Shaheen Afridi\\front.webp"  # change to your image path

# Analyze age
result = DeepFace.analyze(img_path=img_path, actions=['age'], enforce_detection=False)

# Extract age
age = result[0]['age']
print(f"Estimated Age: {age}")

# Optional: show image with age label
img = cv2.imread(img_path)
cv2.putText(img, f"Age: {int(age)}", (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
cv2.imshow("Age Estimation", img)
cv2.waitKey(0)
cv2.destroyAllWindows()
