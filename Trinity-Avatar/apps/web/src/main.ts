import './style.css';
import { Animator } from '@trinity-avatar/avatar-core';
import type { Message } from '@trinity-avatar/protocol';
import { createScene } from './scene.js';
import { AvatarManager } from './avatar.js';
import { DebugOverlay } from './debug.js';
import { AudioPlayer, BrowserTts } from './audio.js';
import { SpeechInput, type SttHandlers } from './stt.js';
import { SessionClient } from './session.js';
import { MotionSource } from './motion.js';
import { Hud, loadSettings } from './ui.js';
import { currentPlatformId, gotoPlatform, PLATFORM_LIST, resolvePlatform } from './platforms/index.js';
import { isNativeApp, NativeSpeechInput, NativeTts } from './native.js';

// ── Composition root ─────────────────────────────────────────────────────────
const settings = loadSettings();
const platformId = currentPlatformId();
const urlParams = new URLSearchParams(location.search);
// Native app default: the avatar standing in an empty space, voice-first.
const voidEnv = urlParams.get('env') === 'void' || (isNativeApp && urlParams.get('env') !== 'stage');
const voiceFirst = urlParams.get('ui') === 'voice' || isNativeApp;
if (voiceFirst) document.body.classList.add('voice-first');
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bundle = createScene(canvas, {
  transparent: platformId === 'overlay',
  environment: voidEnv ? 'void' : 'stage',
});
const animator = new Animator();
const avatars = new AvatarManager(bundle.scene, animator);
const debug = new DebugOverlay(document.getElementById('debug-overlay')!);
debug.rendererBackend = bundle.backend;

const audio = new AudioPlayer();
// Inside the native app, WebView speech APIs don't exist — use the
// Capacitor plugins; same interface either way.
const browserTts = isNativeApp ? new NativeTts() : new BrowserTts();
const motion = new MotionSource(settings.motionUrl, animator);

let serverTtsActive = false; // does the current turn stream ElevenLabs audio?
let currentTurnId = '';
let pendingGestures: Array<{ prompt: string; atChar: number }> = [];
let currentReplyText = '';

const hud = new Hud({
  onTextSubmit: (text) => submitUtterance(text),
  onMicToggle: () => {
    audio.unlock();
    const on = stt.toggleOpenMic();
    hud.setMicState(on, on);
  },
  onAvatarFile: (file) => void avatars.loadFromFile(file),
  onPlatformSelect: (id) => gotoPlatform(id),
});
hud.buildPlatformsPanel(PLATFORM_LIST, platformId);

const sttHandlers: SttHandlers = {
  onPartial: () => bargeIn(),
  onFinal: (text) => {
    hud.showCaption(`“${text}”`);
    submitUtterance(text);
  },
  onVoiceActivity: () => bargeIn(),
  onStateChange: (listening: boolean) => hud.setMicState(listening, stt.isOpenMic),
  onUnavailable: () => {
    hud.setPill('stt', 'ears: unavailable', false);
    hud.showCaption(
      isNativeApp
        ? 'Microphone permission needed — enable it in Android settings for this app.'
        : 'Speech recognition unavailable in this browser — use the text box.',
    );
  },
};
const stt = isNativeApp ? new NativeSpeechInput(sttHandlers) : new SpeechInput(sttHandlers);

hud.setPill('link', 'orchestrator: connecting…', false);
const session = new SessionClient(settings.orchestratorUrl, {
  onMessage: handleServerMessage,
  onConnectionChange: (connected) => {
    hud.setPill('link', connected ? 'orchestrator: connected' : 'orchestrator: offline', connected);
    if (!connected) {
      debug.status = { type: 'server_status', brain: 'demo', tts: 'browser', stt: 'browser', detail: 'offline persona' };
    }
  },
});

function submitUtterance(text: string): void {
  audio.unlock();
  bargeIn('user_cancel');
  debug.resetTurn();
  session.submitUtterance(text);
}

/** Stop speech + gestures gracefully when the user starts talking. */
function bargeIn(reason: 'barge_in' | 'user_cancel' = 'barge_in'): void {
  const wasSpeaking = audio.playing || browserTts.isSpeaking;
  if (!wasSpeaking && reason === 'barge_in') return;
  audio.stopAll();
  browserTts.cancel();
  animator.endSpeech();
  motion.interrupt();
  if (wasSpeaking) session.interrupt();
  hud.clearCaption();
}

/** Fire gesture cues as the reply text streams past their character index. */
function scheduleGestures(spokenChars: number): void {
  pendingGestures = pendingGestures.filter((g) => {
    if (spokenChars >= g.atChar) {
      motion.gesture(g.prompt);
      return false;
    }
    return true;
  });
}

