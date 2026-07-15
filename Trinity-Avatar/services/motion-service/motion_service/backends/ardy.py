"""NVIDIA ARDY backend — real-time autoregressive diffusion motion generation.

ARDY (https://github.com/nv-tlabs/ardy) generates streaming human motion
conditioned on online text prompts and kinematic constraints, on the SOMA
body model. This adapter:

  1. detects a usable environment at construction (torch + CUDA + weights,
     downloaded by scripts/setup_ardy.sh — never vendored into the repo);
  2. rolls the model forward one window at a time, re-conditioning on new
     prompts as they arrive;
  3. converts ARDY's SOMA joint rotations to wire PoseFrames.

If anything is missing, BackendUnavailable is raised and the server falls
back to the procedural clip backend — clients can't tell the difference
except via the motion_status message.

NOTE: the upstream project is young and its Python API may drift; the
integration surface is isolated to `_load_pipeline` / `_rollout` below, so
tracking upstream changes touches only this file.
"""

import logging
import os
from collections.abc import Iterator

from ..skeleton import JOINT_COUNT, REST_HIPS_Y
from .base import BackendUnavailable, PoseFrameDict

log = logging.getLogger(__name__)


class ArdyBackend:
    id = "ardy"

    def __init__(self, checkpoint_dir: str, fps: int = 30):
        self.fps = fps
        self.checkpoint_dir = checkpoint_dir
        self._pipeline = self._load_pipeline()

    # ── environment detection ────────────────────────────────────────────────
    def _load_pipeline(self):
        try:
            import torch  # noqa: F401 — optional heavy dep, intentionally not in requirements.txt
        except ImportError as e:
            raise BackendUnavailable("torch not installed (pip install -r requirements-gpu.txt)") from e

        import torch

        if not torch.cuda.is_available():
            raise BackendUnavailable("no CUDA GPU available — ARDY requires an NVIDIA GPU")

        if not os.path.isdir(self.checkpoint_dir) or not os.listdir(self.checkpoint_dir):
            raise BackendUnavailable(
                f"ARDY weights not found in {self.checkpoint_dir} — run scripts/setup_ardy.sh"
            )

        try:
            # Import surface of github.com/nv-tlabs/ardy (installed by setup_ardy.sh).
            from ardy.pipeline import ArdyStreamingPipeline  # type: ignore[import-not-found]
        except ImportError as e:
            raise BackendUnavailable(
                "ardy package not importable — run scripts/setup_ardy.sh to install it"
            ) from e

        pipeline = ArdyStreamingPipeline.from_pretrained(self.checkpoint_dir)
        pipeline = pipeline.to("cuda").eval()
        log.info("ARDY pipeline loaded from %s", self.checkpoint_dir)
        return pipeline

    # ── streaming rollout ────────────────────────────────────────────────────
    def _rollout(self, prompt: str, loop: bool) -> Iterator[list[list[float]]]:
        """Yield per-frame SOMA joint rotation lists from the model."""
        import torch

        with torch.inference_mode():
            stream = self._pipeline.stream(
                text_prompt=prompt,
                fps=self.fps,
                loop=loop,
            )
            for window in stream:
                # window: [T, J, 4] joint rotations (xyzw) on the SOMA skeleton
                yield from window.cpu().numpy().tolist()

    def stream(self, prompt: str, *, loop: bool, layer: str) -> Iterator[PoseFrameDict | None]:
        clean = prompt.removeprefix("locomotion:").replace(":", " ")
        t = 0.0
        dt = 1.0 / self.fps
        try:
            for rotations in self._rollout(clean, loop):
                if len(rotations) != JOINT_COUNT:
                    log.warning("ARDY emitted %d joints, expected %d", len(rotations), JOINT_COUNT)
                    break
                yield {
                    "type": "pose_frame",
                    "t": round(t, 4),
                    "layer": layer,
                    "rootPos": [0.0, REST_HIPS_Y, 0.0],
                    "rotations": rotations,
                    **({"weight": 1.0} if layer == "gesture" else {}),
                }
                t += dt
        except Exception:  # pragma: no cover — GPU runtime failures
            log.exception("ARDY rollout failed; ending stream")
            return
