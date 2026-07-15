import { describe, expect, it } from 'vitest';
import { MicroLife } from '../src/face/microlife.js';

/** Deterministic RNG for reproducible tests. */
function seeded(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('MicroLife', () => {
  it('blinks periodically — eyes close fully at least once in 10s', () => {
    const ml = new MicroLife({ rng: seeded() });
    let maxBlink = 0;
    for (let t = 0; t < 10; t += 1 / 60) {
      const pose = ml.update(1 / 60);
      maxBlink = Math.max(maxBlink, pose.face.eyeBlinkLeft ?? 0);
    }
    expect(maxBlink).toBeGreaterThan(0.9);
  });

  it('keeps both eyes blinking in sync', () => {
    const ml = new MicroLife({ rng: seeded(7) });
    for (let t = 0; t < 8; t += 1 / 60) {
      const pose = ml.update(1 / 60);
      expect(pose.face.eyeBlinkLeft ?? 0).toBeCloseTo(pose.face.eyeBlinkRight ?? 0, 6);
    }
  });

  it('saccades: eye direction changes over time but stays bounded', () => {
    const ml = new MicroLife({ rng: seeded(3) });
    const samples: number[] = [];
    for (let t = 0; t < 12; t += 1 / 60) {
      const pose = ml.update(1 / 60);
      const x = (pose.face.eyeLookInLeft ?? 0) - (pose.face.eyeLookOutLeft ?? 0);
      samples.push(x);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.6);
    }
    const distinct = new Set(samples.map((v) => v.toFixed(2)));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it('breathes: chest value oscillates through a full cycle', () => {
    const ml = new MicroLife({ rng: seeded(1) });
    let min = 1;
    let max = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      const { breath } = ml.update(1 / 60);
      min = Math.min(min, breath);
      max = Math.max(max, breath);
    }
    expect(min).toBeLessThan(0.15);
    expect(max).toBeGreaterThan(0.85);
  });

  it('applies gaze bias from protocol gaze events', () => {
    const ml = new MicroLife({ rng: seeded(9) });
    ml.gazeBias = { x: 0.3, y: 0 };
    let last = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      const pose = ml.update(1 / 60);
      last = (pose.face.eyeLookInLeft ?? 0) - (pose.face.eyeLookOutLeft ?? 0);
    }
    expect(last).toBeGreaterThan(0);
  });
});
