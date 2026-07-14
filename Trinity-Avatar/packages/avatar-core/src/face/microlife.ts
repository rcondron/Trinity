/**
 * Micro-life: procedural blinking, saccadic eye darts, breathing, and subtle
 * body sway. Always running so the avatar never looks dead. Deterministic
 * given an injected RNG (unit tests use a seeded one).
 */
import type { FaceWeights } from './arkit.js';
import { clamp } from '../math.js';

export interface MicroLifePose {
  face: FaceWeights;
  /** Radians. Applied on top of body animation by the animator. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  spinePitch: number;
  spineRoll: number;
  /** 0..1 breathing cycle value (chest expansion). */
  breath: number;
}

export interface MicroLifeOptions {
  blinkIntervalMin: number;
  blinkIntervalMax: number;
  blinkDuration: number;
  saccadeIntervalMin: number;
  saccadeIntervalMax: number;
  /** Max eye dart amplitude as ARKit eyeLook weight. */
  saccadeAmplitude: number;
  breathRateHz: number;
  swayAmplitude: number;
  rng: () => number;
}

export const DEFAULT_MICROLIFE: MicroLifeOptions = {
  blinkIntervalMin: 2.0,
  blinkIntervalMax: 6.5,
  blinkDuration: 0.16,
  saccadeIntervalMin: 0.6,
  saccadeIntervalMax: 3.2,
  saccadeAmplitude: 0.28,
  breathRateHz: 0.22,
  swayAmplitude: 0.02,
  rng: Math.random,
};

export class MicroLife {
  private t = 0;
  private nextBlinkAt: number;
  private blinkStartedAt = -1;
  private nextSaccadeAt: number;
  private eyeTarget: { x: number; y: number } = { x: 0, y: 0 };
  private eye: { x: number; y: number } = { x: 0, y: 0 };
  private readonly opts: MicroLifeOptions;
  /** External gaze bias (from gaze protocol events), added to saccades. */
  gazeBias: { x: number; y: number } = { x: 0, y: 0 };

  constructor(opts?: Partial<MicroLifeOptions>) {
    this.opts = { ...DEFAULT_MICROLIFE, ...opts };
    this.nextBlinkAt = this.sampleInterval(this.opts.blinkIntervalMin, this.opts.blinkIntervalMax);
    this.nextSaccadeAt = this.sampleInterval(
      this.opts.saccadeIntervalMin,
      this.opts.saccadeIntervalMax,
    );
  }

  private sampleInterval(min: number, max: number): number {
    return this.t + min + this.opts.rng() * (max - min);
  }

  /** Force a blink now (used when emotion changes — a natural "reset" cue). */
  blink(): void {
    this.blinkStartedAt = this.t;
  }

  update(dt: number): MicroLifePose {
    const o = this.opts;
    this.t += dt;

    // ── Blinks: double-smoothstep down/up ────────────────────────────────
    if (this.t >= this.nextBlinkAt && this.blinkStartedAt < 0) {
      this.blinkStartedAt = this.t;
      this.nextBlinkAt = this.sampleInterval(o.blinkIntervalMin, o.blinkIntervalMax);
    }
    let blink = 0;
    if (this.blinkStartedAt >= 0) {
      const x = (this.t - this.blinkStartedAt) / o.blinkDuration;
      if (x >= 1) this.blinkStartedAt = -1;
      else blink = x < 0.4 ? x / 0.4 : 1 - (x - 0.4) / 0.6;
      blink = clamp(blink, 0, 1);
    }

    // ── Saccades: retarget eyes at random intervals, fast ease toward target
    if (this.t >= this.nextSaccadeAt) {
      this.eyeTarget = {
        x: (o.rng() * 2 - 1) * o.saccadeAmplitude,
        y: (o.rng() * 2 - 1) * o.saccadeAmplitude * 0.6,
      };
      this.nextSaccadeAt = this.sampleInterval(o.saccadeIntervalMin, o.saccadeIntervalMax);
    }
    const k = 1 - Math.exp(-25 * dt); // saccades are fast
    this.eye.x += (this.eyeTarget.x + this.gazeBias.x - this.eye.x) * k;
    this.eye.y += (this.eyeTarget.y + this.gazeBias.y - this.eye.y) * k;

    // ── Breathing + sway: layered sinusoids at incommensurate frequencies ──
    const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * o.breathRateHz * this.t);
    const swayA = o.swayAmplitude;
    const headYaw = swayA * (Math.sin(0.31 * this.t * 2 * Math.PI * 0.13) + 0.4 * Math.sin(this.t * 0.47));
    const headPitch = swayA * 0.7 * Math.sin(this.t * 0.29 + 1.3) + breath * 0.004;
    const headRoll = swayA * 0.5 * Math.sin(this.t * 0.17 + 0.7);
    const spineRoll = swayA * 0.6 * Math.sin(this.t * 0.11 + 2.1);
    const spinePitch = breath * 0.012 + swayA * 0.3 * Math.sin(this.t * 0.23);

    const face: FaceWeights = {
      eyeBlinkLeft: blink,
      eyeBlinkRight: blink,
    };
    if (this.eye.x > 0) {
      face.eyeLookInLeft = this.eye.x;
      face.eyeLookOutRight = this.eye.x;
    } else {
      face.eyeLookOutLeft = -this.eye.x;
      face.eyeLookInRight = -this.eye.x;
    }
    if (this.eye.y > 0) {
      face.eyeLookUpLeft = this.eye.y;
      face.eyeLookUpRight = this.eye.y;
    } else {
      face.eyeLookDownLeft = -this.eye.y;
      face.eyeLookDownRight = -this.eye.y;
    }

    return { face, headPitch, headYaw, headRoll, spinePitch, spineRoll, breath };
  }
}
