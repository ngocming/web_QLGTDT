import time
import cv2
from ultralytics import YOLO

model = YOLO("weights/yolo26n.pt")

cap = cv2.VideoCapture("data/inputs/videos/parking_video1.mp4")
i = 0
while(i<10):
    ret, frame = cap.read()
    if not ret:
        break

    start = time.time()

    results = model(frame)

    detect_time = time.time() - start
    fps = 1 / detect_time

    print("Processing FPS:", fps)
    i += 1