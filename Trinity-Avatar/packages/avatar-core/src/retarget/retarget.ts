/**
 * Retargeting: SOMA-24 pose frames (motion service wire format) → VRM
 * humanoid bones.
 *
 * Both conventions are Y-up, T-pose rest, local unit quaternions, so the
 * core mapping is a rename plus:
 *   - root translation scaled by the avatar's hip height (size differences),
 *   - foot locking to stop planted feet from sliding,
 *   - joint clamping to keep extreme frames from self-intersecting.
 */
import {
  SOMA_JOINTS,
  SOMA_TO_VRM,
  type PoseFrame,
  type Quat,
  type Vec3,
} from '@trinity-avatar/protocol';
import { clamp, quatAngle, quatNormalize, quatSlerp, QUAT_IDENTITY } from '../math.js';
import type { VrmBoneName } from '../vrm/rig.js';

/** Hip height (m) of the SOMA reference body — motion service emits rootPos in this scale. */
export const SOMA_REST_HIPS_Y = 0.95;

/** Max rotation (rad) from rest allowed per joint group — cheap self-intersection guard. */
const JOINT_LIMITS: Partial<Record<VrmBoneName, number>> = {
  head: 1.1,
  neck: 0.7,
  spine: 0.6,
  chest: 0.6,
  upperChest: 0.6,
  leftUpperArm: 2.9,
  rightUpperArm: 2.9,
  leftLowerArm: 2.6,
  rightLowerArm: 2.6,
  leftUpperLeg: 2.2,
  rightUpperLeg: 2.2,
  leftLowerLeg: 2.4,
  rightLowerLeg: 2.4,
};

/** Clamp a quaternion to a max angle from identity (slerp toward identity). */
export function clampRotation(q: Quat, maxAngleRad: number): Quat {
  const angle = quatAngle(QUAT_IDENTITY, q);
  if (angle <= maxAngleRad || angle === 0) return q;
  return quatNormalize(quatSlerp(QUAT_IDENTITY, q, maxAngleRad / angle));
}

export interface RetargetedPose {
  /** VRM bone name → local rotation. */
  rotations: Map<VrmBoneName, Quat>;
  /** Hips world position, scaled to the target avatar. */
  hipsPosition: Vec3;
}

/** Map one SOMA pose frame onto VRM bone space for an avatar with the given hip height. */
export function retargetFrame(frame: PoseFrame, targetHipsY: number): RetargetedPose {
  const scale = targetHipsY / SOMA_REST_HIPS_Y;
  const rotations = new Map<VrmBoneName, Quat>();
  for (let i = 0; i < SOMA_JOINTS.length; i++) {
    const soma = SOMA_JOINTS[i]!;
    const vrmName = SOMA_TO_VRM[soma] as VrmBoneName | null;
    if (!vrmName) continue;
    let q = frame.rotations[i] ?? QUAT_IDENTITY;
    q = quatNormalize(q);
    const limit = JOINT_LIMITS[vrmName];
    if (limit !== undefined) q = clampRotation(q, limit);
    rotations.set(vrmName, q);
  }
  return {
    rotations,
    hipsPosition: [frame.rootPos[0] * scale, frame.rootPos[1] * scale, frame.rootPos[2] * scale],
  };
}

/** Blend two retargeted poses (slerp rotations, lerp root). */
export function blendPoses(a: RetargetedPose, b: RetargetedPose, t: number): RetargetedPose {
  const w = clamp(t, 0, 1);
  const rotations = new Map<VrmBoneName, Quat>();
  const names = new Set([...a.rotations.keys(), ...b.rotations.keys()]);
  for (const name of names) {
    const qa = a.rotations.get(name) ?? QUAT_IDENTITY;
    const qb = b.rotations.get(name) ?? QUAT_IDENTITY;
    rotations.set(name, quatSlerp(qa, qb, w));
  }
  return {
    rotations,
    hipsPosition: [
      a.hipsPosition[0] + (b.hipsPosition[0] - a.hipsPosition[0]) * w,
      a.hipsPosition[1] + (b.hipsPosition[1] - a.hipsPosition[1]) * w,
      a.hipsPosition[2] + (b.hipsPosition[2] - a.hipsPosition[2]) * w,
    ],
  };
}

