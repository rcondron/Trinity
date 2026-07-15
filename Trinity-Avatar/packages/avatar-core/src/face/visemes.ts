/**
 * Lip sync: character-level TTS timestamps → viseme curves → ARKit blendshapes.
 *
 * ElevenLabs streams character timings (char, start, duration). We map each
 * character to one of the 15 Oculus-style visemes with a grapheme heuristic
 * (digraph-aware), then sample overlapping attack/sustain/release envelopes
 * so adjacent visemes blend into each other (co-articulation).
 */
import type { FaceWeights } from './arkit.js';
import { addWeights } from './arkit.js';
import { clamp } from '../math.js';

export type Viseme =
  | 'sil'
  | 'PP'
  | 'FF'
  | 'TH'
  | 'DD'
  | 'kk'
  | 'CH'
  | 'SS'
  | 'nn'
  | 'RR'
  | 'aa'
  | 'E'
  | 'I'
  | 'O'
  | 'U';

/** Each viseme as a sparse ARKit pose at weight 1. */
export const VISEME_TO_ARKIT: Record<Viseme, FaceWeights> = {
  sil: {},
  PP: { mouthClose: 0.9, mouthPressLeft: 0.6, mouthPressRight: 0.6, jawOpen: 0.05 },
  FF: { mouthFunnel: 0.25, mouthLowerDownLeft: 0.4, mouthLowerDownRight: 0.4, jawOpen: 0.12 },
  TH: { jawOpen: 0.2, tongueOut: 0.35, mouthStretchLeft: 0.15, mouthStretchRight: 0.15 },
  DD: { jawOpen: 0.22, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  kk: { jawOpen: 0.28, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  CH: { jawOpen: 0.2, mouthFunnel: 0.5, mouthPucker: 0.3 },
  SS: { jawOpen: 0.12, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 },
  nn: { jawOpen: 0.15, mouthClose: 0.2 },
  RR: { jawOpen: 0.2, mouthPucker: 0.35, mouthFunnel: 0.2 },
  aa: { jawOpen: 0.7, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  E: { jawOpen: 0.35, mouthSmileLeft: 0.3, mouthSmileRight: 0.3, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  I: { jawOpen: 0.22, mouthSmileLeft: 0.4, mouthSmileRight: 0.4 },
  O: { jawOpen: 0.5, mouthFunnel: 0.6, mouthPucker: 0.4 },
  U: { jawOpen: 0.25, mouthPucker: 0.75, mouthFunnel: 0.45 },
};

const DIGRAPHS: Record<string, Viseme> = {
  th: 'TH',
  sh: 'CH',
  ch: 'CH',
  ph: 'FF',
  ng: 'nn',
  oo: 'U',
  ou: 'U',
  ow: 'O',
  ee: 'I',
  ea: 'I',
  ai: 'E',
  ay: 'E',
  qu: 'kk',
};

const SINGLE: Record<string, Viseme> = {
  a: 'aa',
  e: 'E',
  i: 'I',
  o: 'O',
  u: 'U',
  y: 'I',
  b: 'PP',
  p: 'PP',
  m: 'PP',
  f: 'FF',
  v: 'FF',
  d: 'DD',
  t: 'DD',
  k: 'kk',
  g: 'kk',
  c: 'kk',
  q: 'kk',
  x: 'SS',
  s: 'SS',
  z: 'SS',
  j: 'CH',
  n: 'nn',
  l: 'nn',
  r: 'RR',
  w: 'U',
  h: 'sil',
};

export interface VisemeEvent {
  viseme: Viseme;
  /** Seconds relative to the start of the turn's audio. */
  start: number;
  duration: number;
}

/**
 * Convert character timestamps into a viseme track. Digraphs collapse two
 * characters into one event spanning both durations.
 */
export function charsToVisemes(
  chars: readonly string[],
  startTimes: readonly number[],
  durations: readonly number[],
): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = (chars[i] ?? '').toLowerCase();
    const next = (chars[i + 1] ?? '').toLowerCase();
    const start = startTimes[i] ?? 0;
    let duration = durations[i] ?? 0;
    let viseme: Viseme | undefined;

    const pair = c + next;
    if (DIGRAPHS[pair] !== undefined && next !== '') {
      viseme = DIGRAPHS[pair];
      duration += durations[i + 1] ?? 0;
      i += 2;
    } else {
      viseme = SINGLE[c];
      if (viseme === undefined) viseme = /\s|[.,!?;:]/.test(c) || c === '' ? 'sil' : undefined;
      i += 1;
    }
    if (viseme === undefined) continue; // digits, quotes, etc. — hold previous mouth shape
    const prev = events[events.length - 1];
    if (prev && prev.viseme === viseme && start - (prev.start + prev.duration) < 0.02) {
      prev.duration = start + duration - prev.start;
    } else {
      events.push({ viseme, start, duration });
    }
  }
  return events;
}

export interface CoarticulationOptions {
  /** Seconds the mouth takes to form the shape before the sound. */
  attack: number;
  /** Seconds the shape lingers after the sound. */
  release: number;
}

export const DEFAULT_COARTICULATION: CoarticulationOptions = { attack: 0.06, release: 0.09 };

/** Envelope of one viseme event at time t: 0 outside, 1 during sustain, eased edges. */
export function visemeEnvelope(
  ev: VisemeEvent,
  t: number,
  opts: CoarticulationOptions = DEFAULT_COARTICULATION,
): number {
  const a0 = ev.start - opts.attack;
  const s1 = ev.start + ev.duration;
  const r1 = s1 + opts.release;
  if (t <= a0 || t >= r1) return 0;
  if (t < ev.start) {
    const x = (t - a0) / opts.attack;
    return x * x * (3 - 2 * x); // smoothstep in
  }
  if (t <= s1) return 1;
  const x = 1 - (t - s1) / opts.release;
  return x * x * (3 - 2 * x); // smoothstep out
}

/**
 * Sample the viseme track at time t → blended ARKit weights.
 * Overlapping envelopes are normalized so co-articulated shapes average
 * rather than stack (mouth can't be 140% open).
 */
export function sampleVisemes(
  track: readonly VisemeEvent[],
  t: number,
  opts: CoarticulationOptions = DEFAULT_COARTICULATION,
): FaceWeights {
  const out: FaceWeights = {};
  let total = 0;
  const active: Array<{ viseme: Viseme; w: number }> = [];
  for (const ev of track) {
    if (ev.viseme === 'sil') continue;
    const w = visemeEnvelope(ev, t, opts);
    if (w > 0.001) {
      active.push({ viseme: ev.viseme, w });
      total += w;
    }
  }
  if (total === 0) return out;
  const norm = total > 1 ? 1 / total : 1;
  for (const { viseme, w } of active) {
    addWeights(out, VISEME_TO_ARKIT[viseme], clamp(w * norm, 0, 1));
  }
  return out;
}

/**
 * Fallback lip sync when no timestamps exist (browser TTS): mouth openness
 * proportional to an audio amplitude envelope, with light shaping so it
 * doesn't look like a flapping hinge.
 */
export function amplitudeToFaceWeights(amplitude01: number): FaceWeights {
  const a = clamp(amplitude01, 0, 1);
  const open = Math.pow(a, 0.7);
  return {
    jawOpen: open * 0.6,
    mouthFunnel: open * 0.15,
    mouthStretchLeft: open * 0.1,
    mouthStretchRight: open * 0.1,
  };
}
