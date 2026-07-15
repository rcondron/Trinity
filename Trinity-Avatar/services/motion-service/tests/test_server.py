import json

from fastapi.testclient import TestClient

from motion_service.server import app


def recv_until(ws, mtype: str, limit: int = 200):
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["type"] == mtype:
            return msg
    raise AssertionError(f"no {mtype} within {limit} messages")


def test_health_reports_backend():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["backend"] in ("ardy", "clips")
    assert body["fps"] >= 30


def test_ws_streams_status_then_pose_frames():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        status = json.loads(ws.receive_text())
        assert status["type"] == "motion_status"
        assert status["backend"] in ("ardy", "clips")
        frame = recv_until(ws, "pose_frame")
        assert frame["layer"] == "base"
        assert len(frame["rotations"]) == 24


def test_ws_gesture_request_streams_gesture_layer():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        recv_until(ws, "pose_frame")
        ws.send_text(json.dumps({"type": "motion_request", "prompt": "wave hello", "layer": "gesture"}))
        for _ in range(200):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "pose_frame" and msg["layer"] == "gesture":
                assert "weight" in msg
                return
        raise AssertionError("no gesture frames received")


def test_ws_rejects_malformed_messages():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "motion_request"}))  # missing prompt
        for _ in range(50):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "error":
                assert msg["code"] == "bad_message"
                return
        raise AssertionError("no error reply for malformed message")


def test_ws_motion_stop_emits_zero_weight_fadeout():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        recv_until(ws, "pose_frame")
        ws.send_text(json.dumps({"type": "motion_request", "prompt": "wave hello", "layer": "gesture"}))
        recv_until(ws, "pose_frame")
        ws.send_text(json.dumps({"type": "motion_stop", "layer": "gesture", "fadeMs": 100}))
        for _ in range(300):
            msg = json.loads(ws.receive_text())
            if msg["type"] == "pose_frame" and msg["layer"] == "gesture" and msg.get("weight") == 0.0:
                return
        raise AssertionError("no zero-weight fade-out frame")
