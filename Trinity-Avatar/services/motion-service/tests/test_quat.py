import math

from motion_service import quat


def test_from_axis_angle_unit():
    q = quat.from_axis_angle((0, 0, 1), math.pi / 2)
    assert math.isclose(math.sqrt(sum(c * c for c in q)), 1.0, rel_tol=1e-9)
    assert math.isclose(q[3], math.cos(math.pi / 4), rel_tol=1e-9)


def test_multiply_identity():
    q = quat.from_axis_angle((1, 0, 0), 0.7)
    assert quat.multiply(q, quat.IDENTITY) == q


def test_multiply_composes_rotations():
    a = quat.from_axis_angle((0, 0, 1), math.pi / 4)
    ab = quat.multiply(a, a)
    expected = quat.from_axis_angle((0, 0, 1), math.pi / 2)
    assert all(math.isclose(x, y, abs_tol=1e-9) for x, y in zip(ab, expected, strict=True))


def test_slerp_endpoints_and_midpoint():
    a = quat.IDENTITY
    b = quat.from_axis_angle((0, 1, 0), math.pi / 2)
    assert quat.slerp(a, b, 0.0) == a
    mid = quat.slerp(a, b, 0.5)
    expected = quat.from_axis_angle((0, 1, 0), math.pi / 4)
    assert all(math.isclose(x, y, abs_tol=1e-6) for x, y in zip(mid, expected, strict=True))


def test_normalize_zero_safe():
    assert quat.normalize((0.0, 0.0, 0.0, 0.0)) == (0.0, 0.0, 0.0, 0.0)
