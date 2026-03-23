from __future__ import annotations

from collections import deque
import math
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional, Tuple

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
    motion_history: Deque[Tuple[int, Tuple[float, float]]] = field(default_factory=deque)
    last_motion_px: float = 0.0
    stopped_since_frame: Optional[int] = None
    last_reminder_frame: int = 0
    last_violation_frame: int = 0
    last_motion_px: float = 0.0
    reminder_count_in_no_park: int = 0
    state: str = MOVING
    still_time_accumulated_s: float = 0.0


class ViolationLogic:
    def __init__(
        self,
        stop_displacement_px: float,
        slow_displacement_px: float,
        cooldown_seconds: float,
        fps: float = 21.0,
        reminder_seconds: float = 30.0,
        parked_seconds: float = 60.0,
        reminder_limit_before_parked: int = 5,
        movement_window_seconds: float = 2.0,
        reidentify_max_dist_px: float = 80.0,
        reidentify_max_gap_seconds: float = 5.0,
    ):
        self.stop_displacement_px = float(stop_displacement_px)
        self.slow_displacement_px = float(slow_displacement_px)
        self.fps = float(fps)

        self.reminder_frame = int(reminder_seconds * fps)
        self.parked_seconds = float(parked_seconds)
        self.reminder_limit_before_parked = max(1, int(reminder_limit_before_parked))
        self.cooldown_frame = int(cooldown_seconds * fps)
        self.movement_window_frames = max(1, int(movement_window_seconds * fps))

        self.reidentify_max_dist_px = float(reidentify_max_dist_px)
        self.reidentify_max_gap_frames = int(reidentify_max_gap_seconds * fps)

        self.tracks: Dict[int, VehicleState] = {}
        self._lost_tracks: Dict[int, VehicleState] = {}

    def _compute_state(self, motion_px: float, still_seconds: float) -> str:
        if motion_px > self.slow_displacement_px:
            return MOVING
        if motion_px > self.stop_displacement_px:
            return SLOW
        if still_seconds >= self.parked_seconds:
            return PARKED
        return STOPPED

    def _compute_state_for_track(self, track: VehicleState) -> str:
        if track.reminder_count_in_no_park >= self.reminder_limit_before_parked:
            return PARKED
        return self._compute_state(track.last_motion_px, track.still_time_accumulated_s)

    def _reset_no_park_enforcement(self, track: VehicleState) -> None:
        track.last_reminder_frame = 0
        track.reminder_count_in_no_park = 0

    def _refresh_no_park_enforcement(self, track: VehicleState, in_no_park: bool) -> None:
        if not in_no_park or track.last_motion_px > self.stop_displacement_px:
            self._reset_no_park_enforcement(track)

    def _is_gap_too_large(self, track: VehicleState, so_frame: int) -> bool:
        return (so_frame - track.last_seen_frame) > self.fps * 3

    def _push_history(self, track: VehicleState, center: Tuple[float, float], so_frame: int) -> None:
    # smoothing center để giảm jitter
        if track.motion_history:
            _, prev_center = track.motion_history[-1]
            alpha = 0.7
            center = (
                alpha * center[0] + (1 - alpha) * prev_center[0],
                alpha * center[1] + (1 - alpha) * prev_center[1],
            )

        track.motion_history.append((so_frame, center))

        min_frame = so_frame - self.movement_window_frames
        while len(track.motion_history) > 1 and track.motion_history[0][0] < min_frame:
            track.motion_history.popleft()

    def _compute_velocity(self, track: VehicleState) -> float:
        history = track.motion_history
        if len(history) < 2:
            return 0.0

        total_dist = 0.0
        for i in range(1, len(history)):
            total_dist += dist(history[i - 1][1], history[i][1])

        total_frames = history[-1][0] - history[0][0]
        if total_frames <= 0:
            return 0.0

        time_s = total_frames / self.fps
        if time_s <= 0:
            return 0.0

        velocity = total_dist / time_s

        # chống jitter nhỏ
        if velocity < 1.0:  # bạn có thể tune 0.5–2
            return 0.0

        return velocity

    def _try_reidentify(self, center: Tuple[float, float], so_frame: int) -> Optional[int]:
        best_tid: Optional[int] = None
        best_dist = self.reidentify_max_dist_px

        stale_tids = []
        for tid, track in self._lost_tracks.items():
            gap = so_frame - track.last_seen_frame
            if gap > self.reidentify_max_gap_frames:
                stale_tids.append(tid)
                continue

            d = dist(center, track.vi_tri_cuoi)
            if d < best_dist:
                best_dist = d
                best_tid = tid

        for tid in stale_tids:
            del self._lost_tracks[tid]

        return best_tid

    def update(self, track_id: int, center: Tuple[float, float], so_frame: int) -> float:
    # ===== 1. INIT TRACK =====
        if track_id not in self.tracks:
            old_tid = self._try_reidentify(center, so_frame)

            if old_tid is not None:
                track = self._lost_tracks.pop(old_tid)
                track.vi_tri_cuoi = center
                track.last_seen_frame = so_frame
                track.motion_history.clear()
                self._push_history(track, center, so_frame)
                track.still_time_accumulated_s = 0.0
                track.stopped_since_frame = None
                self.tracks[track_id] = track
            else:
                self.tracks[track_id] = VehicleState(
                    vi_tri_cuoi=center,
                    last_seen_frame=so_frame,
                    stopped_since_frame=None,
                )
                self._push_history(self.tracks[track_id], center, so_frame)
                return 0.0

        track = self.tracks[track_id]

        # ===== 2. HANDLE GAP =====
        if self._is_gap_too_large(track, so_frame):
            track.motion_history.clear()
            self._push_history(track, center, so_frame)
            track.still_time_accumulated_s = 0.0
            track.stopped_since_frame = None
            track.last_motion_px = 0.0
            track.state = MOVING

        # ===== 3. TIME DELTA =====
        frame_gap = max(1, so_frame - track.last_seen_frame)
        dt_seconds = frame_gap / self.fps

        track.vi_tri_cuoi = center
        track.last_seen_frame = so_frame

        # ===== 4. UPDATE HISTORY =====
        self._push_history(track, center, so_frame)

        # ===== 5. COMPUTE VELOCITY =====
        velocity = self._compute_velocity(track)
        track.last_motion_px = velocity  # giờ là velocity px/s

        # ===== 6. STATE UPDATE LOGIC (FIX QUAN TRỌNG) =====
        if velocity <= self.stop_displacement_px:
            # xe thực sự đứng yên
            track.still_time_accumulated_s += dt_seconds

            if track.stopped_since_frame is None:
                track.stopped_since_frame = so_frame

        else:
            # chỉ cần có chuyển động → reset ngay
            track.still_time_accumulated_s = 0.0
            track.stopped_since_frame = None

        # ===== 7. UPDATE STATE =====
        track.state = self._compute_state_for_track(track)

        return track.still_time_accumulated_s

    def check_reminder(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        track = self.tracks.get(track_id)
        if not track:
            return False
        self._refresh_no_park_enforcement(track, in_no_park)
        track.state = self._compute_state_for_track(track)
        if not in_no_park or track.state != STOPPED:
            return False
        return (so_frame - track.last_reminder_frame) >= self.reminder_frame

    def mark_reminder_sent(self, track_id: int, so_frame: int) -> None:
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

    def check_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        track = self.tracks.get(track_id)
        if not track:
            return False
        self._refresh_no_park_enforcement(track, in_no_park)
        track.state = self._compute_state_for_track(track)
        if not in_no_park or track.state != PARKED:
            return False
        return (so_frame - track.last_violation_frame) >= self.cooldown_frame

    def mark_violation_sent(self, track_id: int, so_frame: int) -> None:
        if track_id in self.tracks:
            self.tracks[track_id].last_violation_frame = so_frame

    def should_flag_violation(self, track_id: int, so_frame: int, in_no_park: bool) -> bool:
        if self.check_violation(track_id, so_frame, in_no_park):
            self.mark_violation_sent(track_id, so_frame)
            return True
        return False

    def get_vehicle_state(self, track_id: int) -> str:
        track = self.tracks.get(track_id)
        return track.state if track else MOVING

    def get_vehicle_speed(self, track_id: int) -> float:
        track = self.tracks.get(track_id)
        return track.last_motion_px if track else 0.0

    def get_still_time(self, track_id: int) -> float:
        track = self.tracks.get(track_id)
        return track.still_time_accumulated_s if track else 0.0     

    def get_reminder_count(self, track_id: int) -> int:
        track = self.tracks.get(track_id)
        return track.reminder_count_in_no_park if track else 0

    def remove_track(self, track_id: int) -> None:
        track = self.tracks.pop(track_id, None)
        if track is not None:
            self._lost_tracks[track_id] = track

    def cleanup_stale_tracks(self, so_frame: int, max_gap_frames: int = 300) -> None:
        stale = [
            tid for tid, t in self.tracks.items()
            if so_frame - t.last_seen_frame > max_gap_frames
        ]
        for tid in stale:
            self._lost_tracks[tid] = self.tracks.pop(tid)

        truly_stale = [
            tid for tid, t in self._lost_tracks.items()
            if so_frame - t.last_seen_frame > self.reidentify_max_gap_frames
        ]
        for tid in truly_stale:
            del self._lost_tracks[tid]
