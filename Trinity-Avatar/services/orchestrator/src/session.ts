/**
 * One client session: receives user text/transcripts, runs the turn pipeline
 * (brain stream → TTS stream), emits protocol events. Everything streams;
 * nothing waits for completions. Barge-in aborts the in-flight turn.
 */
import type WebSocket from 'ws';
import {
  parseMessage,
  serializeMessage,
  type Message,
  type ServerStatus,
} from '@trinity-avatar/protocol';
import type { BrainProvider, ChatTurn } from './brains/types.js';
import { ElevenLabsTurn, type ElevenLabsOptions } from './tts/elevenlabs.js';

export interface SessionDeps {
  brain: BrainProvider;
  elevenlabs: ElevenLabsOptions | null;
  log: (msg: string) => void;
}

export class Session {
  private history: ChatTurn[] = [];
  private turnCounter = 0;
  private currentAbort: AbortController | null = null;
  private currentTts: ElevenLabsTurn | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: SessionDeps,
  ) {
    ws.on('message', (raw) => {
      let msg: Message;
      try {
        msg = parseMessage(String(raw));
      } catch (err) {
        this.send({ type: 'error', code: 'bad_message', message: String(err) });
        return;
      }
      this.handle(msg);
    });
    ws.on('close', () => this.abortTurn());
    this.sendStatus();
  }

  private send(msg: Message): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(serializeMessage(msg));
  }

  private sendStatus(): void {
    const status: ServerStatus = {
      type: 'server_status',
      brain: this.deps.brain.id,
      tts: this.deps.elevenlabs ? 'elevenlabs' : 'browser',
      stt: 'browser',
      detail: this.deps.elevenlabs ? undefined : 'no ELEVENLABS_API_KEY — client speech synthesis',
    };
    this.send(status);
  }

  private handle(msg: Message): void {
    switch (msg.type) {
      case 'client_hello':
        this.sendStatus();
        break;
      case 'user_text':
        void this.runTurn(msg.text);
        break;
      case 'user_transcript':
        if (msg.final && msg.text.trim()) void this.runTurn(msg.text);
        break;
      case 'interrupt':
        this.abortTurn();
        break;
      default:
        // Client shouldn't send anything else; ignore quietly.
        break;
    }
  }

  private abortTurn(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.currentTts?.abort();
    this.currentTts = null;
  }

  private async runTurn(userText: string): Promise<void> {
    this.abortTurn(); // implicit barge-in: a new utterance supersedes the old turn
    const turnId = `t${++this.turnCounter}`;
    const abort = new AbortController();
    this.currentAbort = abort;
    const t0 = Date.now();
    let firstToken = 0;
    let firstAudio = 0;

    this.history.push({ role: 'user', content: userText });
    if (this.history.length > 24) this.history = this.history.slice(-24);

    // TTS turn opens in parallel with the brain call so its WS handshake
    // doesn't add to first-audio latency.
    let tts: ElevenLabsTurn | null = null;
    if (this.deps.elevenlabs) {
      tts = new ElevenLabsTurn(this.deps.elevenlabs, {
        onAudio: (audioB64, seq, sampleRate) => {
          if (abort.signal.aborted) return;
          if (!firstAudio) {
            firstAudio = Date.now();
            this.send({ type: 'latency_mark', turnId, stage: 'tts_first_audio', ms: firstAudio - t0 });
          }
          this.send({ type: 'tts_audio_chunk', turnId, seq, audioB64, sampleRate, format: 'pcm_s16le' });
        },
        onTimestamps: (chars, startTimes, durations) => {
          if (!abort.signal.aborted) {
            this.send({ type: 'tts_timestamps', turnId, chars, startTimes, durations });
          }
        },
        onEnd: () => this.send({ type: 'tts_end', turnId }),
        onError: (err) => {
          this.deps.log(`elevenlabs error: ${err.message}`);
          this.send({ type: 'error', code: 'tts_failed', message: err.message });
          this.send({ type: 'tts_end', turnId });
        },
      });
      this.currentTts = tts;
    }

    try {
      const reply = await this.deps.brain.respond(
        this.history,
        (delta) => {
          if (abort.signal.aborted) return;
          if (!firstToken) {
            firstToken = Date.now();
            this.send({ type: 'latency_mark', turnId, stage: 'brain_first_token', ms: firstToken - t0 });
          }
          this.send({ type: 'agent_text_delta', turnId, text: delta });
          void tts?.sendText(delta);
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;

      this.send({ type: 'latency_mark', turnId, stage: 'brain_total', ms: Date.now() - t0 });
      this.history.push({ role: 'assistant', content: reply.text });

      // Full structured reply: emotion, gestures, locomotion, gaze.
      this.send({
        type: 'agent_reply',
        turnId,
        text: reply.text,
        emotion: reply.emotion,
        gestures: reply.gestures,
        ...(reply.locomotion ? { locomotion: reply.locomotion } : {}),
        ...(reply.gaze ? { gaze: reply.gaze } : {}),
      });
      await tts?.end();
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.log(`turn failed: ${message}`);
        this.send({ type: 'error', code: 'brain_failed', message });
        tts?.abort();
        this.send({ type: 'tts_end', turnId });
      }
    } finally {
      if (this.currentAbort === abort) this.currentAbort = null;
      if (this.currentTts === tts) this.currentTts = null;
    }
  }
}
