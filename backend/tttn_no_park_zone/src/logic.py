from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, Tuple

MOVING  = "moving"
STOPPED = "stopped"
PARKED  = "parked"


def dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
class VehicleState:
    vi_tri_cuoi:          Tuple[float, float]
    dung_tu_frame:        int
    last_seen_frame:      int
    last_reminder_frame:  int = 0
    last_violation_frame: int = 0
    state:                str = MOVING


class ViolationLogic:
    def __init__(
        self,
        stop_seconds: float,
        move_thr_px: float,
        cooldown_seconds: float,
        fps: float = 21.0,
        reminder_seconds: float = 30.0,
        parked_seconds: float = 60.0,
    ):
        self.move_thr_px          = float(move_thr_px)
        self.fps                  = float(fps)
        self.reminder_frame       = int(reminder_seconds * fps)
        self.parked_frame         = int(parked_seconds * fps)
        self.cooldown_frame       = int(cooldown_seconds * fps)

        self.tracks: Dict[int, VehicleState] = {}
    # ── Backward-compatible aliases ───────────────────────────────────────────
    def should_send_reminder(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        if self.check_reminder(track_id, so_frame, in_no_park):
            self.mark_reminder_sent(track_id, so_frame)
            return True
        return False

    def should_flag_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        if self.check_violation(track_id, so_frame, in_no_park):
            self.mark_violation_sent(track_id, so_frame)
            return True
        return False
    # ── Helpers ───────────────────────────────────────────────────────────────
    def _compute_state(self, khoang_cach: float, so_frame_dung_yen: int) -> str:
        if khoang_cach > self.move_thr_px:
            return MOVING
        if so_frame_dung_yen >= self.parked_frame:
            return PARKED
        return STOPPED

    def _is_gap_too_large(self, track: VehicleState, so_frame: int) -> bool:
        """Xe mất quá 3 giây → coi như xe mới, reset bộ đếm."""
        return (so_frame - track.last_seen_frame) > self.fps * 3

    # ── Public API ────────────────────────────────────────────────────────────
    def update(self, track_id: int, center: Tuple[float, float], so_frame: int) -> float:
        if track_id not in self.tracks:
            self.tracks[track_id] = VehicleState(
                vi_tri_cuoi=center,
                dung_tu_frame=so_frame,
                last_seen_frame=so_frame,
            )
            return 0.0

        track = self.tracks[track_id]

        # Reset nếu xe biến mất quá lâu rồi quay lại
        if self._is_gap_too_large(track, so_frame):
            track.dung_tu_frame = so_frame
            track.state = MOVING

        khoang_cach = dist(center, track.vi_tri_cuoi)

        if khoang_cach > self.move_thr_px:
            track.dung_tu_frame = so_frame

        track.vi_tri_cuoi    = center
        track.last_seen_frame = so_frame

        so_frame_dung_yen = so_frame - track.dung_tu_frame
        track.state = self._compute_state(khoang_cach, so_frame_dung_yen)

        return so_frame_dung_yen / self.fps

    def check_reminder(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        """Chỉ kiểm tra — không thay đổi state."""
        if not in_no_park:
            return False
        track = self.tracks.get(track_id)
        if not track or track.state != STOPPED:
            return False
        return (so_frame - track.last_reminder_frame) >= self.reminder_frame

    def mark_reminder_sent(self, track_id: int, so_frame: int):
        if track_id in self.tracks:
            self.tracks[track_id].last_reminder_frame = so_frame

    def check_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        """Chỉ kiểm tra — không thay đổi state."""
        if not in_no_park:
            return False
        track = self.tracks.get(track_id)
        if not track or track.state != PARKED:
            return False
        return (so_frame - track.last_violation_frame) >= self.cooldown_frame

    def mark_violation_sent(self, track_id: int, so_frame: int):
        if track_id in self.tracks:
            self.tracks[track_id].last_violation_frame = so_frame

    def get_vehicle_state(self, track_id: int) -> str:
        track = self.tracks.get(track_id)
        return track.state if track else MOVING

    def remove_track(self, track_id: int):
        self.tracks.pop(track_id, None)

    def cleanup_stale_tracks(self, so_frame: int, max_gap_frames: int = 300):
        stale = [tid for tid, t in self.tracks.items()
                 if so_frame - t.last_seen_frame > max_gap_frames]
        for tid in stale:
            del self.tracks[tid]