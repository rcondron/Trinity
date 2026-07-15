/**
 * Debug overlay (toggle with `): fps, per-stage latency, active backends,
 * current emotion/gesture, lip sync mode. Every fallback is visible here.
 */
import type { LatencyStage, ServerStatus } from '@trinity-avatar/protocol';
import type { Animator } from '@trinity-avatar/avatar-core';

export class DebugOverlay {
  private readonly el: HTMLElement;
  private frames = 0;
  private fps = 0;
  private lastFpsAt = performance.now();
  private latencies = new Map<LatencyStage, number>();
  status: ServerStatus | null = null;
  motionBackend = 'client (fallback)';
  rendererBackend = 'webgl2';
  skin = 'none';
  extra = new Map<string, string>();

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement)) {
        this.el.classList.toggle('hidden');
      }
    });
  }

  markLatency(stage: LatencyStage, ms: number): void {
    this.latencies.set(stage, ms);
  }

  resetTurn(): void {
    this.latencies.clear();
  }

  tick(animator: Animator): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
      this.frames = 0;
      this.lastFpsAt = now;
    }
    if (this.el.classList.contains('hidden')) return;

    const d = animator.debug;
    const s = this.status;
    const lat = [...this.latencies.entries()]
      .map(([k, v]) => `  ${k.padEnd(18)} ${v.toFixed(0)} ms`)
      .join('\n');
    const total =
      (this.latencies.get('brain_first_token') ?? 0) + (this.latencies.get('tts_first_audio') ?? 0);

    const lines = [
      `fps        ${this.fps}   renderer ${this.rendererBackend}   skin ${this.skin}`,
      `brain      ${s ? s.brain + (s.brain === 'demo' ? ' (fallback)' : '') : '—'}`,
      `tts        ${s ? s.tts + (s.tts === 'browser' ? ' (fallback)' : '') : '—'}`,
      `stt        ${s?.stt ?? '—'}`,
      `motion     ${this.motionBackend}`,
      `emotion    ${d.emotion.label} @ ${d.emotion.level.toFixed(2)}`,
      `lipsync    ${d.lipSyncMode}${d.speaking ? ' (speaking)' : ''}`,
      `gesture w  ${d.gestureWeight.toFixed(2)}`,
      lat ? `latency (last turn):\n${lat}\n  ≈ response total    ${total.toFixed(0)} ms` : 'latency: no turns yet',
      ...[...this.extra.entries()].map(([k, v]) => `${k.padEnd(10)} ${v}`),
    ];
    this.el.textContent = lines.join('\n');
  }
}
