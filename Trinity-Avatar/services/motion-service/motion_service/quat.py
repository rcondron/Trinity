"""Minimal quaternion helpers on plain tuples, [x, y, z, w] convention."""

import math

Quat = tuple[float, float, float, float]

IDENTITY: Quat = (0.0, 0.0, 0.0, 1.0)


def from_axis_angle(axis: tuple[float, float, float], angle: float) -> Quat:
    length = math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2) or 1.0
    half = angle / 2.0
    s = math.sin(half) / length
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(half))


def multiply(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def normalize(q: Quat) -> Quat:
    length = math.sqrt(sum(c * c for c in q)) or 1.0
    return (q[0] / length, q[1] / length, q[2] / length, q[3] / length)


def slerp(a: Quat, b: Quat, t: float) -> Quat:
    d = sum(x * y for x, y in zip(a, b, strict=True))
    bq = b if d >= 0 else tuple(-c for c in b)
    d = abs(d)
    if d > 0.9995:
        mixed = tuple(a[i] + t * (bq[i] - a[i]) for i in range(4))
        return normalize(mixed)  # type: ignore[arg-type]
    theta0 = math.acos(max(-1.0, min(1.0, d)))
    theta = theta0 * t
    s0 = math.cos(theta) - d * math.sin(theta) / math.sin(theta0)
    s1 = math.sin(theta) / math.sin(theta0)
    return (
        s0 * a[0] + s1 * bq[0],
        s0 * a[1] + s1 * bq[1],
        s0 * a[2] + s1 * bq[2],
        s0 * a[3] + s1 * bq[3],
    )
