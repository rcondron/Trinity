/**
 * Client-side fallback motion generator.
 *
 * When the motion service is unreachable the avatar must not T-pose. This
 * generates SOMA-24 PoseFrames locally: a breathing idle, a walk cycle for
 * locomotion, and a handful of simple gestures. Deliberately the same wire
 * format as the service, so the animator cannot tell the difference.
 */
import {
  SOMA_JOINT_INDEX,
  SOMA_JOINT_COUNT,
  type PoseFrame,
  type Quat,
} from '@trinity-avatar/protocol';
import { quatFromAxisAngle, quatMultiply, QUAT_IDENTITY } from '../math.js';

const REST_HIPS_Y = 0.95;

function makeRotations(): Quat[] {
  return Array.from({ length: SOMA_JOINT_COUNT }, () => [...QUAT_IDENTITY] as Quat);
}

function set(rots: Quat[], joint: keyof typeof SOMA_JOINT_INDEX, q: Quat): void {
  rots[SOMA_JOINT_INDEX[joint]] = q;
}

function compose(rots: Quat[], joint: keyof typeof SOMA_JOINT_INDEX, q: Quat): void {
  const i = SOMA_JOINT_INDEX[joint];
  rots[i] = quatMultiply(rots[i] ?? QUAT_IDENTITY, q);
}

const Z: [number, number, number] = [0, 0, 1];
const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];

/** Arms hang relaxed instead of T-pose; slight elbow bend, hands in. */
function relaxedArms(rots: Quat[], t: number): void {
  const sway = Math.sin(t * 0.9) * 0.02;
  set(rots, 'left_shoulder', quatFromAxisAngle(Z, -1.25 + sway));
  set(rots, 'right_shoulder', quatFromAxisAngle(Z, 1.25 - sway));
  set(rots, 'left_elbow', quatFromAxisAngle(Z, -0.18));
  set(rots, 'right_elbow', quatFromAxisAngle(Z, 0.18));
}

export type ClientMotionMode = 'idle' | 'walk' | 'wave' | 'nod' | 'shake' | 'shrug' | 'think';

export interface ClientMotionState {
  mode: ClientMotionMode;
  /** Seconds since this mode started. */
  modeT: number;
  /** Non-looping gestures return to idle after their duration. */
  done: boolean;
}

const GESTURE_DURATION: Partial<Record<ClientMotionMode, number>> = {
  wave: 2.4,
  nod: 1.2,
  shake: 1.4,
  shrug: 1.6,
  think: 3.0,
};

/** Map a free-text behavior prompt onto the closest built-in clip. */
export function promptToClientMode(prompt: string): ClientMotionMode {
  const p = prompt.toLowerCase();
  if (/(wave|hello|greet|hi\b|bye)/.test(p)) return 'wave';
  if (/(nod|yes|agree|affirm)/.test(p)) return 'nod';
  if (/(shake|no\b|disagree|deny)/.test(p)) return 'shake';
  if (/(shrug|dunno|unsure|maybe)/.test(p)) return 'shrug';
  if (/(think|ponder|chin|hmm|consider|attentive|lean)/.test(p)) return 'think';
  if (/(walk|pace|stroll|wander)/.test(p)) return 'walk';
  return 'idle';
}

export class ClientMotion {
  private t = 0;
  private state: ClientMotionState = { mode: 'idle', modeT: 0, done: false };
  /** World-space walk direction control: +1 right, -1 left (overlay mode steers this). */
  walkDirection = 1;
  walkSpeed = 0.5; // m/s

  get mode(): ClientMotionMode {
    return this.state.mode;
  }

  private rootX = 0;

  play(mode: ClientMotionMode): void {
    this.state = { mode, modeT: 0, done: false };
  }

