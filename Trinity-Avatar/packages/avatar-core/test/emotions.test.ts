import { describe, expect, it } from 'vitest';
import { EmotionMachine, EMOTION_POSES } from '../src/face/emotions.js';

function run(machine: EmotionMachine, seconds: number, dt = 1 / 60) {
  let out = machine.update(dt);
  for (let t = dt; t < seconds; t += dt) out = machine.update(dt);
  return out;
}

describe('EmotionMachine', () => {
  it('starts neutral with zero weights', () => {
    const m = new EmotionMachine();
    const w = run(m, 0.5);
    expect(Object.values(w).every((v) => (v ?? 0) < 0.01)).toBe(true);
  });

  it('eases into an emotion over the transition time', () => {
    const m = new EmotionMachine({ transitionSec: 0.6 });
    m.setEmotion('happy', 1);
    const early = run(m, 0.1);
    const settled = run(m, 2);
    expect(early.mouthSmileLeft ?? 0).toBeLessThan(settled.mouthSmileLeft ?? 0);
    expect(settled.mouthSmileLeft ?? 0).toBeGreaterThan(0.45);
  });

  it('scales the pose by intensity', () => {
    const m = new EmotionMachine();
    m.setEmotion('surprised', 0.5);
    const w = run(m, 3);
    expect(w.browInnerUp ?? 0).toBeCloseTo((EMOTION_POSES.surprised.browInnerUp ?? 0) * 0.5, 1);
  });

  it('decays back to neutral after holdSec', () => {
    const m = new EmotionMachine({ holdSec: 1, transitionSec: 0.3 });
    m.setEmotion('sad', 1);
    run(m, 0.9);
    expect(m.state.level).toBeGreaterThan(0.5);
    run(m, 4);
    expect(m.state.level).toBeLessThan(0.05);
  });

  it('crossfades when switching emotions', () => {
    const m = new EmotionMachine();
    m.setEmotion('happy', 1);
    run(m, 2);
    m.setEmotion('concerned', 1);
    const w = run(m, 2);
    expect(w.mouthFrownLeft ?? 0).toBeGreaterThan(0.2);
    expect(w.mouthSmileLeft ?? 0).toBe(0);
  });
});
