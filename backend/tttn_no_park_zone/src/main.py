from __future__ import annotations
import os
import cv2
import yaml
from typing import Any, Dict
from collections import deque
from .telegram_bot import send_telegram_image, send_telegram_video
from .detector import Detector
from .tracker import extract_tracks
from .zones import load_zone_json
from .logic import ViolationLogic, MOVING, STOPPED, PARKED
from .utils import ensure_dir, now_ts, save_json
from .visualizer import draw_zone as _draw_zone, draw_track, draw_violation_banner

VEHICLE_NAMES = {"car", "truck", "bus"}

# ── Thời gian buffer video vi phạm (giây) ──────────────────────────────────
VIDEO_BUFFER_SECONDS = 5  # Giữ 5 giây frames trước violation


def save_violation_video(frame_buffer: deque, fps: float, ts: str, track_id: int) -> str:
    """Ghi frames từ buffer thành file video"""
    if not frame_buffer:
        return ""

    video_dir = os.path.join("outputs", "violations")
    ensure_dir(video_dir)
    
    video_path = os.path.join(video_dir, f"violation_{track_id}_{ts}.mp4")

    # ── Lấy kích thước frame từ phần tử đầu tiên ─────────────────────────────
    first_frame = frame_buffer[0]
    h, w = first_frame.shape[:2]

    # ── Tạo VideoWriter (codec: MP4V) ──────────────────────────────────────
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(video_path, fourcc, fps, (w, h))

    # ── Ghi tất cả frames từ buffer ────────────────────────────────────────
    for frame in frame_buffer:
        out.write(frame)

    out.release()
    print(f"✅ Video vi phạm lưu: {video_path} ({len(frame_buffer)} frames)")
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