  /** Generate the next pose frame; dt in seconds. */
  frame(dt: number): PoseFrame {
    this.t += dt;
    this.state.modeT += dt;
    const dur = GESTURE_DURATION[this.state.mode];
    if (dur !== undefined && this.state.modeT >= dur) {
      this.state = { mode: 'idle', modeT: 0, done: true };
    }

    const rots = makeRotations();
    const t = this.t;
    let rootY = REST_HIPS_Y + Math.sin(t * 1.4) * 0.004;

    relaxedArms(rots, t);
    // Gentle whole-body idle sway
    compose(rots, 'spine1', quatFromAxisAngle(Z, Math.sin(t * 0.5) * 0.015));
    compose(rots, 'spine2', quatFromAxisAngle(X, Math.sin(t * 1.4) * 0.008));

    const mt = this.state.modeT;
    switch (this.state.mode) {
      case 'idle':
        break;
      case 'walk': {
        const f = t * 2 * Math.PI * 1.4; // stride frequency
        const s = Math.sin(f);
        const c = Math.sin(f + Math.PI);
        set(rots, 'left_hip', quatFromAxisAngle(X, s * 0.5));
        set(rots, 'right_hip', quatFromAxisAngle(X, c * 0.5));
        set(rots, 'left_knee', quatFromAxisAngle(X, Math.max(0, -s) * 0.9 + 0.1));
        set(rots, 'right_knee', quatFromAxisAngle(X, Math.max(0, -c) * 0.9 + 0.1));
        set(rots, 'left_ankle', quatFromAxisAngle(X, -s * 0.25));
        set(rots, 'right_ankle', quatFromAxisAngle(X, -c * 0.25));
        compose(rots, 'left_shoulder', quatFromAxisAngle(X, c * 0.35));
        compose(rots, 'right_shoulder', quatFromAxisAngle(X, s * 0.35));
        compose(rots, 'pelvis', quatFromAxisAngle(Y, s * 0.06));
        rootY += Math.abs(Math.sin(f)) * 0.025;
        this.rootX += this.walkDirection * this.walkSpeed * dt;
        break;
      }
      case 'wave': {
        const ramp = Math.min(1, mt / 0.4) * Math.min(1, (GESTURE_DURATION.wave! - mt) / 0.4);
        // Raise right arm and oscillate the forearm
        compose(rots, 'right_shoulder', quatFromAxisAngle(Z, -2.35 * ramp));
        compose(rots, 'right_elbow', quatFromAxisAngle(Z, (-0.5 + Math.sin(mt * 9) * 0.45) * ramp));
        compose(rots, 'head', quatFromAxisAngle(Z, -0.08 * ramp));
        break;
      }
      case 'nod': {
        const env = Math.sin((mt / GESTURE_DURATION.nod!) * Math.PI);
        compose(rots, 'head', quatFromAxisAngle(X, Math.sin(mt * 2 * Math.PI * 1.8) * 0.28 * env));
        break;
      }
      case 'shake': {
        const env = Math.sin((mt / GESTURE_DURATION.shake!) * Math.PI);
        compose(rots, 'head', quatFromAxisAngle(Y, Math.sin(mt * 2 * Math.PI * 1.6) * 0.32 * env));
        break;
      }
      case 'shrug': {
        const env = Math.sin((mt / GESTURE_DURATION.shrug!) * Math.PI);
        compose(rots, 'left_collar', quatFromAxisAngle(Z, 0.35 * env));
        compose(rots, 'right_collar', quatFromAxisAngle(Z, -0.35 * env));
        compose(rots, 'left_elbow', quatFromAxisAngle(Z, -0.9 * env));
        compose(rots, 'right_elbow', quatFromAxisAngle(Z, 0.9 * env));
        compose(rots, 'head', quatFromAxisAngle(Z, 0.1 * env));
        break;
      }
      case 'think': {
        const ramp = Math.min(1, mt / 0.6) * Math.min(1, (GESTURE_DURATION.think! - mt) / 0.6);
        // Right hand toward chin, head tilt, lean back slightly
        compose(rots, 'right_shoulder', quatFromAxisAngle(Z, -0.7 * ramp));
        compose(rots, 'right_elbow', quatFromAxisAngle(Z, 2.2 * ramp));
        compose(rots, 'head', quatFromAxisAngle(Z, 0.12 * ramp));
        compose(rots, 'spine2', quatFromAxisAngle(X, -0.06 * ramp));
        break;
      }
    }

    return {
      type: 'pose_frame',
      t: this.t,
      layer: 'base',
      rootPos: [this.rootX, rootY, 0],
      rotations: rots,
    };
  }
}
