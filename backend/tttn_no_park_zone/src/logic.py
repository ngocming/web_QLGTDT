from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

MOVING = "moving"
SLOW = "slow"
STOPPED = "stopped"
PARKED = "parked"


def dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
class VehicleState:
    vi_tri_cuoi: Tuple[float, float]
    last_seen_frame: int
    last_speed_px_s: float = 0.0
    stopped_since_frame: Optional[int] = None
    last_reminder_frame: int = 0
    last_violation_frame: int = 0
    reminder_count_in_no_park: int = 0
    state: str = MOVING

    # ── FIX: cộng dồn thời gian dừng để không mất khi bị che khuất ──
    still_time_accumulated_s: float = 0.0


class ViolationLogic:
    def __init__(
        self,
        stop_speed_px_s: float,
        slow_speed_px_s: float,
        cooldown_seconds: float,
        fps: float = 21.0,
        reminder_seconds: float = 30.0,
        parked_seconds: float = 60.0,
        reminder_limit_before_parked: int = 5,
        # ── FIX: tham số re-identification ──
        reidentify_max_dist_px: float = 80.0,
        reidentify_max_gap_seconds: float = 5.0,
    ):
        self.stop_speed_px_s = float(stop_speed_px_s)
        self.slow_speed_px_s = float(slow_speed_px_s)
        self.fps = float(fps)

        self.reminder_frame = int(reminder_seconds * fps)
        self.parked_seconds = float(parked_seconds)
        self.reminder_limit_before_parked = max(1, int(reminder_limit_before_parked))
        self.cooldown_frame = int(cooldown_seconds * fps)

        # ── FIX: ngưỡng re-identification ──
        self.reidentify_max_dist_px = float(reidentify_max_dist_px)
        self.reidentify_max_gap_frames = int(reidentify_max_gap_seconds * fps)

        self.tracks: Dict[int, VehicleState] = {}

        # ── FIX: lưu track đã bị mất để re-identify ──
        # key: track_id cũ  →  value: VehicleState tại thời điểm mất
        self._lost_tracks: Dict[int, VehicleState] = {}

    # ─────────────────────────────────────────────
    # STATE LOGIC
    # ─────────────────────────────────────────────
    def _compute_state(self, speed_px_s: float, still_seconds: float) -> str:
        # 🚗 chạy nhanh
        if speed_px_s > self.slow_speed_px_s:
            return MOVING

        # 🐢 chạy chậm
        if speed_px_s > self.stop_speed_px_s:
            return SLOW

        # 🅿️ đỗ lâu — dùng thời gian tích lũy thay vì still_frames cứng
        if still_seconds >= self.parked_seconds:
            return PARKED

        # ⏸️ dừng
        return STOPPED

    def _compute_state_for_track(self, track: VehicleState) -> str:
        if track.reminder_count_in_no_park >= self.reminder_limit_before_parked:
            return PARKED
        return self._compute_state(track.last_speed_px_s, track.still_time_accumulated_s)

    def _reset_no_park_enforcement(self, track: VehicleState) -> None:
        track.last_reminder_frame = 0
        track.reminder_count_in_no_park = 0

    def _refresh_no_park_enforcement(self, track: VehicleState, in_no_park: bool) -> None:
        if not in_no_park or track.last_speed_px_s > self.stop_speed_px_s:
            self._reset_no_park_enforcement(track)

    def _is_gap_too_large(self, track: VehicleState, so_frame: int) -> bool:
        return (so_frame - track.last_seen_frame) > self.fps * 3

    # ─────────────────────────────────────────────
    # FIX: RE-IDENTIFICATION
    # ─────────────────────────────────────────────
    def _try_reidentify(
        self, center: Tuple[float, float], so_frame: int
    ) -> Optional[int]:
        """
        Tìm track đã bị mất (trong _lost_tracks) gần với vị trí `center`.
        Nếu tìm được → trả về track_id cũ để kế thừa lịch sử.
        """
        best_tid: Optional[int] = None
        best_dist = self.reidentify_max_dist_px

        stale_tids = []
        for tid, track in self._lost_tracks.items():
            gap = so_frame - track.last_seen_frame

            # Quá lâu → bỏ qua và dọn luôn
            if gap > self.reidentify_max_gap_frames:
                stale_tids.append(tid)
                continue

            d = dist(center, track.vi_tri_cuoi)
            if d < best_dist:
                best_dist = d
                best_tid = tid

        # Dọn track quá cũ
        for tid in stale_tids:
            del self._lost_tracks[tid]

        return best_tid

    # ─────────────────────────────────────────────
    # MAIN UPDATE
    # ─────────────────────────────────────────────
    def update(self, track_id: int, center: Tuple[float, float], so_frame: int) -> float:

        # ── tạo track mới hoặc re-identify ───────
        if track_id not in self.tracks:
            old_tid = self._try_reidentify(center, so_frame)

            if old_tid is not None:
                # ✅ Kế thừa track cũ — không mất thời gian dừng tích lũy
                track = self._lost_tracks.pop(old_tid)
                track.vi_tri_cuoi = center
                track.last_seen_frame = so_frame
                self.tracks[track_id] = track
            else:
                # Track mới hoàn toàn
                self.tracks[track_id] = VehicleState(
                    vi_tri_cuoi=center,
                    last_seen_frame=so_frame,
                    stopped_since_frame=so_frame,
                )
                return 0.0

        track = self.tracks[track_id]

        # ── reset nếu mất track lâu (> 3s) ───────
        if self._is_gap_too_large(track, so_frame):
            track.stopped_since_frame = so_frame
            track.last_speed_px_s = 0.0
            track.state = MOVING
            # FIX: KHÔNG reset still_time_accumulated ở đây,
            # vì gap ngắn có thể chỉ là occlusion thoáng qua.
            # Chỉ reset nếu xe thực sự di chuyển (xử lý bên dưới).

        # ── tính delta time ───────────────────────
        frame_gap = max(1, so_frame - track.last_seen_frame)
        dt_seconds = frame_gap / self.fps

        # ── tính khoảng cách ─────────────────────
        khoang_cach = dist(center, track.vi_tri_cuoi)

        # ── tính speed ───────────────────────────
        raw_speed = khoang_cach / dt_seconds

        # 🔥 smoothing (EMA)
        alpha = 0.7
        speed_px_s = alpha * raw_speed + (1 - alpha) * track.last_speed_px_s

        # 🔥 loại nhiễu nhỏ (camera rung)
        if speed_px_s < 0.5:
            speed_px_s = 0.0

        # ── update state nội bộ ──────────────────
        track.vi_tri_cuoi = center
        track.last_seen_frame = so_frame
        track.last_speed_px_s = speed_px_s

        # ── FIX: cộng dồn thời gian dừng ─────────
        if speed_px_s <= self.stop_speed_px_s:
            track.still_time_accumulated_s += dt_seconds
            if track.stopped_since_frame is None:
                track.stopped_since_frame = so_frame
        else:
            # Chỉ reset khi thực sự di chuyển rõ ràng
            if speed_px_s > self.slow_speed_px_s:
                track.stopped_since_frame = None
                # FIX: reset cả accumulated khi xe chạy trở lại thật sự
                track.still_time_accumulated_s = 0.0

        # ── xác định trạng thái ──────────────────
        track.state = self._compute_state_for_track(track)

        return track.still_time_accumulated_s

    # ─────────────────────────────────────────────
    # REMINDER
    # ─────────────────────────────────────────────
    def check_reminder(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        track = self.tracks.get(track_id)
        if not track:
            return False
        self._refresh_no_park_enforcement(track, in_no_park)
        track.state = self._compute_state_for_track(track)
        if not in_no_park or track.state != STOPPED:
            return False
        return (so_frame - track.last_reminder_frame) >= self.reminder_frame

    def mark_reminder_sent(self, track_id: int, so_frame: int):
        if track_id in self.tracks:
            track = self.tracks[track_id]
            track.last_reminder_frame = so_frame
            track.reminder_count_in_no_park += 1
            track.state = self._compute_state_for_track(track)

    def should_send_reminder(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        if self.check_reminder(track_id, so_frame, in_no_park):
            self.mark_reminder_sent(track_id, so_frame)
            return True
        return False

    # ─────────────────────────────────────────────
    # VIOLATION
    # ─────────────────────────────────────────────
    def check_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        track = self.tracks.get(track_id)
        if not track:
            return False
        self._refresh_no_park_enforcement(track, in_no_park)
        track.state = self._compute_state_for_track(track)
        if not in_no_park or track.state != PARKED:
            return False
        return (so_frame - track.last_violation_frame) >= self.cooldown_frame

    def mark_violation_sent(self, track_id: int, so_frame: int):
        if track_id in self.tracks:
            self.tracks[track_id].last_violation_frame = so_frame

    def should_flag_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        if self.check_violation(track_id, so_frame, in_no_park):
            self.mark_violation_sent(track_id, so_frame)
            return True
        return False

    # ─────────────────────────────────────────────
    # GETTERS
    # ─────────────────────────────────────────────
    def get_vehicle_state(self, track_id: int) -> str:
        track = self.tracks.get(track_id)
        return track.state if track else MOVING

    def get_vehicle_speed(self, track_id: int) -> float:
        track = self.tracks.get(track_id)
        return track.last_speed_px_s if track else 0.0

    def get_still_time(self, track_id: int) -> float:
        """Trả về tổng thời gian dừng tích lũy (giây)."""
        track = self.tracks.get(track_id)
        return track.still_time_accumulated_s if track else 0.0

    def get_reminder_count(self, track_id: int) -> int:
        track = self.tracks.get(track_id)
        return track.reminder_count_in_no_park if track else 0

    # ─────────────────────────────────────────────
    # CLEANUP
    # ─────────────────────────────────────────────
    def remove_track(self, track_id: int):
        """
        FIX: Khi tracker báo mất track → chuyển sang _lost_tracks
        thay vì xóa hẳn, để có thể re-identify sau này.
        """
        track = self.tracks.pop(track_id, None)
        if track is not None:
            self._lost_tracks[track_id] = track

    def cleanup_stale_tracks(self, so_frame: int, max_gap_frames: int = 300):
        stale = [
            tid for tid, t in self.tracks.items()
            if so_frame - t.last_seen_frame > max_gap_frames
        ]
        for tid in stale:
            # FIX: chuyển sang lost thay vì xóa ngay
            self._lost_tracks[tid] = self.tracks.pop(tid)

        # Dọn _lost_tracks quá cũ
        truly_stale = [
            tid for tid, t in self._lost_tracks.items()
            if so_frame - t.last_seen_frame > self.reidentify_max_gap_frames
        ]
        for tid in truly_stale:
            del self._lost_tracks[tid]
