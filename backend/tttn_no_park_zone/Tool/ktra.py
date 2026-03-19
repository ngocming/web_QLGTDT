from ultralytics import YOLO
import torch

print("CUDA available:", torch.cuda.is_available())
print("GPU:", torch.cuda.get_device_name(0))

model = YOLO("weights/yolo26n.pt")
print("Model device:", next(model.model.parameters()).device)