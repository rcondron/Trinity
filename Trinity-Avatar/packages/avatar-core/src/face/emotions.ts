/**
 * Emotion state machine.
 *
 * Discrete emotion labels from the brain drive continuous ARKit expression
 * poses. Transitions ease over `transitionSec`; the machine also decays back
 * to neutral after `holdSec` so a stale emotion never sticks to the face.
 * Output is layered additively over visemes by the animator.
 */
import type { EmotionLabel } from '@trinity-avatar/protocol';
import type { FaceWeights } from './arkit.js';
import { clamp, damp } from '../math.js';

export const EMOTION_POSES: Record<EmotionLabel, FaceWeights> = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.55,
    mouthSmileRight: 0.55,
    cheekSquintLeft: 0.3,
    cheekSquintRight: 0.3,
    eyeSquintLeft: 0.15,
    eyeSquintRight: 0.15,
    browOuterUpLeft: 0.1,
    browOuterUpRight: 0.1,
  },
  thoughtful: {
    browDownLeft: 0.25,
    browDownRight: 0.25,
    browInnerUp: 0.35,
    eyeLookUpLeft: 0.2,
    eyeLookUpRight: 0.2,
    mouthPressLeft: 0.3,
    mouthPressRight: 0.3,
    mouthPucker: 0.1,
  },
  surprised: {
    browInnerUp: 0.8,
    browOuterUpLeft: 0.7,
    browOuterUpRight: 0.7,
    eyeWideLeft: 0.8,
    eyeWideRight: 0.8,
    jawOpen: 0.25,
  },
  concerned: {
    browInnerUp: 0.6,
    browDownLeft: 0.15,
    browDownRight: 0.15,
    mouthFrownLeft: 0.35,
    mouthFrownRight: 0.35,
    mouthShrugLower: 0.2,
  },
  amused: {
    mouthSmileLeft: 0.45,
    mouthSmileRight: 0.3,
    mouthDimpleLeft: 0.4,
    eyeSquintLeft: 0.25,
    eyeSquintRight: 0.2,
    browOuterUpLeft: 0.25,
  },
  excited: {
    mouthSmileLeft: 0.7,
    mouthSmileRight: 0.7,
    eyeWideLeft: 0.4,
    eyeWideRight: 0.4,
    browOuterUpLeft: 0.5,
    browOuterUpRight: 0.5,
    browInnerUp: 0.3,
  },
  sad: {
    browInnerUp: 0.7,
    mouthFrownLeft: 0.5,
    mouthFrownRight: 0.5,
    eyeLookDownLeft: 0.25,
    eyeLookDownRight: 0.25,
    mouthShrugLower: 0.3,
  },
};

export interface EmotionMachineOptions {
  /** Seconds to blend between emotions. */
  transitionSec: number;
  /** Seconds an emotion holds before decaying to neutral. Infinity disables decay. */
  holdSec: number;
}

export class EmotionMachine {
  private current: EmotionLabel = 'neutral';
  private targetIntensity = 0;
  private level = 0;
  private heldFor = 0;
  private readonly opts: EmotionMachineOptions;

  constructor(opts?: Partial<EmotionMachineOptions>) {
    this.opts = { transitionSec: 0.6, holdSec: 12, ...opts };
  }

  get state(): { label: EmotionLabel; level: number } {
    return { label: this.current, level: this.level };
  }

  setEmotion(label: EmotionLabel, intensity = 0.8): void {
    if (label !== this.current) {
      this.current = label;
      this.heldFor = 0;
      // keep `level` where it is: the pose crossfade happens in weight space
    } else {
      this.heldFor = 0;
    }
    this.targetIntensity = label === 'neutral' ? 0 : clamp(intensity, 0, 1);
  }

  update(dt: number): FaceWeights {
    this.heldFor += dt;
    let target = this.targetIntensity;
    if (this.heldFor > this.opts.holdSec) target = 0;
    const lambda = 1 / Math.max(0.05, this.opts.transitionSec / 3);
    this.level = damp(this.level, target, lambda, dt);

    const pose = EMOTION_POSES[this.current];
    const out: FaceWeights = {};
    for (const key in pose) {
      const k = key as keyof FaceWeights;
      out[k] = (pose[k] ?? 0) * this.level;
    }
    return out;
  }
}
