import type { SceneBundle } from '../scene.js';

export interface PlatformContext {
  bundle: SceneBundle;
  /** Root object of the avatar (repositioned by some platforms). */
  getAvatarRoot(): THREE.Object3D | null;
}

import type * as THREE from 'three';

export interface Platform {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** One-time setup. Returns a per-frame render function replacing the default. */
  activate(ctx: PlatformContext): Promise<(dt: number) => void>;
  settings?(): Record<string, number | string | boolean>;
  applySetting?(key: string, value: number): void;
}

export const PLATFORM_LIST: Array<{ id: string; label: string; hint: string }> = [
  { id: 'web', label: 'Web (default)', hint: 'Desktop & mobile browser, orbit camera.' },
  { id: 'vr', label: 'WebXR — VR', hint: 'Quest-class headsets via browser. Life-size avatar, needs HTTPS or localhost.' },
  { id: 'ar', label: 'WebXR — AR', hint: 'Phone AR / passthrough headsets. Places the avatar in your room.' },
  { id: 'lookingglass', label: 'Looking Glass (quilt)', hint: 'Renders a multi-view quilt. In-browser simulator; feed the quilt to the LG bridge for a real device.' },
  { id: 'volumetric', label: 'Volumetric / POV (sim)', hint: 'Radial slices for spinning-arm & voxel displays. Experimental, with browser simulator.' },
  { id: 'peppers', label: "Pepper's ghost pyramid", hint: '1/2/4-view layout on black for hologram pyramids & fans. ?views=4' },
  { id: 'overlay', label: 'Desktop overlay', hint: 'Transparent scene for the Electron overlay app — the avatar walks on your screen.' },
];

export function currentPlatformId(): string {
  return new URLSearchParams(location.search).get('platform') ?? 'web';
}

export function gotoPlatform(id: string): void {
  const url = new URL(location.href);
  if (id === 'web') url.searchParams.delete('platform');
  else url.searchParams.set('platform', id);
  location.href = url.toString();
}
