/**
 * Streaming audio playback. PCM chunks are scheduled back-to-back on the Web
 * Audio clock, which doubles as the lip-sync clock: `clock()` returns seconds
 * of audio actually played for the current turn, so visemes stay glued to
 * sound even under network jitter.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private nextStartAt = 0;
  private turnStartAt = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private gain: GainNode | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock(): void {
    this.ensureCtx();
  }

  beginTurn(): void {
    const ctx = this.ensureCtx();
    this.stopAll();
    this.gain!.gain.cancelScheduledValues(ctx.currentTime);
    this.gain!.gain.setValueAtTime(1, ctx.currentTime);
    // Small priming offset so the first chunk never lands in the past.
    this.turnStartAt = ctx.currentTime + 0.05;
    this.nextStartAt = this.turnStartAt;
  }

  /** Seconds of turn audio elapsed (the viseme clock). */
  clock = (): number => {
    if (!this.ctx) return 0;
    return Math.max(0, this.ctx.currentTime - this.turnStartAt);
  };

  /** Queue a base64 s16le PCM chunk. */
  enqueuePcm(audioB64: string, sampleRate: number): void {
    const ctx = this.ensureCtx();
    const bin = atob(audioB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = (samples[i] ?? 0) / 32768;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain!);
    const startAt = Math.max(this.nextStartAt, ctx.currentTime);
    src.start(startAt);
    this.nextStartAt = startAt + buffer.duration;
    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
  }

  /** True while queued audio still extends beyond "now". */
  get playing(): boolean {
    return this.ctx !== null && this.nextStartAt > this.ctx.currentTime;
  }

  /** Barge-in: fade out fast (30 ms) and drop the queue. */
  stopAll(): void {
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + 0.03);
    for (const src of this.activeSources) {
      try {
        src.stop(t + 0.035);
      } catch {
        // already stopped
      }
    }
    this.activeSources.clear();
    this.nextStartAt = t;
  }
}

/**
 * Browser TTS fallback (no ElevenLabs key): SpeechSynthesis + a synthetic
 * amplitude envelope for lip sync — speechSynthesis audio can't be analysed,
 * so we shape a plausible mouth envelope from word boundary events.
 */
export class BrowserTts {
  private utterance: SpeechSynthesisUtterance | null = null;
  private speaking = false;
  private lastBoundaryAt = 0;

  speak(text: string, onEnd: () => void): void {
    this.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    u.pitch = 1.0;
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices[0];
    if (preferred) u.voice = preferred;
    u.onboundary = () => {
      this.lastBoundaryAt = performance.now();
    };
    u.onend = u.onerror = () => {
      this.speaking = false;
      this.utterance = null;
      onEnd();
    };
    this.utterance = u;
    this.speaking = true;
    this.lastBoundaryAt = performance.now();
    speechSynthesis.speak(u);
  }

  /** 0..1 synthetic mouth amplitude. */
  amplitude = (): number => {
    if (!this.speaking) return 0;
    const t = performance.now() / 1000;
    const sinceBoundary = (performance.now() - this.lastBoundaryAt) / 1000;
    // Syllable-ish oscillation, damped between word boundaries.
    const syllable = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 4.2) * Math.sin(t * 2 * Math.PI * 1.7 + 1);
    const damp = Math.max(0.15, 1 - sinceBoundary * 1.2);
    return Math.max(0, Math.min(1, syllable * damp));
  };

  get isSpeaking(): boolean {
    return this.speaking;
  }

  cancel(): void {
    this.speaking = false;
    this.utterance = null;
    speechSynthesis.cancel();
  }
}
