/**
 * Small quaternion/vector toolkit on plain arrays.
 *
 * The retargeting layer uses these instead of three.js classes so the math
 * stays dependency-free and unit-testable in Node.
 * Quaternions are [x, y, z, w]; vectors are [x, y, z].
 */
import type { Quat, Vec3 } from '@trinity-avatar/protocol';

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Spherical linear interpolation, shortest arc. */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = quatDot(a, b);
  let bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    return quatNormalize([
      a[0] + t * (bx - a[0]),
      a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]),
      a[3] + t * (bw - a[3]),
    ]);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, d)));
  const theta = theta0 * t;
  const s0 = Math.cos(theta) - (d * Math.sin(theta)) / Math.sin(theta0);
  const s1 = Math.sin(theta) / Math.sin(theta0);
  return [
    s0 * a[0] + s1 * bx,
    s0 * a[1] + s1 * by,
    s0 * a[2] + s1 * bz,
    s0 * a[3] + s1 * bw,
  ];
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad / 2;
  const s = Math.sin(half);
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [(axis[0] / len) * s, (axis[1] / len) * s, (axis[2] / len) * s, Math.cos(half)];
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  // v + qw * t + cross(q.xyz, t)
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

export function quatAngle(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(quatDot(quatNormalize(a), quatNormalize(b))));
  return 2 * Math.acos(d);
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Critically-damped-ish exponential smoothing factor for frame-rate independent easing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
