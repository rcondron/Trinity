/**
 * Body motion source. Prefers the motion service (ARDY or its clip fallback)
 * over WebSocket; if unreachable, generates poses locally with ClientMotion.
 * The animator receives identical PoseFrames either way.
 */
import {
  Animator,
  ClientMotion,
  promptToClientMode,
} from '@trinity-avatar/avatar-core';
import {
  parseMessage,
  serializeMessage,
  type LocomotionMode,
  type Message,
} from '@trinity-avatar/protocol';

export class MotionSource {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectDelay = 2000;
  private readonly local = new ClientMotion();
  backendLabel = 'client (fallback)';
  onBackendChange: ((label: string) => void) | null = null;
  private firstFrameSeen = false;
  onFirstFrame: (() => void) | null = null;

  constructor(
    private readonly url: string,
    private readonly animator: Animator,
  ) {
    this.connect();
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
      this.reconnectDelay = 2000;
      this.send({ type: 'motion_request', prompt: 'idle', loop: true, layer: 'base' });
    };
    this.ws.onmessage = (e) => {
      let msg: Message;
      try {
        msg = parseMessage(String(e.data));
      } catch {
        return;
      }
      if (msg.type === 'pose_frame') {
        if (!this.firstFrameSeen) {
          this.firstFrameSeen = true;
          this.onFirstFrame?.();
        }
        this.animator.pushPoseFrame(msg);
      } else if (msg.type === 'motion_status') {
        this.backendLabel = msg.backend === 'ardy' ? `ardy @ ${msg.fps ?? '?'}fps` : `clips (fallback)`;
        this.onBackendChange?.(this.backendLabel);
      }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.backendLabel = 'client (fallback)';
      this.onBackendChange?.(this.backendLabel);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(20000, this.reconnectDelay * 1.6);
  }

  private send(msg: Message): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(msg));
    }
  }

  /** Behavior prompt from the brain ("wave hello", "lean forward attentively"). */
  gesture(prompt: string): void {
    if (this.connected) {
      this.send({ type: 'motion_request', prompt, layer: 'gesture' });
    } else {
      const mode = promptToClientMode(prompt);
      if (mode !== 'idle' && mode !== 'walk') this.local.play(mode);
    }
  }

  locomotion(mode: LocomotionMode, speed?: number): void {
    if (this.connected) {
      this.send({
        type: 'motion_request',
        prompt: mode === 'idle' ? 'idle' : `locomotion:${mode}${speed !== undefined ? `:${speed}` : ''}`,
        loop: true,
        layer: 'base',
      });
    } else {
      this.local.play(mode === 'idle' ? 'idle' : 'walk');
    }
  }

  /** Barge-in: fade out gesture layer. */
  interrupt(): void {
    this.send({ type: 'motion_stop', layer: 'gesture', fadeMs: 250 });
    this.animator.stopGesture();
    if (!this.connected && this.local.mode !== 'idle' && this.local.mode !== 'walk') {
      this.local.play('idle');
    }
  }

  /** Per-frame: in fallback mode, synthesize poses locally. */
  update(dt: number): void {
    if (!this.connected) {
      this.animator.pushPoseFrame(this.local.frame(dt));
    }
  }
}
