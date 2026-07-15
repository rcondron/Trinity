/**
 * Hermes brain — any OpenAI-compatible endpoint (vLLM, llama.cpp server,
 * hosted). Structured output protocol: the model's first line is a JSON
 * control object (emotion/gestures/locomotion/gaze), everything after is the
 * spoken reply, streamed as deltas. This works identically across backends
 * that differ in function-calling support (see ADR-0003).
 */
import type { EmotionLabel, GestureCue } from '@trinity-avatar/protocol';
import {
  EMOTIONS,
  GESTURE_VOCAB,
  type BrainProvider,
  type ChatTurn,
  type StructuredReply,
} from './types.js';

const SYSTEM_PROMPT = `You are Trinity, a helpful embodied AI avatar having a spoken conversation. Keep replies conversational and under 80 words unless asked for detail.

OUTPUT FORMAT — strict:
Line 1: a single-line JSON object: {"emotion": E, "gestures": [{"prompt": G, "atChar": N}...], "locomotion": {"mode": M}, "gaze": {"target": T}}
  - E one of: ${EMOTIONS.join(', ')}
  - G short behavior prompts such as: ${GESTURE_VOCAB.join('; ')} (0-2 gestures; atChar = character index in your reply where the gesture should start)
  - M one of: idle, pace, approach, retreat, wander (omit locomotion if unchanged)
  - T one of: user, away, up_thinking, down (omit if just looking at the user)
Line 2+: your spoken reply as plain natural text. No markdown, no emoji, no stage directions.`;

interface ParsedControl {
  emotion?: EmotionLabel;
  gestures?: GestureCue[];
  locomotion?: StructuredReply['locomotion'];
  gaze?: StructuredReply['gaze'];
}

export function parseControlLine(line: string): ParsedControl {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const out: ParsedControl = {};
    if (typeof obj.emotion === 'string' && (EMOTIONS as string[]).includes(obj.emotion)) {
      out.emotion = obj.emotion as EmotionLabel;
    }
    if (Array.isArray(obj.gestures)) {
      out.gestures = obj.gestures
        .filter((g): g is { prompt: string; atChar?: number } =>
          typeof g === 'object' && g !== null && typeof (g as { prompt?: unknown }).prompt === 'string',
        )
        .slice(0, 3)
        .map((g) => ({ prompt: g.prompt, ...(typeof g.atChar === 'number' ? { atChar: Math.max(0, g.atChar | 0) } : {}) }));
    }
    const loco = obj.locomotion as { mode?: string; speed?: number } | undefined;
    if (loco && typeof loco.mode === 'string' && ['idle', 'pace', 'approach', 'retreat', 'wander'].includes(loco.mode)) {
      out.locomotion = { mode: loco.mode as NonNullable<StructuredReply['locomotion']>['mode'], ...(typeof loco.speed === 'number' ? { speed: loco.speed } : {}) };
    }
    const gaze = obj.gaze as { target?: string } | undefined;
    if (gaze && typeof gaze.target === 'string' && ['user', 'away', 'up_thinking', 'down'].includes(gaze.target)) {
      out.gaze = { target: gaze.target as NonNullable<StructuredReply['gaze']>['target'] };
    }
    return out;
  } catch {
    return {};
  }
}

export class HermesBrain implements BrainProvider {
  readonly id = 'hermes' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async respond(
    history: ChatTurn[],
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<StructuredReply> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        temperature: 0.8,
        max_tokens: 400,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Hermes endpoint ${res.status}: ${await res.text().catch(() => '')}`);
    }

    let controlLine = '';
    let sawControl = false;
    let spoken = '';
    const decoder = new TextDecoder();
    let sseBuf = '';

    const handleToken = (token: string) => {
      if (!sawControl) {
        const nl = token.indexOf('\n');
        if (nl === -1) {
          controlLine += token;
          return;
        }
        controlLine += token.slice(0, nl);
        sawControl = true;
        const rest = token.slice(nl + 1);
        if (rest) {
          spoken += rest;
          onDelta(rest);
        }
        return;
      }
      spoken += token;
      onDelta(token);
    };

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      sseBuf += decoder.decode(value, { stream: true });
      const lines = sseBuf.split('\n');
      sseBuf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = chunk.choices?.[0]?.delta?.content;
          if (token) handleToken(token);
        } catch {
          // ignore malformed keepalive lines
        }
      }
    }

    // Model ignored the format? Treat everything as spoken text.
    if (!sawControl && controlLine && !controlLine.trimStart().startsWith('{')) {
      spoken = controlLine;
      onDelta(controlLine);
      controlLine = '';
    }

    const control = parseControlLine(controlLine.trim());
    const text = spoken.trim() || '…';
    return {
      text,
      emotion: control.emotion ?? 'neutral',
      gestures: control.gestures ?? [],
      ...(control.locomotion ? { locomotion: control.locomotion } : {}),
      ...(control.gaze ? { gaze: control.gaze } : {}),
    };
  }
}
