/**
 * Demo persona — the zero-keys fallback brain. A small scripted character so
 * the whole pipeline (TTS, visemes, emotions, gestures) demos out of the box.
 */
import type { BrainProvider, ChatTurn, StructuredReply } from './types.js';

interface Rule {
  match: RegExp;
  replies: Array<Omit<StructuredReply, 'gestures'> & { gestures?: StructuredReply['gestures'] }>;
}

const RULES: Rule[] = [
  {
    match: /\b(hi|hello|hey|greetings|good (morning|afternoon|evening))\b/i,
    replies: [
      {
        text: "Hello! I'm Trinity. It's good to see you. Ask me anything — or just say what's on your mind.",
        emotion: 'happy',
        gestures: [{ prompt: 'wave hello', atChar: 0 }],
      },
    ],
  },
  {
    match: /\b(who|what) are you\b/i,
    replies: [
      {
        text: "I'm Trinity — an embodied interface to your agent. Right now I'm running in demo mode: no language model, no cloud voice. Plug in Hermes or the Trinity bridge and I get a lot smarter.",
        emotion: 'thoughtful',
        gestures: [{ prompt: 'open arms welcoming', atChar: 0 }],
      },
    ],
  },
  {
    match: /\b(how are you|how's it going|how do you feel)\b/i,
    replies: [
      {
        text: "All systems nominal! Renderer's warm, blink timers ticking, and my gesture library is itching to be used.",
        emotion: 'amused',
        gestures: [{ prompt: 'shrug', atChar: 20 }],
      },
    ],
  },
  {
    match: /\b(wave|say hi)\b/i,
    replies: [
      {
        text: 'Sure — hello there!',
        emotion: 'happy',
        gestures: [{ prompt: 'wave hello', atChar: 0 }],
      },
    ],
  },
  {
    match: /\b(walk|pace|move around)\b/i,
    replies: [
      {
        text: 'Stretching my legs. A body is wasted if you never use it.',
        emotion: 'amused',
        locomotion: { mode: 'pace', speed: 0.5 },
      },
    ],
  },
  {
    match: /\b(stop|stand still|hold)\b/i,
    replies: [
      {
        text: 'Standing by.',
        emotion: 'neutral',
        locomotion: { mode: 'idle' },
        gestures: [{ prompt: 'stand at ease', atChar: 0 }],
      },
    ],
  },
  {
    match: /\b(think|hmm|puzzle|riddle|hard question)\b/i,
    replies: [
      {
        text: "Hmm. Let me think about that for a moment... I'd say the answer depends on what you're really asking.",
        emotion: 'thoughtful',
        gestures: [{ prompt: 'hand on chin thinking', atChar: 0 }],
        gaze: { target: 'up_thinking' },
      },
    ],
  },
  {
    match: /\b(wow|amazing|incredible|no way)\b/i,
    replies: [
      {
        text: 'I know, right? The future arrived while nobody was looking.',
        emotion: 'surprised',
      },
    ],
  },
  {
    match: /\b(bye|goodbye|see you|later)\b/i,
    replies: [
      {
        text: 'Goodbye! Come back any time — I literally have nowhere else to be.',
        emotion: 'happy',
        gestures: [{ prompt: 'wave hello', atChar: 0 }],
      },
    ],
  },
];

const DEFAULTS: StructuredReply[] = [
  {
    text: "That's interesting. I'm only the demo persona, so my depth is limited — connect a Hermes endpoint or your Trinity agent and ask me again.",
    emotion: 'thoughtful',
    gestures: [{ prompt: 'hand on chin thinking', atChar: 0 }],
  },
  {
    text: "I hear you. In demo mode I mostly do smalltalk, gestures and dramatic pauses... but I do those very well.",
    emotion: 'amused',
    gestures: [{ prompt: 'shrug', atChar: 10 }],
  },
  {
    text: 'Noted. Try asking who I am, tell me to wave, walk, or give me something to think about.',
    emotion: 'neutral',
    gestures: [{ prompt: 'lean forward attentively', atChar: 0 }],
  },
];

export class DemoBrain implements BrainProvider {
  readonly id = 'demo' as const;
  private fallbackIdx = 0;

  async respond(
    history: ChatTurn[],
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<StructuredReply> {
    const last = history.filter((t) => t.role === 'user').at(-1)?.content ?? '';
    const rule = RULES.find((r) => r.match.test(last));
    const template = rule
      ? rule.replies[Math.floor(Math.random() * rule.replies.length)]!
      : DEFAULTS[this.fallbackIdx++ % DEFAULTS.length]!;
    const reply: StructuredReply = { gestures: [], ...template };

    // Stream word by word like a real model would.
    const words = reply.text.split(/(?<= )/);
    for (const w of words) {
      if (signal.aborted) break;
      onDelta(w);
      await new Promise((r) => setTimeout(r, 24));
    }
    return reply;
  }
}
