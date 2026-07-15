/**
 * Pepper's-ghost pyramids & hologram fans: the avatar on pure black,
 * arranged in a 1/2/4-view cross layout. Put the screen under a pyramid (or
 * feed a fan) and each face reflects its view. ?views=1|2|4 (default 4).
 */
import * as THREE from 'three';
import type { Platform, PlatformContext } from './types.js';

export class PeppersPlatform implements Platform {
  readonly id = 'peppers';
  readonly label = "Pepper's ghost pyramid";
  readonly hint = 'Black-background 1/2/4-view pyramid layout';

  private views: 1 | 2 | 4 = 4;

  settings() {
    return { views: this.views };
  }

  applySetting(key: string, value: number): void {
    if (key === 'views' && (value === 1 || value === 2 || value === 4)) this.views = value;
  }

  async activate(ctx: PlatformContext): Promise<(dt: number) => void> {
    const { renderer, scene } = ctx.bundle;
    const v = Number(new URLSearchParams(location.search).get('views') ?? 4);
    if (v === 1 || v === 2 || v === 4) this.views = v;

    ctx.bundle.setEnvironmentVisible(false);
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    document.getElementById('hud')?.classList.add('hidden');

    const focus = new THREE.Vector3(0, 1.0, 0);
    const distance = 3.0;
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    renderer.setScissorTest(true);

    // Azimuths: front, back, left, right.
    const ANGLES = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

    return () => {
      const size = renderer.getSize(new THREE.Vector2());
      const cell = Math.floor(Math.min(size.x, size.y) / 3);
      const cx = Math.floor(size.x / 2 - cell / 2);
      const cy = Math.floor(size.y / 2 - cell / 2);
      // Layout: bottom (front view), top (back), left, right — the classic
      // 4-face pyramid cross. 2 views = bottom+top; 1 = bottom only.
      const cells: Array<[number, number]> = [
        [cx, 0],
        [cx, size.y - cell],
        [0, cy],
        [size.x - cell, cy],
      ];

      renderer.setViewport(0, 0, size.x, size.y);
      renderer.setScissor(0, 0, size.x, size.y);
      renderer.clear();

      for (let i = 0; i < this.views; i++) {
        const angle = ANGLES[i]!;
        camera.position.set(
          focus.x + Math.sin(angle) * distance,
          focus.y,
          focus.z + Math.cos(angle) * distance,
        );
        camera.lookAt(focus);
        camera.updateProjectionMatrix();
        const [x, y] = cells[i]!;
        renderer.setViewport(x, y, cell, cell);
        renderer.setScissor(x, y, cell, cell);
        renderer.render(scene, camera);
      }
    };
  }
}

export const peppersPlatform = new PeppersPlatform();
