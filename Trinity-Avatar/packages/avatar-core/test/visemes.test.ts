import { describe, expect, it } from 'vitest';
import {
  charsToVisemes,
  sampleVisemes,
  visemeEnvelope,
  amplitudeToFaceWeights,
  VISEME_TO_ARKIT,
} from '../src/face/visemes.js';

describe('charsToVisemes', () => {
  it('maps vowels and consonants to visemes with timings', () => {
    const events = charsToVisemes(['h', 'e', 'l', 'l', 'o'], [0, 0.1, 0.2, 0.3, 0.4], [0.1, 0.1, 0.1, 0.1, 0.2]);
    const visemes = events.map((e) => e.viseme);
    expect(visemes).toContain('E');
    expect(visemes).toContain('O');
    // adjacent identical 'l' (nn) merges into one event
    expect(visemes.filter((v) => v === 'nn')).toHaveLength(1);
  });

  it('collapses digraphs (th, sh) into a single viseme spanning both chars', () => {
    const events = charsToVisemes(['t', 'h', 'e'], [0, 0.05, 0.1], [0.05, 0.05, 0.1]);
    expect(events[0]?.viseme).toBe('TH');
    expect(events[0]?.duration).toBeCloseTo(0.1, 5);
    expect(events[1]?.viseme).toBe('E');
  });

  it('maps spaces and punctuation to silence', () => {
    const events = charsToVisemes([' ', '.'], [0, 0.1], [0.1, 0.1]);
    expect(events.every((e) => e.viseme === 'sil')).toBe(true);
  });
});

describe('visemeEnvelope / co-articulation', () => {
  const ev = { viseme: 'aa' as const, start: 1.0, duration: 0.2 };

  it('is 0 outside attack/release and 1 during sustain', () => {
    expect(visemeEnvelope(ev, 0.5)).toBe(0);
    expect(visemeEnvelope(ev, 1.1)).toBe(1);
    expect(visemeEnvelope(ev, 2.0)).toBe(0);
  });

  it('ramps smoothly during attack (shape forms before the sound)', () => {
    const mid = visemeEnvelope(ev, 1.0 - 0.03);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('blends adjacent visemes without exceeding full openness', () => {
    const track = [
      { viseme: 'aa' as const, start: 0, duration: 0.1 },
      { viseme: 'O' as const, start: 0.1, duration: 0.1 },
    ];
    // At the boundary both envelopes are active; jawOpen must stay ≤ max single pose
    const w = sampleVisemes(track, 0.1);
    const maxJaw = Math.max(VISEME_TO_ARKIT.aa.jawOpen ?? 0, VISEME_TO_ARKIT.O.jawOpen ?? 0);
    expect(w.jawOpen ?? 0).toBeGreaterThan(0.2);
    expect(w.jawOpen ?? 0).toBeLessThanOrEqual(maxJaw + 1e-6);
  });

  it('returns empty weights during silence', () => {
    const track = [{ viseme: 'sil' as const, start: 0, duration: 1 }];
    expect(Object.keys(sampleVisemes(track, 0.5))).toHaveLength(0);
  });
});

describe('amplitudeToFaceWeights', () => {
  it('opens the jaw proportionally and clamps', () => {
    expect(amplitudeToFaceWeights(0).jawOpen).toBe(0);
    expect(amplitudeToFaceWeights(1).jawOpen).toBeCloseTo(0.6, 5);
    expect(amplitudeToFaceWeights(5).jawOpen).toBeCloseTo(0.6, 5);
    const mid = amplitudeToFaceWeights(0.5).jawOpen ?? 0;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.6);
  });
});
