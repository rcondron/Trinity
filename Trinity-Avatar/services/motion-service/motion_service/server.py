"""FastAPI WebSocket server streaming pose frames at MOTION_FPS.

Protocol (see packages/protocol/schemas/messages.json):
  in : motion_request {prompt, loop, layer}, motion_stop {layer}
  out: motion_status {backend}, pose_frame {t, layer, rootPos, rotations, weight}

Each connection runs one base-layer stream (idle/locomotion, loops forever)
plus at most one gesture-layer stream (finite, weight-enveloped)."""

import asyncio
import json
import logging
import os
from pathlib import Path

import jsonschema
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .backends.ardy import ArdyBackend
from .backends.base import BackendUnavailable, MotionBackend
from .backends.procedural import ProceduralBackend

log = logging.getLogger("motion-service")
logging.basicConfig(level=logging.INFO, format="[motion] %(message)s")

FPS = int(os.environ.get("MOTION_FPS", "30"))
BACKEND_CHOICE = os.environ.get("MOTION_BACKEND", "auto")  # auto | ardy | clips
ARDY_CHECKPOINT_DIR = os.environ.get("ARDY_CHECKPOINT_DIR", "./weights/ardy")

_SCHEMA_PATH = os.environ.get(
    "PROTOCOL_SCHEMA",
    str(Path(__file__).resolve().parents[3] / "packages" / "protocol" / "schemas" / "messages.json"),
)


def load_validator() -> jsonschema.Draft202012Validator | None:
    try:
        with open(_SCHEMA_PATH, encoding="utf-8") as f:
            return jsonschema.Draft202012Validator(json.load(f))
    except OSError:
        log.warning("protocol schema not found at %s — inbound validation disabled", _SCHEMA_PATH)
        return None


VALIDATOR = load_validator()


def select_backend() -> MotionBackend:
    if BACKEND_CHOICE in ("auto", "ardy"):
        try:
            backend = ArdyBackend(ARDY_CHECKPOINT_DIR, fps=FPS)
            log.info("backend: ARDY (GPU)")
            return backend
        except BackendUnavailable as e:
            if BACKEND_CHOICE == "ardy":
                raise SystemExit(f"MOTION_BACKEND=ardy but: {e}") from e
            log.info("ARDY unavailable (%s) — falling back to procedural clips", e)
    fallback = " (FALLBACK)" if BACKEND_CHOICE != "clips" else ""
    log.info("backend: procedural clips%s", fallback)
    return ProceduralBackend(fps=FPS)


app = FastAPI(title="trinity-avatar-motion-service")
BACKEND: MotionBackend = select_backend()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "backend": BACKEND.id, "fps": FPS}


class ConnectionState:
    def __init__(self) -> None:
        self.base_prompt = "idle"
        self.base_iter = BACKEND.stream("idle", loop=True, layer="base")
        self.gesture_iter = None
        self.gesture_fade: float | None = None


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    state = ConnectionState()
    await ws.send_text(
        json.dumps({"type": "motion_status", "backend": BACKEND.id, "fps": FPS})
    )

    async def receiver() -> None:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if VALIDATOR is not None:
                    VALIDATOR.validate(msg)
            except (json.JSONDecodeError, jsonschema.ValidationError) as e:
                await ws.send_text(
                    json.dumps({"type": "error", "code": "bad_message", "message": str(e)[:200]})
                )
                continue
            mtype = msg.get("type")
            if mtype == "motion_request":
                layer = msg.get("layer", "gesture")
                prompt = msg["prompt"]
                if layer == "base":
                    if prompt != state.base_prompt:
                        state.base_prompt = prompt
                        state.base_iter = BACKEND.stream(prompt, loop=True, layer="base")
                else:
                    state.gesture_iter = BACKEND.stream(prompt, loop=False, layer="gesture")
                    state.gesture_fade = None
            elif mtype == "motion_stop":
                layer = msg.get("layer", "gesture")
                if layer in ("gesture", "all"):
                    # Graceful: hand the client a short fade-out via weight=0 frame.
                    state.gesture_iter = None
                    state.gesture_fade = max(0.0, float(msg.get("fadeMs", 250)))
                if layer in ("base", "all"):
                    state.base_prompt = "idle"
                    state.base_iter = BACKEND.stream("idle", loop=True, layer="base")

    async def sender() -> None:
        tick = 1.0 / FPS
        while True:
            frame = next(state.base_iter, None)
            if frame is not None:
                await ws.send_text(json.dumps(frame))
            if state.gesture_iter is not None:
                gframe = next(state.gesture_iter, None)
                if gframe is None:
                    state.gesture_iter = None
                else:
                    await ws.send_text(json.dumps(gframe))
            elif state.gesture_fade is not None:
                # One explicit zero-weight frame lets the client blend out.
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "pose_frame",
                            "t": 0.0,
                            "layer": "gesture",
                            "rootPos": [0.0, 0.95, 0.0],
                            "rotations": [[0.0, 0.0, 0.0, 1.0]] * 24,
                            "weight": 0.0,
                        }
                    )
                )
                state.gesture_fade = None
            await asyncio.sleep(tick)

    recv_task = asyncio.create_task(receiver())
    send_task = asyncio.create_task(sender())
    try:
        done, pending = await asyncio.wait(
            {recv_task, send_task}, return_when=asyncio.FIRST_EXCEPTION
        )
        for task in pending:
            task.cancel()
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.warning("session ended: %s", exc)
    finally:
        recv_task.cancel()
        send_task.cancel()


def main() -> None:
    import uvicorn

    port = int(os.environ.get("MOTION_SERVICE_PORT", "8791"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
