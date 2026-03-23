from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np
import yaml

from .detector import Detector
from .logic import PARKED, STOPPED, ViolationLogic
from .tracker import extract_tracks
from .visualizer import draw_track, draw_violation_banner, draw_zone as draw_zone_overlay
from .zones import load_zone_json

VEHICLE_NAMES = {"car", "truck", "bus"}


@dataclass
class ProcessorConfig:
    model_path: Path
    zone_file: Path
    conf: float
    iou: float
    stop_displacement_px: float
    slow_displacement_px: float
    movement_window_seconds: float
    cooldown_seconds: float
    reminder_seconds: float
    parked_seconds: float
    reminder_limit_before_parked: int
    draw_zone: bool


def load_processor_config(config_path: Path) -> ProcessorConfig:
    with config_path.open("r", encoding="utf-8") as file:
        raw = yaml.safe_load(file)

    root_dir = config_path.parent.parent
    return ProcessorConfig(
        model_path=(root_dir / raw["model_path"]).resolve(),
        zone_file=(root_dir / raw["zone_file"]).resolve(),
        conf=float(raw["conf"]),
        iou=float(raw["iou"]),
        stop_displacement_px=float(raw.get("stop_displacement_px", 6)),
        slow_displacement_px=float(raw.get("slow_displacement_px", 20)),
        movement_window_seconds=float(raw.get("movement_window_seconds", 2.0)),
        cooldown_seconds=float(raw["cooldown_seconds"]),
        reminder_seconds=float(raw.get("reminder_seconds", 10)),
        parked_seconds=float(raw.get("parked_seconds", 60)),
        reminder_limit_before_parked=int(raw.get("reminder_limit_before_parked", 5)),
        draw_zone=bool(raw.get("draw_zone", True)),
    )


def decode_frame(frame_b64: str):
    if isinstance(frame_b64, str) and "," in frame_b64:
        frame_b64 = frame_b64.split(",", 1)[1]
    frame_data = base64.b64decode(frame_b64)
    np_array = np.frombuffer(frame_data, dtype=np.uint8)
    frame = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Khong giai ma duoc frame base64.")
    return frame


def encode_frame(frame) -> str:
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise ValueError("Khong ma hoa duoc frame.")
    return base64.b64encode(buffer).decode("utf-8")


def build_logic(cfg: ProcessorConfig, fps: float) -> ViolationLogic:
    return ViolationLogic(
        cfg.stop_displacement_px,
        cfg.slow_displacement_px,
        cfg.cooldown_seconds,
        fps=fps,
        reminder_seconds=cfg.reminder_seconds,
        parked_seconds=cfg.parked_seconds,
        reminder_limit_before_parked=cfg.reminder_limit_before_parked,
        movement_window_seconds=cfg.movement_window_seconds,
    )


def build_state_duration_label(vehicle_state: str, still_time: float) -> str:
    if vehicle_state == STOPPED:
        return f"DUNG: {still_time:.1f}s"
    if vehicle_state == PARKED:
        return f"DO: {still_time:.1f}s"
    return ""


class NoParkZoneEngine:
    def __init__(self, config_path: str | os.PathLike[str], fps: float = 30.0):
        self.config_path = Path(config_path).resolve()
        self.cfg = load_processor_config(self.config_path)
        self.fps = float(fps)
        self.detector = Detector(str(self.cfg.model_path))
        self.zone = load_zone_json(str(self.cfg.zone_file))
        self.logic = build_logic(self.cfg, self.fps)
        self.frame_index = 0

    def reset(self) -> None:
        self.logic = build_logic(self.cfg, self.fps)
        self.frame_index = 0

    def process_frame(self, frame) -> Dict[str, Any]:
        self.frame_index += 1
        annotated = frame.copy()
        if self.cfg.draw_zone:
            points = self.zone.points[:-1] if len(self.zone.points) > 1 else self.zone.points
            draw_zone_overlay(annotated, points)

        results = self.detector.track(frame, conf=self.cfg.conf, iou=self.cfg.iou)
        tracks = extract_tracks(results)

        detections: List[Dict[str, Any]] = []
        violations: List[Dict[str, Any]] = []

        for track in tracks:
            if track["name"] not in VEHICLE_NAMES:
                continue

            track_id = track["id"]
            center = track["center"]
            xyxy = track["xyxy"]
            in_no_park = self.zone.contains_xy(center[0], center[1])
            still_time = self.logic.update(track_id, center, self.frame_index)
            vehicle_state = self.logic.get_vehicle_state(track_id)
            vehicle_motion = self.logic.get_vehicle_speed(track_id)
            reminder_count = self.logic.get_reminder_count(track_id)
            duration_label = ""

            if in_no_park:
                label = f"ID:{track_id} {track['name']} lech:{vehicle_motion:.1f}px | NO-PARK"
                duration_label = build_state_duration_label(vehicle_state, still_time)
                if duration_label:
                    label += f" | {duration_label}"
                draw_track(annotated, xyxy, label, vehicle_state=vehicle_state)

            event = "tracking"
            if self.logic.should_send_reminder(track_id, self.frame_index, in_no_park):
                event = "reminder"
                vehicle_state = self.logic.get_vehicle_state(track_id)
                reminder_count = self.logic.get_reminder_count(track_id)
            if self.logic.should_flag_violation(track_id, self.frame_index, in_no_park):
                event = "violation"
                vehicle_state = self.logic.get_vehicle_state(track_id)
                reminder_count = self.logic.get_reminder_count(track_id)
                draw_violation_banner(annotated)

            detection = {
                "track_id": track_id,
                "label": track["name"],
                "confidence": track["conf"],
                "bbox": xyxy,
                "center": list(center),
                "in_no_park_zone": in_no_park,
                "motion_px": round(vehicle_motion, 2),
                "still_seconds": round(still_time, 2),
                "reminder_count": reminder_count,
                "reminder_limit_before_parked": self.cfg.reminder_limit_before_parked,
                "state_duration_label": duration_label,
                "state": vehicle_state,
                "event": event,
            }
            detections.append(detection)
            if event == "violation":
                violations.append(detection)

        self.logic.cleanup_stale_tracks(self.frame_index, max_gap_frames=int(self.fps * 10))
        return {
            "frame": annotated,
            "frame_index": self.frame_index,
            "detections": detections,
            "violations": violations,
        }

    def process_frame_b64(self, frame_b64: str) -> Dict[str, Any]:
        frame = decode_frame(frame_b64)
        result = self.process_frame(frame)
        return {
            "success": True,
            "frame_b64": encode_frame(result["frame"]),
            "frame_index": result["frame_index"],
            "detections": result["detections"],
            "violations": result["violations"],
        }


def analyse_video_file(
    input_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str],
    config_path: str | os.PathLike[str],
) -> Dict[str, Any]:
    engine = NoParkZoneEngine(config_path)
    input_path = str(Path(input_path).resolve())
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Khong mo duoc video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    engine.fps = float(fps)
    engine.reset()

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    violation_events: List[Dict[str, Any]] = []
    processed_frames = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result = engine.process_frame(frame)
            writer.write(result["frame"])
            processed_frames += 1
            for violation in result["violations"]:
                violation_events.append(
                    {
                        **violation,
                        "frame_index": result["frame_index"],
                    }
                )
    finally:
        cap.release()
        writer.release()

    return {
        "processed_frames": processed_frames,
        "total_frames": total_frames,
        "fps": fps,
        "processed_video_path": str(output_path),
        "violation_count": len(violation_events),
        "violations": violation_events,
    }
