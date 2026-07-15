/**
 * Looking Glass holographic displays: renders a QUILT — a grid of views
 * across a horizontal parallax cone — which is exactly what Looking Glass
 * devices consume (via the LG bridge / @lookingglass/webxr library; see
 * docs/platforms/looking-glass.md for feeding a real device).
 *
 * In the browser this doubles as its own simulator: the quilt grid is
 * rendered live, and a inset shows the center view as a preview.
 * Quilt geometry (columns × rows, cone angle) is configurable per device
 * via URL params: ?platform=lookingglass&cols=8&rows=6&cone=35
 */
import * as THREE from 'three';
import type { Platform, PlatformContext } from './types.js';

export class LookingGlassPlatform implements Platform {
  readonly id = 'lookingglass';
  readonly label = 'Looking Glass (quilt)';
  readonly hint = 'Multi-view quilt renderer + simulator';

  private cols = 8;
  private rows = 6;
  private coneDeg = 35;

  settings() {
    return { cols: this.cols, rows: this.rows, cone: this.coneDeg };
  }

  applySetting(key: string, value: number): void {
    if (key === 'cols') this.cols = Math.max(1, value | 0);
    if (key === 'rows') this.rows = Math.max(1, value | 0);
    if (key === 'cone') this.coneDeg = value;
  }

  async activate(ctx: PlatformContext): Promise<(dt: number) => void> {
    const { renderer, scene } = ctx.bundle;
    const params = new URLSearchParams(location.search);
    this.cols = Number(params.get('cols') ?? this.cols);
    this.rows = Number(params.get('rows') ?? this.rows);
    this.coneDeg = Number(params.get('cone') ?? this.coneDeg);

    const focus = new THREE.Vector3(0, 1.0, 0); // avatar center of interest
    const distance = 2.6;
    const camera = new THREE.PerspectiveCamera(42, 0.75, 0.1, 60);

    renderer.setScissorTest(true);
    const badge = document.createElement('div');
    badge.textContent = `quilt ${this.cols}×${this.rows} · cone ${this.coneDeg}°`;
    badge.style.cssText =
      'position:absolute;top:56px;right:14px;z-index:60;font:11px monospace;color:#22ff9a;' +
      'background:rgba(0,0,0,.7);padding:4px 8px;border-radius:6px;border:1px solid #123c2c';
    document.body.appendChild(badge);

    return () => {
      const size = renderer.getSize(new THREE.Vector2());
      const w = Math.floor(size.x / this.cols);
      const h = Math.floor(size.y / this.rows);
      const total = this.cols * this.rows;
      const cone = (this.coneDeg * Math.PI) / 180;

      // Views sweep left→right across the cone; quilt order is bottom-left
      // to top-right (Looking Glass convention).
      for (let i = 0; i < total; i++) {
        const frac = total === 1 ? 0.5 : i / (total - 1);
        const angle = (frac - 0.5) * cone;
        camera.aspect = w / h;
        camera.position.set(
          focus.x + Math.sin(angle) * distance,
          focus.y,
          focus.z + Math.cos(angle) * distance,
        );
        camera.lookAt(focus);
        camera.updateProjectionMatrix();

        const col = i % this.cols;
        const row = Math.floor(i / this.cols); // row 0 at the bottom
        const x = col * w;
        const y = row * h;
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        renderer.render(scene, camera);
      }
    };
  }
}

export const lookingGlassPlatform = new LookingGlassPlatform();
