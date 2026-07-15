/**
 * Trinity brain — routes the conversation through this repo's Trinity Bridge
 * (host-side gatekeeper, default :4711), which relays to the Trinity agent
 * gateway. The Bridge API is non-streaming (POST /chat → {reply}), so the
 * reply arrives as one delta; behavior directives are inferred from the text
 * since the agent doesn't emit them natively.
 */
import type { EmotionLabel } from '@trinity-avatar/protocol';
import type { BrainProvider, ChatTurn, StructuredReply } from './types.js';

/** Cheap sentiment/keyword pass so the avatar still emotes on bridge replies. */
export function inferBehavior(text: string): Pick<StructuredReply, 'emotion' | 'gestures'> {
  const t = text.toLowerCase();
  let emotion: EmotionLabel = 'neutral';
  if (/\b(great|awesome|glad|happy|perfect|excellent|done!)\b/.test(t)) emotion = 'happy';
  else if (/\b(hmm|let me think|considering|complex|interesting)\b/.test(t)) emotion = 'thoughtful';
  else if (/\b(sorry|unfortunately|problem|error|failed|can.t)\b/.test(t)) emotion = 'concerned';
  else if (/\b(wow|surprising|unexpected)\b/.test(t)) emotion = 'surprised';
  else if (/(haha|heh|funny|:\))/.test(t)) emotion = 'amused';

  const gestures: StructuredReply['gestures'] = [];
  if (/^(hi|hello|hey)\b/.test(t)) gestures.push({ prompt: 'wave hello', atChar: 0 });
  else if (emotion === 'thoughtful') gestures.push({ prompt: 'hand on chin thinking', atChar: 0 });
  else if (/\?\s*$/.test(text)) gestures.push({ prompt: 'lean forward attentively', atChar: 0 });
  return { emotion, gestures };
}

export class TrinityBrain implements BrainProvider {
  readonly id = 'trinity' as const;

  constructor(
    private readonly bridgeUrl: string,
    private readonly token: string,
    private readonly conversationId = 'avatar',
  ) {}

  /** Reachability probe used at startup for backend selection. */
  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.bridgeUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async respond(
    history: ChatTurn[],
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<StructuredReply> {
    const last = history.filter((t) => t.role === 'user').at(-1)?.content ?? '';
    const res = await fetch(`${this.bridgeUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'X-Trinity-Token': this.token } : {}),
      },
      body: JSON.stringify({ message: last, conversationId: this.conversationId }),
      signal,
    });
    if (!res.ok) throw new Error(`Trinity bridge ${res.status}`);
    const data = (await res.json()) as { reply?: string };
    const text = (data.reply ?? '').trim() || 'The agent returned an empty reply.';
    onDelta(text);
    return { text, ...inferBehavior(text) };
  }
}
