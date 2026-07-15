/**
 * Connection to the orchestrator. If the WebSocket can't be established the
 * client degrades to a tiny local persona so the app still demos with no
 * backend at all (that state is flagged in the status pills + debug overlay).
 */
import {
  parseMessage,
  serializeMessage,
  type Message,
  type ServerStatus,
} from '@trinity-avatar/protocol';

export type SessionEvents = {
  onMessage(msg: Message): void;
  onConnectionChange(connected: boolean): void;
};

const LOCAL_REPLIES: Array<{ match: RegExp; text: string; emotion: 'happy' | 'thoughtful' | 'amused' | 'neutral'; gesture?: string }> = [
  { match: /\b(hi|hello|hey)\b/i, text: 'Hello! The orchestrator is offline, so this is my minimal on-device persona — but the animation stack is fully live.', emotion: 'happy', gesture: 'wave hello' },
  { match: /\bwave\b/i, text: 'Waving!', emotion: 'happy', gesture: 'wave hello' },
  { match: /\bwalk|pace\b/i, text: 'Walking it off.', emotion: 'amused', gesture: 'pace slowly' },
  { match: /think|hmm/i, text: 'Let me pretend to think about that very hard.', emotion: 'thoughtful', gesture: 'hand on chin thinking' },
];

export class SessionClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private localTurn = 0;
  private reconnectDelay = 1000;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly events: SessionEvents,
  ) {
    this.connect();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.events.onConnectionChange(true);
      this.ws?.send(serializeMessage({ type: 'client_hello', capabilities: { sttMode: 'client' } }));
    };
    this.ws.onmessage = (e) => {
      try {
        this.events.onMessage(parseMessage(String(e.data)));
      } catch (err) {
        console.warn('[session] invalid message from server', err);
      }
    };
    this.ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.events.onConnectionChange(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(15000, this.reconnectDelay * 1.7);
  }

  send(msg: Message): void {
    if (this.connected && this.ws) {
      this.ws.send(serializeMessage(msg));
    }
  }

  /** Submit a user utterance; falls back to the local persona when offline. */
  submitUtterance(text: string): void {
    if (this.connected) {
      this.send({ type: 'user_text', text, tClientSent: performance.now() });
      return;
    }
    this.runLocalTurn(text);
  }

  interrupt(): void {
    this.send({ type: 'interrupt', reason: 'barge_in' });
  }

  private runLocalTurn(text: string): void {
    const turnId = `local${++this.localTurn}`;
    const rule = LOCAL_REPLIES.find((r) => r.match.test(text));
    const reply = rule ?? {
      text: "I'm running without any backend right now — start the orchestrator (pnpm dev) for real conversations. Meanwhile: try 'wave', 'walk' or 'think'.",
      emotion: 'neutral' as const,
      gesture: undefined,
    };
    const status: ServerStatus = { type: 'server_status', brain: 'demo', tts: 'browser', stt: 'browser', detail: 'orchestrator offline — on-device persona' };
    this.events.onMessage(status);
    this.events.onMessage({
      type: 'agent_reply',
      turnId,
      text: reply.text,
      emotion: reply.emotion,
      gestures: reply.gesture ? [{ prompt: reply.gesture, atChar: 0 }] : [],
    });
  }

  dispose(): void {
    this.closedByUser = true;
    this.ws?.close();
  }
}
