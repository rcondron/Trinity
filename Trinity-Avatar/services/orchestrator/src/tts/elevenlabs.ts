/**
 * ElevenLabs streaming TTS over WebSocket (stream-input API) with character
 * alignment enabled — the timestamps drive lip sync on the client.
 *
 * Audio is requested as PCM so the client can schedule chunks sample-exactly
 * against its Web Audio clock (see docs/latency-tuning.md).
 */
import WebSocket from 'ws';

export interface TtsHandlers {
  onAudio(audioB64: string, seq: number, sampleRate: number): void;
  onTimestamps(chars: string[], startTimes: number[], durations: number[]): void;
  onEnd(): void;
  onError(err: Error): void;
}

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  /** e.g. pcm_16000, pcm_22050, pcm_44100 */
  outputFormat: string;
}

interface AlignmentPayload {
  chars: string[];
  charStartTimesMs: number[];
  charDurationsMs: number[];
}

export function sampleRateOf(outputFormat: string): number {
  const m = /^pcm_(\d+)$/.exec(outputFormat);
  return m ? Number(m[1]) : 16000;
}

/**
 * One streaming synthesis turn. Returns a handle that accepts text deltas as
 * the brain produces them and can be aborted for barge-in.
 */
export class ElevenLabsTurn {
  private ws: WebSocket;
  private seq = 0;
  private closed = false;
  private opened: Promise<void>;

  constructor(
    private readonly opts: ElevenLabsOptions,
    private readonly handlers: TtsHandlers,
  ) {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/stream-input` +
      `?model_id=${encodeURIComponent(opts.modelId)}` +
      `&output_format=${encodeURIComponent(opts.outputFormat)}` +
      `&sync_alignment=true&auto_mode=true`;
    this.ws = new WebSocket(url, { headers: { 'xi-api-key': opts.apiKey } });

    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => {
        // Handshake message; voice settings tuned for conversational latency.
        this.ws.send(
          JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.45, similarity_boost: 0.8, use_speaker_boost: false },
          }),
        );
        resolve();
      });
      this.ws.once('error', (err) => reject(err));
    });

    const sampleRate = sampleRateOf(opts.outputFormat);
    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          audio?: string;
          alignment?: AlignmentPayload;
          normalizedAlignment?: AlignmentPayload;
          isFinal?: boolean;
          error?: string;
          message?: string;
        };
        if (msg.error) {
          this.handlers.onError(new Error(`${msg.error}: ${msg.message ?? ''}`));
          return;
        }
        if (msg.audio) this.handlers.onAudio(msg.audio, this.seq++, sampleRate);
        const align = msg.alignment ?? msg.normalizedAlignment;
        if (align?.chars?.length) {
          this.handlers.onTimestamps(
            align.chars,
            align.charStartTimesMs.map((v) => v / 1000),
            align.charDurationsMs.map((v) => v / 1000),
          );
        }
        if (msg.isFinal) this.finish();
      } catch (err) {
        this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });
    this.ws.on('error', (err) => {
      if (!this.closed) this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
    });
    this.ws.on('close', () => this.finish());
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onEnd();
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }

  /** Feed a text delta from the brain stream. */
  async sendText(delta: string): Promise<void> {
    await this.opened;
    if (this.closed || !delta) return;
    this.ws.send(JSON.stringify({ text: delta }));
  }

  /** No more text: flush remaining synthesis. */
  async end(): Promise<void> {
    await this.opened.catch(() => undefined);
    if (this.closed) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ text: '' }));
  }

  /** Barge-in: stop immediately. */
  abort(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // already closing
    }
  }
}