// ── Foot locking ─────────────────────────────────────────────────────────────

export interface FootLockerOptions {
  /** Foot below this height (m, avatar scale) is a plant candidate. */
  plantHeight: number;
  /** Horizontal speed (m/s) below which a low foot counts as planted. */
  plantSpeed: number;
  /** Max horizontal correction (m) before the lock releases (leg would overstretch). */
  maxCorrection: number;
  /** Correction blend-out rate when unlocking (1/s). */
  releaseRate: number;
}

export const DEFAULT_FOOT_LOCKER: FootLockerOptions = {
  plantHeight: 0.12,
  plantSpeed: 0.35,
  maxCorrection: 0.25,
  releaseRate: 6,
};

interface FootState {
  locked: boolean;
  lockX: number;
  lockZ: number;
  prevX: number;
  prevZ: number;
  prevY: number;
}

/**
 * Kills foot sliding: while a foot is low and slow it is "planted", and the
 * hips are offset so the planted foot stays where it first touched down.
 * Works purely on foot world positions, so it is renderer-agnostic and
 * unit-testable.
 */
export class FootLocker {
  private readonly opts: FootLockerOptions;
  private readonly feet: [FootState, FootState] = [
    { locked: false, lockX: 0, lockZ: 0, prevX: 0, prevZ: 0, prevY: 0 },
    { locked: false, lockX: 0, lockZ: 0, prevX: 0, prevZ: 0, prevY: 0 },
  ];
  private correction: [number, number] = [0, 0]; // x, z applied to hips
  private initialized = false;

  constructor(opts: Partial<FootLockerOptions> = {}) {
    this.opts = { ...DEFAULT_FOOT_LOCKER, ...opts };
  }

  /** Current hips correction [x, z]. */
  get hipsCorrection(): [number, number] {
    return this.correction;
  }

  reset(): void {
    this.initialized = false;
    this.feet.forEach((f) => (f.locked = false));
    this.correction = [0, 0];
  }

  /**
   * @param leftFoot / rightFoot — world-space foot positions BEFORE correction.
   * @returns hips [x, z] offset to apply this frame.
   */
  update(dt: number, leftFoot: Vec3, rightFoot: Vec3): [number, number] {
    const o = this.opts;
    const positions: [Vec3, Vec3] = [leftFoot, rightFoot];

    if (!this.initialized) {
      this.feet.forEach((f, i) => {
        const p = positions[i]!;
        f.prevX = p[0];
        f.prevZ = p[2];
        f.prevY = p[1];
      });
      this.initialized = true;
      return this.correction;
    }

    let targetX = 0;
    let targetZ = 0;
    let anyLocked = false;

    this.feet.forEach((f, i) => {
      const p = positions[i]!;
      const vx = dt > 0 ? (p[0] - f.prevX) / dt : 0;
      const vz = dt > 0 ? (p[2] - f.prevZ) / dt : 0;
      const speed = Math.hypot(vx, vz);
      const low = p[1] < o.plantHeight;

      if (!f.locked && low && speed < o.plantSpeed) {
        f.locked = true;
        f.lockX = p[0];
        f.lockZ = p[2];
      } else if (f.locked) {
        const drift = Math.hypot(p[0] - f.lockX, p[2] - f.lockZ);
        if (!low || drift > o.maxCorrection) f.locked = false;
      }

      if (f.locked && !anyLocked) {
        // First locked foot wins; correcting for both at once is overconstrained.
        targetX = f.lockX - p[0];
        targetZ = f.lockZ - p[2];
        anyLocked = true;
      }

      f.prevX = p[0];
      f.prevZ = p[2];
      f.prevY = p[1];
    });

    if (anyLocked) {
      this.correction = [targetX, targetZ];
    } else {
      // Ease the correction out so unlock doesn't pop.
      const k = Math.min(1, o.releaseRate * dt);
      this.correction = [this.correction[0] * (1 - k), this.correction[1] * (1 - k)];
      if (Math.hypot(this.correction[0], this.correction[1]) < 1e-4) this.correction = [0, 0];
    }
    return this.correction;
  }
}
