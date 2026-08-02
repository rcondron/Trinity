/** HUD wiring: status pills, caption, settings + platforms panels. */
import type { ServerStatus } from '@trinity-avatar/protocol';

export interface UiHandlers {
  onTextSubmit(text: string): void;
  onMicToggle(): void;
  onAvatarFile(file: File): void;
  onPlatformSelect(id: string): void;
}

const SETTINGS_KEYS = ['orchestratorUrl', 'motionUrl'] as const;
export type UiSettings = Record<(typeof SETTINGS_KEYS)[number], string>;

export function loadSettings(): UiSettings {
  return {
    orchestratorUrl:
      localStorage.getItem('ta.orchestratorUrl') ||
      (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ||
      `ws://${location.hostname}:8790/session`,
    motionUrl:
      localStorage.getItem('ta.motionUrl') ||
      (import.meta.env.VITE_MOTION_SERVICE_URL as string | undefined) ||
      `ws://${location.hostname}:8791/ws`,
  };
}

export class Hud {
  private readonly pills = document.getElementById('status-pills')!;
  private readonly caption = document.getElementById('caption')!;
  private readonly micBtn = document.getElementById('btn-mic') as HTMLButtonElement;
  private captionTimer: number | undefined;
  private state: Record<string, { text: string; live: boolean }> = {};

  constructor(private readonly handlers: UiHandlers) {
    const form = document.getElementById('chat-form') as HTMLFormElement;
    const input = document.getElementById('chat-input') as HTMLInputElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        handlers.onTextSubmit(text);
        input.value = '';
      }
    });
    this.micBtn.addEventListener('click', () => handlers.onMicToggle());

    for (const id of ['panel-settings', 'panel-platforms']) {
      document.querySelector(`[data-close="${id}"]`)?.addEventListener('click', () => {
        document.getElementById(id)?.classList.add('hidden');
      });
    }
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.buildSettingsPanel();
      togglePanel('panel-settings');
    });
    document.getElementById('btn-platforms')?.addEventListener('click', () => {
      togglePanel('panel-platforms');
    });
  }

  setMicState(listening: boolean, openMic: boolean): void {
    this.micBtn.classList.toggle('listening', listening);
    this.micBtn.textContent = openMic ? '🎙️' : '🎤';
  }

  /** pills: brain/tts/motion/connection state; fallback pills go amber */
  setPill(key: string, text: string, live: boolean): void {
    this.state[key] = { text, live };
    this.pills.innerHTML = '';
    for (const [, v] of Object.entries(this.state)) {
      const el = document.createElement('span');
      el.className = `pill ${v.live ? 'live' : 'fallback'}`;
      el.textContent = v.text;
      this.pills.appendChild(el);
    }
  }

  applyStatus(s: ServerStatus): void {
    this.setPill('brain', `brain: ${s.brain}`, s.brain !== 'demo');
    this.setPill('tts', `voice: ${s.tts}`, s.tts !== 'browser');
    if (s.stt) this.setPill('stt', `ears: ${s.stt}`, s.stt !== 'none');
  }

  showCaption(text: string, sticky = false): void {
    this.caption.textContent = text;
    if (this.captionTimer) window.clearTimeout(this.captionTimer);
    if (!sticky) {
      this.captionTimer = window.setTimeout(() => {
        this.caption.textContent = '';
      }, 6000);
    }
  }

  appendCaption(delta: string): void {
    this.caption.textContent = (this.caption.textContent ?? '') + delta;
  }

  clearCaption(): void {
    this.caption.textContent = '';
  }

  private buildSettingsPanel(): void {
    const body = document.getElementById('settings-body')!;
    if (body.childElementCount > 0) return;
    const s = loadSettings();
    const avatarUrl = localStorage.getItem('ta.avatarUrl') ?? '';
    body.innerHTML = `
      <label>Orchestrator WebSocket</label>
      <input id="set-orch" value="${s.orchestratorUrl}" />
      <label>Motion service WebSocket</label>
      <input id="set-motion" value="${s.motionUrl}" />
      <label>Avatar URL (photoreal: readyplayer.me / avaturn.me link)</label>
      <input id="set-avatar-url" value="${avatarUrl}"
        placeholder="https://models.readyplayer.me/…glb?morphTargets=ARKit" />
      <button class="row-btn" id="set-save">Save & reload</button>
      <label>Avatar skin file (.vrm / .glb)</label>
      <input type="file" id="set-avatar" accept=".vrm,.glb" />
      <p class="hint">Or drag & drop a file anywhere. For a photoreal avatar of yourself:
      make one from a selfie at readyplayer.me (add <code>?morphTargets=ARKit</code> to the
      .glb link) or avaturn.me, paste the link above. API keys (ElevenLabs, Hermes) live in
      the server's <code>.env</code>. Press <code>\`</code> for the debug overlay.</p>
    `;
    body.querySelector('#set-save')?.addEventListener('click', () => {
      localStorage.setItem('ta.orchestratorUrl', (body.querySelector('#set-orch') as HTMLInputElement).value.trim());
      localStorage.setItem('ta.motionUrl', (body.querySelector('#set-motion') as HTMLInputElement).value.trim());
      const url = (body.querySelector('#set-avatar-url') as HTMLInputElement).value.trim();
      if (url) localStorage.setItem('ta.avatarUrl', url);
      else localStorage.removeItem('ta.avatarUrl');
      location.reload();
    });
    body.querySelector('#set-avatar')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handlers.onAvatarFile(file);
    });
  }

  buildPlatformsPanel(platforms: Array<{ id: string; label: string; hint: string }>, activeId: string): void {
    const body = document.getElementById('platforms-body')!;
    body.innerHTML = '';
    for (const p of platforms) {
      const btn = document.createElement('button');
      btn.className = 'row-btn';
      btn.textContent = `${p.id === activeId ? '● ' : ''}${p.label}`;
      btn.addEventListener('click', () => this.handlers.onPlatformSelect(p.id));
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = p.hint;
      body.append(btn, hint);
    }
  }
}

function togglePanel(id: string): void {
  const el = document.getElementById(id)!;
  const wasHidden = el.classList.contains('hidden');
  document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  if (wasHidden) el.classList.remove('hidden');
}
