from __future__ import annotations
from typing import List, Tuple
import cv2
import numpy as np

from .logic import MOVING, STOPPED, PARKED

# Màu bbox theo trạng thái xe
_STATE_COLOR = {
    MOVING:  (0, 255, 0),    # xanh lá  – đang chạy
    STOPPED: (0, 165, 255),  # cam      – đang dừng
    PARKED:  (0, 0, 255),    # đỏ       – đỗ xe (vi phạm)
}

# Nhãn tiếng Việt hiển thị trên bbox
_STATE_LABEL = {
    MOVING:  "CHAY",
    STOPPED: "DUNG",
    PARKED:  "DO XE",
}


def draw_zone(frame, zone_points: List[Tuple[float, float]],
              color=(0, 0, 200), thickness=2) -> None:
    """Vẽ đường viền vùng cấm đỗ."""
    pts = np.array([(int(x), int(y)) for x, y in zone_points], dtype=np.int32)
    overlay = frame.copy()
    cv2.fillPoly(overlay, [pts], (0, 0, 180))
    cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)
    cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=thickness)


def draw_track(frame, xyxy, label: str,
               vehicle_state: str = MOVING) -> None:
    """
    Vẽ bounding box màu theo trạng thái và label phía trên.
    """
    color = _STATE_COLOR.get(vehicle_state, (0, 255, 0))
    x1, y1, x2, y2 = [int(v) for v in xyxy]

    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    # Nhãn trạng thái nhỏ ở góc trên phải bbox
    state_tag = _STATE_LABEL.get(vehicle_state, "")
    if state_tag:
        tag_x = x2 - 5
        tag_y = max(0, y1 - 6)
        cv2.putText(frame, state_tag, (tag_x - len(state_tag) * 8, tag_y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    # Label chính (ID, class, thời gian)
    cv2.putText(frame, label, (x1, max(0, y1 - 22)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)


def draw_violation_banner(frame,
                          text: str = "VI PHAM: DO XE SAI QUY DINH!",
                          color: Tuple = (0, 0, 255)) -> None:
    """Banner cảnh báo vi phạm ở góc trên."""
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, 0), (w, 80), (0, 0, 0), -1)
    cv2.putText(frame, text, (20, 55),
                cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)
