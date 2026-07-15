import { describe, expect, it } from 'vitest';
import { parseControlLine } from '../src/brains/hermes.js';
import { inferBehavior } from '../src/brains/trinity.js';
import { DemoBrain } from '../src/brains/demo.js';

describe('parseControlLine (Hermes structured output)', () => {
  it('parses a full control object', () => {
    const c = parseControlLine(
      '{"emotion":"happy","gestures":[{"prompt":"wave hello","atChar":0}],"locomotion":{"mode":"pace","speed":0.5},"gaze":{"target":"user"}}',
    );
    expect(c.emotion).toBe('happy');
    expect(c.gestures?.[0]?.prompt).toBe('wave hello');
    expect(c.locomotion?.mode).toBe('pace');
    expect(c.gaze?.target).toBe('user');
  });

  it('drops invalid emotion labels and malformed gestures', () => {
    const c = parseControlLine('{"emotion":"rage","gestures":[{"nope":1},{"prompt":"nod in agreement"}]}');
    expect(c.emotion).toBeUndefined();
    expect(c.gestures).toHaveLength(1);
    expect(c.gestures?.[0]?.prompt).toBe('nod in agreement');
  });

  it('returns empty control for garbage input', () => {
    expect(parseControlLine('not json at all')).toEqual({});
    expect(parseControlLine('')).toEqual({});
  });
});

describe('inferBehavior (Trinity bridge replies)', () => {
  it('detects positive sentiment', () => {
    expect(inferBehavior('Great, that worked perfectly!').emotion).toBe('happy');
  });
  it('detects apologetic/error tone', () => {
    expect(inferBehavior('Sorry, the backup failed with an error.').emotion).toBe('concerned');
  });
  it('adds a wave for greetings', () => {
    const b = inferBehavior('Hello! How can I help?');
    expect(b.gestures?.[0]?.prompt).toBe('wave hello');
  });
});

describe('DemoBrain', () => {
  it('streams deltas and returns a structured reply', async () => {
    const brain = new DemoBrain();
    let streamed = '';
    const reply = await brain.respond(
      [{ role: 'user', content: 'hello there' }],
      (d) => (streamed += d),
      new AbortController().signal,
    );
    expect(reply.text.length).toBeGreaterThan(0);
    expect(streamed).toBe(reply.text);
    expect(reply.emotion).toBe('happy');
    expect(reply.gestures?.some((g) => g.prompt.includes('wave'))).toBe(true);
  });

  it('stops streaming when aborted', async () => {
    const brain = new DemoBrain();
    const ac = new AbortController();
    let count = 0;
    await brain.respond(
      [{ role: 'user', content: 'hello' }],
      () => {
        if (++count === 2) ac.abort();
      },
      ac.signal,
    );
    expect(count).toBeLessThan(5);
  });
});
