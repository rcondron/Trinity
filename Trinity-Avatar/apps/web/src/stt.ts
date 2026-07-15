/**
 * Speech input via the Web Speech API with two modes:
 *  - push-to-talk: hold the mic button
 *  - open mic: continuous recognition with interim results as voice activity
 * Interim speech while the avatar is talking triggers barge-in.
 */

type SpeechRecognitionCtor = new () => SpeechRecognition;

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface SttHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onVoiceActivity(): void;
  onStateChange(listening: boolean): void;
  onUnavailable(): void;
}

export class SpeechInput {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private openMic = false;
  readonly available: boolean;

  constructor(private readonly handlers: SttHandlers) {
    const Ctor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    this.available = Boolean(Ctor);
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (!text) continue;
        this.handlers.onVoiceActivity();
        if (r.isFinal) this.handlers.onFinal(text);
        else this.handlers.onPartial(text);
      }
    };
    rec.onend = () => {
      this.listening = false;
      this.handlers.onStateChange(false);
      // Open mic auto-restarts (browsers time recognition out periodically).
      if (this.openMic) this.start();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.openMic = false;
        this.handlers.onUnavailable();
      }
    };
    this.recognition = rec;
  }

  get isListening(): boolean {
    return this.listening;
  }

  get isOpenMic(): boolean {
    return this.openMic;
  }

  start(): void {
    if (!this.recognition) {
      this.handlers.onUnavailable();
      return;
    }
    if (this.listening) return;
    try {
      this.recognition.start();
      this.listening = true;
      this.handlers.onStateChange(true);
    } catch {
      // start() throws if called while already started — safe to ignore
    }
  }

  stop(): void {
    this.openMic = false;
    this.recognition?.stop();
  }

  toggleOpenMic(): boolean {
    if (this.openMic) {
      this.stop();
      return false;
    }
    this.openMic = true;
    this.start();
    return true;
  }
}
