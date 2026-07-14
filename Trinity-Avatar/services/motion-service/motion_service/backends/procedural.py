"""Procedural clip backend — the no-GPU fallback.

Analytic keyframe motion for the shared gesture vocabulary, emitted as
SOMA-24 pose frames. Gestures carry a weight envelope (blend in/out) so the
client can layer them over the base motion without pops."""

import math
from collections.abc import Iterator

from .. import quat
from ..prompts import locomotion_params, prompt_to_clip
from ..skeleton import JOINT_COUNT, JOINT_INDEX, REST_HIPS_Y
from .base import PoseFrameDict

X = (1.0, 0.0, 0.0)
Y = (0.0, 1.0, 0.0)
Z = (0.0, 0.0, 1.0)

GESTURE_DURATION = {
    "wave": 2.4,
    "nod": 1.2,
    "shake": 1.4,
    "shrug": 1.6,
    "think": 3.0,
    "lean_forward": 2.6,
    "open_arms": 2.2,
    "point": 1.8,
    "bow": 2.2,
}


def _rest_rotations() -> list[list[float]]:
    return [[0.0, 0.0, 0.0, 1.0] for _ in range(JOINT_COUNT)]


def _set(rots: list[list[float]], joint: str, q: quat.Quat) -> None:
    rots[JOINT_INDEX[joint]] = list(q)


def _compose(rots: list[list[float]], joint: str, q: quat.Quat) -> None:
    i = JOINT_INDEX[joint]
    cur = tuple(rots[i])
    rots[i] = list(quat.multiply(cur, q))  # type: ignore[arg-type]


def _relaxed_arms(rots: list[list[float]], t: float) -> None:
    sway = math.sin(t * 0.9) * 0.02
    _set(rots, "left_shoulder", quat.from_axis_angle(Z, -1.25 + sway))
    _set(rots, "right_shoulder", quat.from_axis_angle(Z, 1.25 - sway))
    _set(rots, "left_elbow", quat.from_axis_angle(Z, -0.18))
    _set(rots, "right_elbow", quat.from_axis_angle(Z, 0.18))


def _envelope(mt: float, duration: float, ramp: float = 0.4) -> float:
    """0→1→0 blend weight across a gesture's lifetime."""
    up = min(1.0, mt / ramp)
    down = min(1.0, max(0.0, (duration - mt)) / ramp)
    return max(0.0, min(up, down))


