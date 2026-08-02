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

  /** Try avatar URLs in order; fall back to the procedural skin. */
  async loadDefault(): Promise<void> {
    // Highest priority: a user-pasted URL (Settings → Avatar URL), e.g. a
    // photoreal Ready Player Me / Avaturn link. Their CDNs serve CORS.
    const userUrl = localStorage.getItem('ta.avatarUrl')?.trim();
    const configured = import.meta.env.VITE_DEFAULT_AVATAR as string | undefined;
    const candidates = [
      ...(userUrl ? [userUrl] : []),
      ...(configured ? [configured] : []),
      '/avatars/custom.glb', // drop your own file here to make it the default
      '/avatars/custom.vrm',
      '/avatars/trinity.glb', // committed Trinity skin (generated in-repo)
      '/avatars/default.vrm', // optional downloaded VRM (scripts/setup_avatar.sh)
    ];
    for (const url of candidates) {
      try {
        // Local paths get a HEAD probe because the Vite dev server answers
        // missing files with index.html; remote CDNs often reject HEAD, so
        // absolute URLs go straight to the loader.
        if (!/^https?:\/\//.test(url)) {
          const head = await fetch(url, { method: 'HEAD' });
          const type = head.headers.get('content-type') ?? '';
          if (!head.ok || type.includes('text/html')) continue;
        }
        this.install(await loadAvatar(url));
        console.info(`[avatar] loaded ${url}`);
        return;
      } catch (err) {
        if (url === userUrl) console.warn(`[avatar] configured Avatar URL failed: ${url}`, err);
        // try the next candidate
      }
    }
    this.install(new ProceduralRig());
    console.info('[avatar] using built-in procedural skin (drop a .vrm to swap)');
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
