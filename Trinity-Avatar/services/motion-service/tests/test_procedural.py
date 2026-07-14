import itertools
import json
import math
from pathlib import Path

import jsonschema
import pytest

from motion_service.backends.procedural import ProceduralBackend
from motion_service.skeleton import JOINT_COUNT, JOINT_INDEX

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "packages" / "protocol" / "schemas" / "messages.json"
)


@pytest.fixture(scope="module")
def validator():
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return jsonschema.Draft202012Validator(json.load(f))


@pytest.fixture()
def backend():
    return ProceduralBackend(fps=30)


def test_frames_validate_against_wire_schema(backend, validator):
    for frame in itertools.islice(backend.stream("idle", loop=True, layer="base"), 10):
        validator.validate(frame)
    for frame in backend.stream("wave hello", loop=False, layer="gesture"):
        validator.validate(frame)


def test_all_frames_have_24_unit_quaternions(backend):
    for frame in itertools.islice(backend.stream("idle", loop=True, layer="base"), 5):
        assert len(frame["rotations"]) == JOINT_COUNT
        for q in frame["rotations"]:
            assert math.isclose(math.sqrt(sum(c * c for c in q)), 1.0, rel_tol=1e-6)


def test_wave_raises_right_arm(backend):
    frames = list(backend.stream("wave hello", loop=False, layer="gesture"))
    # Mid-gesture the right shoulder rotation is far from identity...
    mid = frames[len(frames) // 2]
    q = mid["rotations"][JOINT_INDEX["right_shoulder"]]
    angle = 2 * math.acos(min(1.0, abs(q[3])))
    assert angle > 1.0
    # ...and the weight envelope blends in and out.
    assert frames[0]["weight"] < 0.2
    assert mid["weight"] == 1.0
    assert frames[-1]["weight"] < 0.2


def test_gesture_streams_are_finite_and_base_is_infinite(backend):
    gesture = list(backend.stream("nod", loop=False, layer="gesture"))
    assert 20 < len(gesture) < 200
    base = backend.stream("idle", loop=True, layer="base")
    assert len(list(itertools.islice(base, 500))) == 500


def test_walk_moves_root_and_paces_within_corridor(backend):
    frames = list(itertools.islice(backend.stream("locomotion:pace:1.0", loop=True, layer="base"), 400))
    xs = [f["rootPos"][0] for f in frames]
    assert max(xs) > 0.05  # actually moved
    assert max(abs(x) for x in xs) <= 1.2 + 1e-6  # stayed in the corridor


def test_unknown_gesture_prompt_still_produces_motion(backend):
    frames = list(backend.stream("interpretive dance", loop=False, layer="gesture"))
    assert len(frames) > 10
