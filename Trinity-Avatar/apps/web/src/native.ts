/**
 * Capacitor (native app) bridge.
 *
 * Android WebViews ship neither the Web Speech API (SpeechRecognition) nor
 * reliable speechSynthesis, so inside the native app we route voice through
 * Capacitor community plugins instead:
 *   - @capacitor-community/speech-recognition  (mic → text)
 *   - @capacitor-community/text-to-speech      (text → voice, fallback TTS)
 *
 * The plugins are dependencies of apps/mobile only; here we reach them via
 * the global Capacitor bridge (registerPlugin proxies straight to native
 * code), so the web bundle stays free of Capacitor packages and keeps
 * working in plain browsers.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: <T>(name: string) => T;
}

const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

export const isNativeApp: boolean = capacitor?.isNativePlatform?.() ?? false;
export const nativePlatform: string = capacitor?.getPlatform?.() ?? 'web';

function plugin<T>(name: string): T | null {
  try {
    return capacitor?.registerPlugin?.<T>(name) ?? null;
  } catch {
    return null;
  }
}

// ── Plugin surfaces (the subset we call) ─────────────────────────────────────

interface SpeechRecognitionPlugin {
  available(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  checkPermissions(): Promise<{ speechRecognition: string }>;
  start(opts: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    popup?: boolean;
  }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  addListener(
    event: 'partialResults',
    cb: (data: { matches?: string[] }) => void,
  ): Promise<{ remove: () => void }>;
}

interface TextToSpeechPlugin {
  speak(opts: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    category?: string;
  }): Promise<void>;
  stop(): Promise<void>;
}

export const nativeStt = isNativeApp ? plugin<SpeechRecognitionPlugin>('SpeechRecognition') : null;
export const nativeTtsPlugin = isNativeApp ? plugin<TextToSpeechPlugin>('TextToSpeech') : null;

// ── Native TTS with the same shape as BrowserTts ─────────────────────────────

export class NativeTts {
  private speaking = false;
  private startedAt = 0;

  speak(text: string, onEnd: () => void): void {
    if (!nativeTtsPlugin) {
      onEnd();
      return;
    }
    this.cancel();
    this.speaking = true;
    this.startedAt = performance.now();
    nativeTtsPlugin
      .speak({ text, lang: navigator.language || 'en-US', rate: 1.0, category: 'playback' })
      .catch(() => undefined)
      .finally(() => {
        this.speaking = false;
        onEnd();
      });
  }

  /** Synthetic mouth envelope (native TTS exposes no audio for analysis). */
  amplitude = (): number => {
    if (!this.speaking) return 0;
    const t = (performance.now() - this.startedAt) / 1000;
    const syllable =
      0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 4.4) * Math.sin(t * 2 * Math.PI * 1.9 + 1);
    return Math.max(0, Math.min(1, syllable));
  };

  get isSpeaking(): boolean {
    return this.speaking;
  }

  cancel(): void {
    this.speaking = false;
    void nativeTtsPlugin?.stop().catch(() => undefined);
  }
}

// ── Native STT with the same shape as SpeechInput ────────────────────────────

import type { SttHandlers } from './stt.js';

export class NativeSpeechInput {
  readonly available: boolean;
  private listening = false;
  private openMic = false;
  private lastPartial = '';
  private listenerBound = false;

  constructor(private readonly handlers: SttHandlers) {
    this.available = nativeStt !== null;
  }

  get isListening(): boolean {
    return this.listening;
  }

  get isOpenMic(): boolean {
    return this.openMic;
  }

  private async bindListener(): Promise<void> {
    if (this.listenerBound || !nativeStt) return;
    this.listenerBound = true;
    await nativeStt.addListener('partialResults', ({ matches }) => {
      const text = matches?.[0]?.trim();
      if (!text) return;
      this.lastPartial = text;
      this.handlers.onVoiceActivity();
      this.handlers.onPartial(text);
    });
  }

  start(): void {
    void this.startAsync();
  }

  private async startAsync(): Promise<void> {
    if (!nativeStt) {
      this.handlers.onUnavailable();
      return;
    }
    if (this.listening) return;
    try {
      const perm = await nativeStt.requestPermissions();
      if (perm.speechRecognition !== 'granted') {
        this.openMic = false;
        this.handlers.onUnavailable();
        return;
      }
      await this.bindListener();
      this.listening = true;
      this.lastPartial = '';
      this.handlers.onStateChange(true);

      // start() resolves when Android's recognizer finishes one utterance.
      const result = await nativeStt.start({
        language: navigator.language || 'en-US',
        maxResults: 3,
        partialResults: true,
        popup: false,
      });
      const final = result?.matches?.[0]?.trim() || this.lastPartial;
      if (final) this.handlers.onFinal(final);
    } catch {
      // recognizer error (no speech, aborted) — fine, loop below may retry
    } finally {
      this.listening = false;
      this.handlers.onStateChange(false);
      // Android's recognizer stops after each utterance/silence: open-mic
      // mode restarts it, mirroring the browser implementation.
      if (this.openMic) setTimeout(() => this.start(), 250);
    }
  }

  stop(): void {
    this.openMic = false;
    void nativeStt?.stop().catch(() => undefined);
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
