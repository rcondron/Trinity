/**
 * Desktop overlay: transparent background, no environment, avatar life at
 * the bottom of the screen, pacing back and forth. The Electron shell
 * (apps/desktop-overlay) loads this in a click-through always-on-top window
 * so the avatar walks around on your screen. Also usable in a plain browser
 * for testing (?platform=overlay).
 */
import type { Platform, PlatformContext } from './types.js';

export class OverlayPlatform implements Platform {
  readonly id = 'overlay';
  readonly label = 'Desktop overlay';
  readonly hint = 'Transparent walking avatar for the Electron overlay';

  async activate(ctx: PlatformContext): Promise<(dt: number) => void> {
    const { renderer, scene, camera } = ctx.bundle;
    document.body.classList.add('overlay-mode');
    document.documentElement.style.background = 'transparent';
    ctx.bundle.setEnvironmentVisible(false);
    scene.background = null;
    scene.fog = null;
    renderer.setClearColor(0x000000, 0);

    // Trim the HUD down to the caption + mic (no topbar, no grid).
    document.getElementById('topbar')?.classList.add('hidden');
    ctx.bundle.controls.enabled = false;

    // Desktop-companion framing: avatar ~1/3 screen height, feet on the
    // bottom edge, lots of empty (transparent) space above.
    camera.fov = 22;
    camera.position.set(0, 2.3, 12.6);
    camera.lookAt(0, 2.3, 0);
    camera.updateProjectionMatrix();

    return () => {
      // Follow the avatar as it paces so it never walks out of frame edges.
      const root = ctx.getAvatarRoot();
      if (root) {
        const hips = root.getObjectByName('hips') ?? root;
        const targetX = Math.max(-3, Math.min(3, hips.position.x * 0.9));
        camera.position.x += (targetX - camera.position.x) * 0.03;
      }
      renderer.render(scene, camera);
    };
  }
}

export const overlayPlatform = new OverlayPlatform();
