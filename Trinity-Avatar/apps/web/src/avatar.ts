/**
 * Avatar lifecycle: load the configured default (VRM/GLB) or fall back to the
 * built-in procedural hologram; hot-swap on drag & drop or file pick.
 */
import type * as THREE from 'three';
import {
  Animator,
  loadAvatar,
  ProceduralRig,
  type AvatarRig,
} from '@trinity-avatar/avatar-core';

export class AvatarManager {
  private rig: AvatarRig | null = null;
  onSwap: ((rig: AvatarRig) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly animator: Animator,
  ) {}

  get current(): AvatarRig | null {
    return this.rig;
  }

  get skinName(): string {
    return this.rig?.kind ?? 'none';
  }

  private install(rig: AvatarRig): void {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      this.rig.dispose();
    }
    this.rig = rig;
    rig.root.traverse((o) => {
      o.castShadow = true;
    });
    this.scene.add(rig.root);
    this.animator.setRig(rig);
    this.onSwap?.(rig);
  }

  /** Try the configured avatar URL; fall back to the procedural skin. */
  async loadDefault(): Promise<void> {
    const url = (import.meta.env.VITE_DEFAULT_AVATAR as string | undefined) ?? '/avatars/default.vrm';
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      // Vite dev server returns index.html for missing files — only trust
      // real binary responses.
      if (!head.ok || type.includes('text/html')) throw new Error(`no avatar at ${url}`);
      this.install(await loadAvatar(url));
      console.info(`[avatar] loaded ${url}`);
    } catch {
      this.install(new ProceduralRig());
      console.info('[avatar] using built-in procedural skin (drop a .vrm to swap)');
    }
  }

  async loadFromFile(file: File): Promise<void> {
    const rig = await loadAvatar(file);
    this.install(rig);
    console.info(`[avatar] swapped skin from ${file.name}`);
  }

  /** Wire drag & drop + a hidden file input for the settings panel. */
  bindDropTarget(el: HTMLElement, hint: HTMLElement): void {
    let depth = 0;
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      depth++;
      hint.classList.remove('hidden');
    });
    el.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        hint.classList.add('hidden');
      }
    });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      hint.classList.add('hidden');
      const file = e.dataTransfer?.files[0];
      if (file && /\.(vrm|glb)$/i.test(file.name)) {
        void this.loadFromFile(file).catch((err) => console.error('[avatar] swap failed', err));
      }
    });
  }
}