function handleServerMessage(msg: Message): void {
  switch (msg.type) {
    case 'server_status':
      debug.status = msg;
      hud.applyStatus(msg);
      if (isNativeApp) hud.setPill('stt', 'ears: native', true);
      break;

    case 'agent_text_delta':
      if (msg.turnId !== currentTurnId) {
        currentTurnId = msg.turnId;
        currentReplyText = '';
        hud.showCaption('', true);
      }
      currentReplyText += msg.text;
      hud.appendCaption(msg.text);
      scheduleGestures(currentReplyText.length);
      break;

    case 'agent_reply': {
      currentTurnId = msg.turnId;
      if (!currentReplyText) {
        currentReplyText = msg.text;
        hud.showCaption(msg.text, true);
      }
      animator.setEmotion(msg.emotion ?? 'neutral');
      if (msg.gaze) animator.setGaze(msg.gaze.target);
      if (msg.locomotion) motion.locomotion(msg.locomotion.mode, msg.locomotion.speed);
      pendingGestures = (msg.gestures ?? []).map((g) => ({ prompt: g.prompt, atChar: g.atChar ?? 0 }));
      // With no character clock (no server TTS), fire gestures immediately…
      if (!serverTtsActive) scheduleGestures(Number.MAX_SAFE_INTEGER);
      // …and speak via the browser fallback.
      if (!serverTtsActive) {
        animator.startAmplitudeSpeech(browserTts.amplitude);
        browserTts.speak(msg.text, () => {
          animator.endSpeech();
          hud.showCaption(msg.text); // un-stick the caption
        });
      }
      break;
    }

    case 'tts_audio_chunk':
      if (!serverTtsActive || msg.turnId !== currentTurnId) {
        serverTtsActive = true;
        currentTurnId = msg.turnId;
        audio.beginTurn();
        animator.startSpeech(audio.clock);
      }
      audio.enqueuePcm(msg.audioB64, msg.sampleRate);
      break;

    case 'tts_timestamps':
      animator.addTimestamps(msg.chars, msg.startTimes, msg.durations);
      break;

    case 'tts_end':
      serverTtsActive = false;
      // Let the tail of the audio play out; endSpeech happens when quiet.
      window.setTimeout(() => {
        if (!audio.playing) {
          animator.endSpeech();
          hud.showCaption(currentReplyText);
        }
      }, 500);
      break;

    case 'emotion':
      animator.setEmotion(msg.label, msg.intensity);
      break;
    case 'gesture':
      motion.gesture(msg.prompt);
      break;
    case 'locomotion':
      motion.locomotion(msg.mode, msg.speed);
      break;
    case 'gaze':
      animator.setGaze(msg.target);
      break;

    case 'latency_mark':
      debug.markLatency(msg.stage, msg.ms);
      break;

    case 'error':
      console.warn('[server]', msg.code, msg.message);
      hud.showCaption(`⚠ ${msg.message}`);
      break;

    default:
      break;
  }
}

// ── Mic button: hold-to-talk on pointer, click toggles open mic (in Hud) ────
const micBtn = document.getElementById('btn-mic')!;
let holdTimer: number | undefined;
micBtn.addEventListener('pointerdown', () => {
  holdTimer = window.setTimeout(() => {
    audio.unlock();
    stt.start();
  }, 250);
});
micBtn.addEventListener('pointerup', () => {
  if (holdTimer) window.clearTimeout(holdTimer);
  if (stt.isListening && !stt.isOpenMic) stt.stop();
});
document.getElementById('btn-keyboard')?.addEventListener('click', () => {
  document.body.classList.toggle('show-keyboard');
  if (document.body.classList.contains('show-keyboard')) {
    (document.getElementById('chat-input') as HTMLInputElement).focus();
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────
avatars.onSwap = (rig) => {
  debug.skin = rig.kind;
};
avatars.bindDropTarget(document.body, document.getElementById('drop-hint')!);
await avatars.loadDefault();

motion.onBackendChange = (label) => {
  debug.motionBackend = label;
  hud.setPill('motion', `motion: ${label.replace(' (fallback)', '')}`, !label.includes('fallback'));
};
motion.onBackendChange(motion.backendLabel);
motion.onFirstFrame = () => debug.markLatency('motion_first_frame', 0);

// ── Platform adapter (default = plain web render) ───────────────────────────
const platform = resolvePlatform(platformId);
let renderFrame: (dt: number) => void = () => bundle.renderer.render(bundle.scene, bundle.camera);
if (platform) {
  renderFrame = await platform.activate({
    bundle,
    getAvatarRoot: () => avatars.current?.root ?? null,
  });
  debug.extra.set('platform', platform.id);
}
if (platformId === 'overlay') {
  // The overlay's whole point: the avatar strolls across your screen.
  motion.locomotion('pace', 0.4);
}

let last = performance.now();
bundle.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  motion.update(dt);
  animator.update(dt);
  if (bundle.controls.enabled) bundle.controls.update();
  debug.tick(animator);
  renderFrame(dt);
});
