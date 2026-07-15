/**
 * RendererAdapter — the pluggable platform layer.
 *
 * The app builds one scene (avatar + lights + environment) and hands it to an
 * adapter. Adapters own the camera(s), render loop output target, and any
 * platform session (WebXR, Looking Glass bridge, volumetric slicing…).
 * New platforms = new adapter, nothing else changes.
 */
import type * as THREE from 'three';

export interface AdapterContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Default perspective camera; adapters may ignore it and use their own. */
  camera: THREE.PerspectiveCamera;
  /** World position the avatar's eyes should consider "the user" for gaze. */
  userAnchor: THREE.Object3D;
  canvas: HTMLCanvasElement;
}

export interface RendererAdapter {
  readonly id: string;
  readonly label: string;
  /** Called once when the platform is activated. May request sessions, resize, etc. */
  activate(ctx: AdapterContext): Promise<void>;
  /** Called every animation frame after the scene graph is updated. */
  render(ctx: AdapterContext, dt: number): void;
  /** Called when switching away. Must undo everything activate() did. */
  deactivate(ctx: AdapterContext): Promise<void>;
  /** Optional platform-specific settings UI schema (key → current value). */
  settings?(): Record<string, number | string | boolean>;
  applySetting?(key: string, value: number | string | boolean): void;
}
