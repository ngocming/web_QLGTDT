from __future__ import annotations
import torch
from ultralytics import YOLO


class Detector:
    def __init__(self, model_path: str):
        self.thiet_bi = "cuda" if torch.cuda.is_available() else "cpu"
        self.model    = YOLO(model_path)
        self.model.to(self.thiet_bi)
        print(f"[Detector] Đang chạy trên: {self.thiet_bi.upper()}")

    def track(self, frame, conf: float, iou: float):
        return self.model.track(
            frame,
            persist=True,
            conf=conf,
            iou=iou,
            verbose=False,
            device=self.thiet_bi,   # ← chỉ định rõ device mỗi lần track
        )