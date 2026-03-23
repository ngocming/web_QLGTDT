from __future__ import annotations

import os
from collections import deque
from typing import Any, Dict

import cv2
import yaml

from .detector import Detector
from .logic import PARKED, STOPPED, ViolationLogic
from .telegram_bot import send_telegram_image, send_telegram_video
from .tracker import extract_tracks
from .utils import ensure_dir, now_ts
from .visualizer import draw_track, draw_violation_banner, draw_zone as _draw_zone
from .zones import load_zone_json

VEHICLE_NAMES = {"car", "truck", "bus"}
VIDEO_BUFFER_SECONDS = 5


def save_violation_video(frame_buffer: deque, fps: float, ts: str, track_id: int) -> str:
    if not frame_buffer:
        return ""

    video_dir = os.path.join("outputs", "violations")
    ensure_dir(video_dir)
    video_path = os.path.join(video_dir, f"violation_{track_id}_{ts}.mp4")

    first_frame = frame_buffer[0]
    h, w = first_frame.shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(video_path, fourcc, fps, (w, h))

    for frame in frame_buffer:
        out.write(frame)

    out.release()
    print(f"Video vi pham luu: {video_path} ({len(frame_buffer)} frames)")
    return video_path


def load_config(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def open_source(src):
    if isinstance(src, int):
        return cv2.VideoCapture(src)
    if isinstance(src, str) and src.strip().isdigit():
        return cv2.VideoCapture(int(src.strip()))
    return cv2.VideoCapture(src)


def build_state_duration_label(vehicle_state: str, still_time: float) -> str:
    if vehicle_state == STOPPED:
        return f"DUNG: {still_time:.1f}s"
    if vehicle_state == PARKED:
        return f"DO: {still_time:.1f}s"
    return ""


def main():
    cfg = load_config("configs/config.yaml")

    model_path = cfg["model_path"]
    source = cfg["source"]
    conf = float(cfg["conf"])
    iou = float(cfg["iou"])
    stop_speed_px_s = float(cfg.get("stop_speed_px_s", 5))
    slow_speed_px_s = float(cfg.get("slow_speed_px_s", 25))
    cooldown_seconds = float(cfg["cooldown_seconds"])
    reminder_seconds = float(cfg.get("reminder_seconds", 10))
    parked_seconds = float(cfg.get("parked_seconds", 60))
    reminder_limit_before_parked = int(cfg.get("reminder_limit_before_parked", 5))
    zone_file = cfg["zone_file"]

    save_violations = bool(cfg.get("save_violations", True))
    save_violation_frames = bool(cfg.get("save_violation_frames", True))
    show_window = bool(cfg.get("show_window", True))
    window_name = str(cfg.get("window_name", "Parking Violation"))
    draw_zone_flag = bool(cfg.get("draw_zone", True))
    telegram_cfg = cfg.get("telegram", {})
    telegram_enabled = bool(telegram_cfg.get("enabled", False))
    telegram_token = telegram_cfg.get("bot_token", "")
    telegram_chat_id = telegram_cfg.get("chat_id", "")
    send_video = bool(telegram_cfg.get("send_video", True))

    ensure_dir("outputs/violations")
    ensure_dir("outputs/logs")

    cap = open_source(source)
    if not cap.isOpened():
        raise RuntimeError(f"Khong mo duoc nguon video/camera: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        print("Khong doc duoc FPS, dung mac dinh 30")
        fps = 30.0
    print(f"FPS: {fps} | Tong frame: {int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}")

    buffer_size = int(VIDEO_BUFFER_SECONDS * fps)
    frame_buffer = deque(maxlen=buffer_size)

    zone = load_zone_json(zone_file)
    detector = Detector(model_path)
    logic = ViolationLogic(
        stop_speed_px_s,
        slow_speed_px_s,
        cooldown_seconds,
        fps=fps,
        reminder_seconds=reminder_seconds,
        parked_seconds=parked_seconds,
        reminder_limit_before_parked=reminder_limit_before_parked,
    )

    so_frame = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        so_frame += 1
        frame_buffer.append(frame.copy())

        results = detector.track(frame, conf=conf, iou=iou)
        tracks = extract_tracks(results)

        if draw_zone_flag:
            pts = zone.points[:-1] if len(zone.points) > 1 else zone.points
            _draw_zone(frame, pts)

        for t in tracks:
            if t["name"] not in VEHICLE_NAMES:
                continue

            track_id = t["id"]
            center = t["center"]
            xyxy = t["xyxy"]

            in_no_park = zone.contains_xy(center[0], center[1])
            still_time = logic.update(track_id, center, so_frame)
            veh_state = logic.get_vehicle_state(track_id)
            veh_speed = logic.get_vehicle_speed(track_id)
            reminder_count = logic.get_reminder_count(track_id)

            if in_no_park:
                label = f"ID:{track_id} {t['name']} {veh_speed:.1f}px/s | NO-PARK"
                duration_label = build_state_duration_label(veh_state, still_time)
                if duration_label:
                    label += f" | {duration_label}"
                draw_track(frame, xyxy, label, vehicle_state=veh_state)

            should_send_reminder = logic.should_send_reminder(track_id, so_frame, in_no_park)
            if should_send_reminder:
                veh_state = logic.get_vehicle_state(track_id)
                reminder_count = logic.get_reminder_count(track_id)

            if should_send_reminder and telegram_enabled:
                reminder_caption = (
                    "NHAC NHO: XE DANG DUNG TRONG VUNG CAM\n"
                    f"ID xe: {track_id}\n"
                    f"Loai xe: {t['name']}\n"
                    f"Lan nhac: {reminder_count}/{reminder_limit_before_parked}\n"
                    f"Van toc: {veh_speed:.1f}px/s\n"
                    f"Thoi gian dung: {still_time:.1f}s"
                )
                reminder_img_path = os.path.join("outputs", "violations", f"reminder_{track_id}_{now_ts()}.jpg")
                cv2.imwrite(reminder_img_path, frame)
                send_telegram_image(
                    reminder_img_path,
                    reminder_caption,
                    telegram_token,
                    telegram_chat_id,
                )

            should_flag_violation = logic.should_flag_violation(track_id, so_frame, in_no_park)
            if should_flag_violation:
                draw_violation_banner(frame)

                if save_violations:
                    ts = now_ts()

                    if save_violation_frames:
                        img_path = os.path.join("outputs", "violations", f"violation_{track_id}_{ts}.jpg")
                        cv2.imwrite(img_path, frame)

                        if telegram_enabled and not should_send_reminder:
                            caption = (
                                "VI PHAM: XE DO SAI QUY DINH\n"
                                f"ID xe: {track_id}\n"
                                f"Loai xe: {t['name']}\n"
                                f"Van toc: {veh_speed:.1f}px/s\n"
                                f"Thoi gian do: {still_time:.1f}s"
                            )
                            send_telegram_image(
                                img_path,
                                caption,
                                telegram_token,
                                telegram_chat_id,
                            )

                    if send_video and frame_buffer:
                        video_path = save_violation_video(frame_buffer, fps, ts, track_id)

                        if telegram_enabled and video_path:
                            video_caption = (
                                "VIDEO VI PHAM DO XE\n"
                                f"ID xe: {track_id}\n"
                                f"Loai xe: {t['name']}\n"
                                f"Thoi gian do: {still_time:.1f}s"
                            )
                            send_telegram_video(
                                video_path,
                                video_caption,
                                telegram_token,
                                telegram_chat_id,
                            )

        if show_window:
            cv2.imshow(window_name, frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
