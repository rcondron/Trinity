/**
 * Headless integration test: a scripted conversation through the full session
 * pipeline (protocol parsing → brain → events out) with mocked externals.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { parseMessage, type Message } from '@trinity-avatar/protocol';
import { Session } from '../src/session.js';
import { DemoBrain } from '../src/brains/demo.js';

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: Message[] = [];
  send(data: string): void {
    this.sent.push(parseMessage(data));
  }
  clientSend(msg: unknown): void {
    this.emit('message', JSON.stringify(msg));
  }
  waitFor(type: string, timeoutMs = 3000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const found = this.sent.find((m) => m.type === type);
        if (found) return resolve(found);
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`timeout waiting for ${type}`));
        setTimeout(poll, 10);
      };
      poll();
    });
  }
}

function makeSession() {
  const ws = new FakeSocket();
  new Session(ws as never, { brain: new DemoBrain(), elevenlabs: null, log: () => {} });
  return ws;
}

describe('Session pipeline (integration, mocked externals)', () => {
  it('sends server_status on connect, flagging fallbacks', () => {
    const ws = makeSession();
    const status = ws.sent.find((m) => m.type === 'server_status');
    expect(status).toMatchObject({ brain: 'demo', tts: 'browser' });
  });

  it('runs a full text turn: deltas stream, then structured agent_reply', async () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_text', text: 'hello trinity' });
    const reply = (await ws.waitFor('agent_reply')) as Extract<Message, { type: 'agent_reply' }>;
    expect(reply.text.toLowerCase()).toContain('hello');
    expect(reply.emotion).toBe('happy');
    expect(reply.gestures?.length).toBeGreaterThan(0);

    const deltas = ws.sent.filter((m) => m.type === 'agent_text_delta');
    expect(deltas.length).toBeGreaterThan(3); // streamed word by word
    const joined = deltas.map((d) => (d as { text: string }).text).join('');
    expect(joined).toBe(reply.text);
  });

  it('emits latency marks for instrumentation', async () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_text', text: 'hi' });
    await ws.waitFor('agent_reply');
    const stages = ws.sent.filter((m) => m.type === 'latency_mark').map((m) => (m as { stage: string }).stage);
    expect(stages).toContain('brain_first_token');
    expect(stages).toContain('brain_total');
  });

  it('accepts final transcripts (voice path) and ignores partials', async () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_transcript', text: 'who are', final: false });
    ws.clientSend({ type: 'user_transcript', text: 'who are you', final: true });
    const reply = (await ws.waitFor('agent_reply')) as Extract<Message, { type: 'agent_reply' }>;
    expect(reply.text).toContain('Trinity');
    // Only one turn ran:
    const replies = ws.sent.filter((m) => m.type === 'agent_reply');
    expect(replies).toHaveLength(1);
  });

  it('barge-in aborts the in-flight turn (no agent_reply after interrupt)', async () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_text', text: 'tell me something interesting' });
    await ws.waitFor('agent_text_delta');
    ws.clientSend({ type: 'interrupt', reason: 'barge_in' });
    await new Promise((r) => setTimeout(r, 800));
    expect(ws.sent.filter((m) => m.type === 'agent_reply')).toHaveLength(0);
  });

  it('a new utterance supersedes the previous turn', async () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_text', text: 'tell me something interesting' });
    await ws.waitFor('agent_text_delta');
    ws.clientSend({ type: 'user_text', text: 'hello' });
    await new Promise((r) => setTimeout(r, 1500));
    const replies = ws.sent.filter((m) => m.type === 'agent_reply') as Array<
      Extract<Message, { type: 'agent_reply' }>
    >;
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text.toLowerCase()).toContain('hello');
  });

  it('rejects malformed messages with a protocol error', () => {
    const ws = makeSession();
    ws.clientSend({ type: 'user_text' }); // missing text
    const err = ws.sent.find((m) => m.type === 'error');
    expect(err).toMatchObject({ code: 'bad_message' });
  });
});