def main():
    cfg = load_config("configs/config.yaml")

    model_path       = cfg["model_path"]
    source           = cfg["source"]
    conf             = float(cfg["conf"])
    iou              = float(cfg["iou"])
    stop_seconds     = float(cfg["stop_seconds"])
    move_thr_px      = float(cfg["move_thr_px"])
    cooldown_seconds = float(cfg["cooldown_seconds"])
    reminder_seconds = float(cfg.get("reminder_seconds", 30))  # Nhắc nhở mỗi 30s
    parked_seconds   = float(cfg.get("parked_seconds", 60))    # Coi là đỗ sau 60s
    zone_file        = cfg["zone_file"]

    save_violations       = bool(cfg.get("save_violations", True))
    save_violation_frames = bool(cfg.get("save_violation_frames", True))
    show_window           = bool(cfg.get("show_window", True))
    window_name           = str(cfg.get("window_name", "Parking Violation"))
    draw_zone_flag        = bool(cfg.get("draw_zone", True))
    telegram_cfg          = cfg.get("telegram", {})
    telegram_enabled      = bool(telegram_cfg.get("enabled", False))
    telegram_token        = telegram_cfg.get("bot_token", "")
    telegram_chat_id      = telegram_cfg.get("chat_id", "")
    send_video            = bool(telegram_cfg.get("send_video", True))

    ensure_dir("outputs/violations")
    ensure_dir("outputs/logs")

    cap = open_source(source)
    if not cap.isOpened():
        raise RuntimeError(f"Không mở được nguồn video/camera: {source}")

    # ── Lấy FPS từ video để logic tính đúng giây theo frame ──────────────────
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        print("Không đọc được FPS, dùng mặc định 30")
        fps = 30.0
    print(f"FPS: {fps} | Tổng frame: {int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}")

    # ── Tạo buffer frames (lưu từ 5 giây quá khứ cho video violation) ────────
    buffer_size = int(VIDEO_BUFFER_SECONDS * fps)
    frame_buffer = deque(maxlen=buffer_size)

    zone     = load_zone_json(zone_file)
    detector = Detector(model_path)
    logic    = ViolationLogic(
        stop_seconds, move_thr_px, cooldown_seconds, 
        fps=fps,
        reminder_seconds=reminder_seconds,
        parked_seconds=parked_seconds
    )

    so_frame = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        so_frame += 1

        # ── Thêm frame vào buffer ──────────────────────────────────────────
        frame_copy = frame.copy()
        frame_buffer.append(frame_copy)

        results = detector.track(frame, conf=conf, iou=iou)
        tracks  = extract_tracks(results)

        # ── Vẽ vùng cấm ──────────────────────────────────────────────────────
        if draw_zone_flag:
            pts = zone.points[:-1] if len(zone.points) > 1 else zone.points
            _draw_zone(frame, pts)

        # ── Xử lý từng xe ────────────────────────────────────────────────────
        for t in tracks:
            if t["name"] not in VEHICLE_NAMES:
                continue

            track_id = t["id"]
            center   = t["center"]
            xyxy     = t["xyxy"]

            in_no_park = zone.contains_xy(center[0], center[1])
            still_time = logic.update(track_id, center, so_frame)
            veh_state  = logic.get_vehicle_state(track_id)

            # ── Tạo label ────────────────────────────────────────────────────
            label = f"ID:{track_id} {t['name']} {still_time:.1f}s"
            if in_no_park:
                label += " | NO-PARK"

            # ── Vẽ bbox với màu theo trạng thái ──────────────────────────────
            draw_track(frame, xyxy, label, vehicle_state=veh_state)

            # ── 1️⃣ Kiểm tra gửi NHẮC NHỎ (mỗi 30s khi STOPPED) ───────────────
            if logic.should_send_reminder(track_id, so_frame, in_no_park):
                if telegram_enabled:
                    reminder_caption = (
                        "⚠️ NHẮC NHỜ: XE ĐANG DỪNG TRONG VÙNG CẤMMÃ\n"
                        f"ID xe: {track_id}\n"
                        f"Loại xe: {t['name']}\n"
                        f"Thời gian dừng: {still_time:.1f}s\n"
                        f"⏰ Vui lòng di chuyển ngay!"
                    )
                    # Gửi ảnh nhắc nhở
                    reminder_img_path = os.path.join("outputs", "violations",
                                                     f"reminder_{track_id}_{now_ts()}.jpg")
                    cv2.imwrite(reminder_img_path, frame)
                    send_telegram_image(
                        reminder_img_path,
                        reminder_caption,
                        telegram_token,
                        telegram_chat_id
                    )

            # ── 2️⃣ Kiểm tra VI PHẠM (khi PARKED ≥60s) ──────────────────────
            if logic.should_flag_violation(track_id, so_frame, in_no_park):
                draw_violation_banner(frame)

                if save_violations:
                    ts = now_ts()
                    
                    # ── Lưu ảnh vi phạm ────────────────────────────────────
                    if save_violation_frames:
                        img_path = os.path.join("outputs", "violations",
                                                f"violation_{track_id}_{ts}.jpg")
                        cv2.imwrite(img_path, frame)

                        # ── Gửi ảnh qua Telegram ──────────────────────────
                        if telegram_enabled:
                            caption = (
                                "🚨 VI PHẠM: XE ĐỖ SAI QUY ĐỊNH ≥60 GIÂY\n"
                                f"ID xe: {track_id}\n"
                                f"Loại xe: {t['name']}\n"
                                f"Thời gian đỗ: {still_time:.1f}s\n"
                                f"⏰ CẦN BỊ XỬ PHẠT NGAY!"
                            )
                            send_telegram_image(
                                img_path,
                                caption,
                                telegram_token,
                                telegram_chat_id
                            )

                    # ── Lưu video vi phạm từ buffer frames ──────────────────
                    if send_video and frame_buffer:
                        video_path = save_violation_video(
                            frame_buffer, fps, ts, track_id
                        )

                        # ── Gửi video qua Telegram ────────────────────────
                        if telegram_enabled and video_path:
                            video_caption = (
                                "📹 VIDEO VI PHẠM ĐỖ XE ≥60 GIÂY\n"
                                f"ID xe: {track_id}\n"
                                f"Loại xe: {t['name']}\n"
                                f"Thời gian đỗ: {still_time:.1f}s"
                            )
                            send_telegram_video(
                                video_path,
                                video_caption,
                                telegram_token,
                                telegram_chat_id
                            )

        # ── Hiện cửa sổ ──────────────────────────────────────────────────────
        if show_window:
            cv2.imshow(window_name, frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()