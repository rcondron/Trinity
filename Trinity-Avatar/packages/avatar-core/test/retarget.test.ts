import { describe, expect, it } from 'vitest';
import {
  SOMA_JOINT_COUNT,
  SOMA_JOINT_INDEX,
  type PoseFrame,
  type Quat,
} from '@trinity-avatar/protocol';
import {
  blendPoses,
  clampRotation,
  FootLocker,
  retargetFrame,
  SOMA_REST_HIPS_Y,
} from '../src/retarget/retarget.js';
import { quatFromAxisAngle, quatAngle, QUAT_IDENTITY } from '../src/math.js';

function makeFrame(overrides: Partial<PoseFrame> = {}): PoseFrame {
  return {
    type: 'pose_frame',
    t: 0,
    layer: 'base',
    rootPos: [0, SOMA_REST_HIPS_Y, 0],
    rotations: Array.from({ length: SOMA_JOINT_COUNT }, () => [...QUAT_IDENTITY] as Quat),
    ...overrides,
  };
}

describe('retargetFrame', () => {
  it('maps SOMA joints onto VRM bone names', () => {
    const frame = makeFrame();
    const q = quatFromAxisAngle([0, 0, 1], 0.5);
    frame.rotations[SOMA_JOINT_INDEX.left_shoulder] = q;
    const pose = retargetFrame(frame, SOMA_REST_HIPS_Y);
    expect(pose.rotations.get('leftUpperArm')).toBeDefined();
    expect(quatAngle(pose.rotations.get('leftUpperArm')!, q)).toBeLessThan(1e-6);
    // hands have no VRM counterpart
    expect(pose.rotations.has('leftHand')).toBe(true); // left_wrist → leftHand
  });

  it('scales root motion by avatar hip height (tall and short avatars)', () => {
    const frame = makeFrame({ rootPos: [1, SOMA_REST_HIPS_Y, -2] });
    const tall = retargetFrame(frame, 1.2);
    const short = retargetFrame(frame, 0.6);
    expect(tall.hipsPosition[0]).toBeCloseTo(1.2 / SOMA_REST_HIPS_Y, 5);
    expect(short.hipsPosition[2]).toBeCloseTo((-2 * 0.6) / SOMA_REST_HIPS_Y, 5);
  });

  it('clamps extreme joint rotations (self-intersection guard)', () => {
    const frame = makeFrame();
    frame.rotations[SOMA_JOINT_INDEX.head] = quatFromAxisAngle([1, 0, 0], 3.0);
    const pose = retargetFrame(frame, SOMA_REST_HIPS_Y);
    const angle = quatAngle(QUAT_IDENTITY, pose.rotations.get('head')!);
    expect(angle).toBeLessThanOrEqual(1.1 + 1e-6);
  });

  it('normalizes non-unit quaternions from the wire', () => {
    const frame = makeFrame();
    frame.rotations[SOMA_JOINT_INDEX.spine1] = [0, 0, 2, 2] as Quat;
    const pose = retargetFrame(frame, SOMA_REST_HIPS_Y);
    const q = pose.rotations.get('spine')!;
    expect(Math.hypot(...q)).toBeCloseTo(1, 5);
  });
});

describe('clampRotation', () => {
  it('passes small rotations through unchanged', () => {
    const q = quatFromAxisAngle([0, 1, 0], 0.3);
    expect(clampRotation(q, 1.0)).toEqual(q);
  });
  it('reduces the angle of large rotations to the limit', () => {
    const q = quatFromAxisAngle([0, 1, 0], 2.0);
    const clamped = clampRotation(q, 0.5);
    expect(quatAngle(QUAT_IDENTITY, clamped)).toBeCloseTo(0.5, 3);
  });
});

describe('blendPoses', () => {
  it('interpolates rotations and root position', () => {
    const a = retargetFrame(makeFrame(), SOMA_REST_HIPS_Y);
    const fb = makeFrame({ rootPos: [2, SOMA_REST_HIPS_Y, 0] });
    fb.rotations[SOMA_JOINT_INDEX.head] = quatFromAxisAngle([0, 1, 0], 1.0);
    const b = retargetFrame(fb, SOMA_REST_HIPS_Y);
    const mid = blendPoses(a, b, 0.5);
    expect(mid.hipsPosition[0]).toBeCloseTo(1, 5);
    expect(quatAngle(QUAT_IDENTITY, mid.rotations.get('head')!)).toBeCloseTo(0.5, 2);
  });
});

describe('FootLocker', () => {
  it('pins a planted foot: hips correction cancels drift', () => {
    const locker = new FootLocker();
    const dt = 1 / 30;
    // Frame 0: initialize
    locker.update(dt, [0.1, 0.02, 0], [-0.1, 0.02, 0]);
    // Foot stays low & slow → locks at x=0.1
    locker.update(dt, [0.1, 0.02, 0], [-0.1, 0.02, 0]);
    // Now the incoming animation slides the planted foot by 5cm
    const [cx] = locker.update(dt, [0.15, 0.02, 0], [-0.1, 0.3, 0]);
    expect(cx).toBeCloseTo(-0.05, 5);
  });

  it('releases the lock when the foot lifts', () => {
    const locker = new FootLocker();
    const dt = 1 / 30;
    locker.update(dt, [0, 0.02, 0], [0, 0.5, 0]);
    locker.update(dt, [0, 0.02, 0], [0, 0.5, 0]);
    locker.update(dt, [0.05, 0.02, 0], [0, 0.5, 0]);
    // Lift the left foot well above plant height → correction eases to zero
    let c: [number, number] = [1, 1];
    for (let i = 0; i < 60; i++) c = locker.update(dt, [0.05, 0.4, 0], [0, 0.5, 0]);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(0.01);
  });

  it('gives up rather than overstretching when drift exceeds maxCorrection', () => {
    const locker = new FootLocker({ maxCorrection: 0.1 });
    const dt = 1 / 30;
    locker.update(dt, [0, 0.02, 0], [0, 0.5, 0]);
    locker.update(dt, [0, 0.02, 0], [0, 0.5, 0]);
    // Slide 30cm in one frame — far beyond the correction budget
    locker.update(dt, [0.3, 0.02, 0], [0, 0.5, 0]);
    let c: [number, number] = [1, 1];
    for (let i = 0; i < 60; i++) c = locker.update(dt, [0.3, 0.02, 0], [0, 0.5, 0]);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(0.05);
  });
});

describe('normalizeBoneName (decorated GLB rigs)', () => {
  it('strips numeric suffixes, mixamo prefixes, and separators', async () => {
    const { normalizeBoneName } = await import('../src/vrm/loader.js');
    expect(normalizeBoneName('Hips_01')).toBe('hips');
    expect(normalizeBoneName('mixamorig:LeftForeArm')).toBe('leftforearm');
    expect(normalizeBoneName('mixamorigLeftArm')).toBe('leftarm');
    expect(normalizeBoneName('Armature|Spine2_04')).toBe('spine2');
    expect(normalizeBoneName('Left Shoulder-010')).toBe('leftshoulder');
    // must not eat meaningful digits
    expect(normalizeBoneName('Spine1')).toBe('spine1');
  });
});
