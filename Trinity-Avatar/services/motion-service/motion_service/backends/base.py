"""Backend contract: a generator of pose frames for a behavior prompt.

Frames are plain dicts in the wire PoseFrame shape (see protocol package).
The server drives generators at MOTION_FPS; a generator returning None ends
the stream (non-looping gestures)."""

from collections.abc import Iterator
from typing import Protocol

PoseFrameDict = dict


class MotionBackend(Protocol):
    id: str

    def stream(self, prompt: str, *, loop: bool, layer: str) -> Iterator[PoseFrameDict | None]:
        """Yield one frame per tick. Yield None (or return) to finish."""
        ...


class BackendUnavailable(RuntimeError):
    """Raised at construction when a backend can't run in this environment."""