class ProceduralBackend:
    """Deterministic, dependency-free motion clips."""

    id = "clips"

    def __init__(self, fps: int = 30):
        self.fps = fps

    # ── Base layer: idle / locomotion, loops forever ─────────────────────────
    def _base_frames(self, clip: str, speed: float) -> Iterator[PoseFrameDict]:
        dt = 1.0 / self.fps
        t = 0.0
        root_x = 0.0
        direction = 1.0
        while True:
            rots = _rest_rotations()
            _relaxed_arms(rots, t)
            _compose(rots, "spine1", quat.from_axis_angle(Z, math.sin(t * 0.5) * 0.015))
            _compose(rots, "spine2", quat.from_axis_angle(X, math.sin(t * 1.4) * 0.008))
            root_y = REST_HIPS_Y + math.sin(t * 1.4) * 0.004

            if clip == "walk":
                f = t * 2 * math.pi * (1.1 + speed * 0.6)
                s, c = math.sin(f), math.sin(f + math.pi)
                _set(rots, "left_hip", quat.from_axis_angle(X, s * 0.5))
                _set(rots, "right_hip", quat.from_axis_angle(X, c * 0.5))
                _set(rots, "left_knee", quat.from_axis_angle(X, max(0.0, -s) * 0.9 + 0.1))
                _set(rots, "right_knee", quat.from_axis_angle(X, max(0.0, -c) * 0.9 + 0.1))
                _set(rots, "left_ankle", quat.from_axis_angle(X, -s * 0.25))
                _set(rots, "right_ankle", quat.from_axis_angle(X, -c * 0.25))
                _compose(rots, "left_shoulder", quat.from_axis_angle(X, c * 0.35))
                _compose(rots, "right_shoulder", quat.from_axis_angle(X, s * 0.35))
                _compose(rots, "pelvis", quat.from_axis_angle(Y, s * 0.06))
                root_y += abs(math.sin(f)) * 0.025
                root_x += direction * speed * dt
                if abs(root_x) > 1.2:  # pace back and forth in a 2.4 m corridor
                    direction *= -1.0
                    root_x = max(-1.2, min(1.2, root_x))

            yield {
                "type": "pose_frame",
                "t": round(t, 4),
                "layer": "base",
                "rootPos": [round(root_x, 4), round(root_y, 4), 0.0],
                "rotations": rots,
            }
            t += dt

    # ── Gesture layer: finite clips with a weight envelope ───────────────────
    def _gesture_frames(self, clip: str) -> Iterator[PoseFrameDict]:
        duration = GESTURE_DURATION.get(clip, 1.5)
        dt = 1.0 / self.fps
        mt = 0.0
        while mt < duration:
            rots = _rest_rotations()
            _relaxed_arms(rots, mt)
            w = _envelope(mt, duration)

            if clip == "wave":
                _compose(rots, "right_shoulder", quat.from_axis_angle(Z, -2.35))
                _compose(rots, "right_elbow", quat.from_axis_angle(Z, -0.5 + math.sin(mt * 9) * 0.45))
                _compose(rots, "head", quat.from_axis_angle(Z, -0.08))
            elif clip == "nod":
                _compose(rots, "head", quat.from_axis_angle(X, math.sin(mt * 2 * math.pi * 1.8) * 0.28))
            elif clip == "shake":
                _compose(rots, "head", quat.from_axis_angle(Y, math.sin(mt * 2 * math.pi * 1.6) * 0.32))
            elif clip == "shrug":
                _compose(rots, "left_collar", quat.from_axis_angle(Z, 0.35))
                _compose(rots, "right_collar", quat.from_axis_angle(Z, -0.35))
                _compose(rots, "left_elbow", quat.from_axis_angle(Z, -0.9))
                _compose(rots, "right_elbow", quat.from_axis_angle(Z, 0.9))
                _compose(rots, "head", quat.from_axis_angle(Z, 0.1))
            elif clip == "think":
                _compose(rots, "right_shoulder", quat.from_axis_angle(Z, -0.7))
                _compose(rots, "right_elbow", quat.from_axis_angle(Z, 2.2))
                _compose(rots, "head", quat.from_axis_angle(Z, 0.12))
                _compose(rots, "spine2", quat.from_axis_angle(X, -0.06))
            elif clip == "lean_forward":
                _compose(rots, "spine1", quat.from_axis_angle(X, 0.14))
                _compose(rots, "spine2", quat.from_axis_angle(X, 0.10))
                _compose(rots, "head", quat.from_axis_angle(X, -0.08))
            elif clip == "open_arms":
                _compose(rots, "left_shoulder", quat.from_axis_angle(Z, 0.75))
                _compose(rots, "right_shoulder", quat.from_axis_angle(Z, -0.75))
                _compose(rots, "left_elbow", quat.from_axis_angle(Y, 0.3))
                _compose(rots, "right_elbow", quat.from_axis_angle(Y, -0.3))
            elif clip == "point":
                _compose(rots, "right_shoulder", quat.from_axis_angle(Z, -1.05))
                _compose(rots, "right_elbow", quat.from_axis_angle(Z, 0.15))
            elif clip == "bow":
                bend = math.sin(min(1.0, mt / (duration * 0.5)) * math.pi / 2) * 0.5
                _compose(rots, "spine1", quat.from_axis_angle(X, bend * 0.5))
                _compose(rots, "spine2", quat.from_axis_angle(X, bend * 0.4))
                _compose(rots, "head", quat.from_axis_angle(X, bend * 0.3))

            yield {
                "type": "pose_frame",
                "t": round(mt, 4),
                "layer": "gesture",
                "rootPos": [0.0, REST_HIPS_Y, 0.0],
                "rotations": rots,
                "weight": round(w, 3),
            }
            mt += dt

    def stream(self, prompt: str, *, loop: bool, layer: str) -> Iterator[PoseFrameDict | None]:
        if layer == "base":
            if prompt.startswith("locomotion:"):
                mode, speed = locomotion_params(prompt)
                clip = "idle" if mode == "idle" else "walk"
            else:
                clip = prompt_to_clip(prompt)
                clip = clip if clip in ("idle", "walk") else "idle"
                speed = 0.5
            return self._base_frames(clip, speed)
        clip = prompt_to_clip(prompt)
        if clip in ("idle", "walk"):
            clip = "lean_forward"  # a body-language beat is better than nothing
        return self._gesture_frames(clip)
