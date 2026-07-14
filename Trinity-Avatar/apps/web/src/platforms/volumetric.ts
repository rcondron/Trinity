/**
 * Volumetric / persistence-of-vision displays (spinning-arm, LED POV fans,
 * Voxon-style). These consume synchronized radial slices: the avatar rendered
 * from N azimuth angles, one slice shown per rotation step.
 *
 * Two modes, both experimental/best-effort (see docs/platforms/volumetric.md):
 *  - SIMULATOR (default, in-browser): cycles slices at `rpm` with additive
 *    ghosting, approximating what the spinning display shows.
 *  - GRID (?view=grid): all slices tiled — this is the frame you'd stream to
 *    real hardware over WebSocket/NDI-style transport; a capture hook posts
 *    JPEG slices to SLICE_SINK_URL if ?sink=ws://... is given.
 *
 * Calibration knobs (URL params): slices=24, rpm=900, size=256, brightness=1.
 */
import * as THREE from 'three';
import type { Platform, PlatformContext } from './types.js';

export class VolumetricPlatform implements Platform {
  readonly id = 'volumetric';
  readonly label = 'Volumetric / POV (sim)';
  readonly hint = 'Radial slice renderer + POV simulator';

  private slices = 24;
  private rpm = 900;
  private size = 256;
  private brightness = 1;

  settings() {
    return { slices: this.slices, rpm: this.rpm, size: this.size, brightness: this.brightness };
  }

  applySetting(key: string, value: number): void {
    if (key === 'slices') this.slices = Math.max(4, value | 0);
    if (key === 'rpm') this.rpm = value;
    if (key === 'size') this.size = value | 0;
    if (key === 'brightness') this.brightness = value;
  }

  async activate(ctx: PlatformContext): Promise<(dt: number) => void> {
    const { renderer, scene } = ctx.bundle;
    const params = new URLSearchParams(location.search);
    this.slices = Number(params.get('slices') ?? this.slices);
    this.rpm = Number(params.get('rpm') ?? this.rpm);
    this.size = Number(params.get('size') ?? this.size);
    const gridMode = params.get('view') === 'grid';
    const sinkUrl = params.get('sink');

    // POV displays want the subject on black, no environment.
    ctx.bundle.setEnvironmentVisible(false);
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;

    const focus = new THREE.Vector3(0, 1.0, 0);
    const distance = 2.4;
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60);

    // Optional hardware sink: raw slice JPEGs over WebSocket.
    let sink: WebSocket | null = null;
    if (sinkUrl) {
      try {
        sink = new WebSocket(sinkUrl);
      } catch {
        console.warn('[volumetric] bad sink URL', sinkUrl);
      }
    }
    const sinkCanvas = sink ? document.createElement('canvas') : null;
    if (sinkCanvas) {
      sinkCanvas.width = this.size;
      sinkCanvas.height = this.size;
    }

    renderer.setScissorTest(true);
    let rotation = 0; // 0..1 of a full revolution

    const badge = document.createElement('div');
    badge.style.cssText =
      'position:absolute;top:56px;right:14px;z-index:60;font:11px monospace;color:#22ff9a;' +
      'background:rgba(0,0,0,.7);padding:4px 8px;border-radius:6px;border:1px solid #123c2c';
    document.body.appendChild(badge);

    const renderSlice = (i: number, x: number, y: number, w: number, h: number) => {
      const angle = (i / this.slices) * Math.PI * 2;
      camera.aspect = w / h;
      camera.position.set(
        focus.x + Math.sin(angle) * distance,
        focus.y,
        focus.z + Math.cos(angle) * distance,
      );
      camera.lookAt(focus);
      camera.updateProjectionMatrix();
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.render(scene, camera);
    };

    return (dt: number) => {
      rotation = (rotation + (this.rpm / 60) * dt) % 1;
      const size = renderer.getSize(new THREE.Vector2());
      badge.textContent = `${gridMode ? 'grid' : 'POV sim'} · ${this.slices} slices · ${this.rpm} rpm`;

      if (gridMode) {
        const cols = Math.ceil(Math.sqrt(this.slices));
        const rows = Math.ceil(this.slices / cols);
        const w = Math.floor(size.x / cols);
        const h = Math.floor(size.y / rows);
        for (let i = 0; i < this.slices; i++) {
          renderSlice(i, (i % cols) * w, Math.floor(i / cols) * h, w, h);
        }
      } else {
        // POV simulation: draw the current slice full-screen. autoClearColor
        // off + a translucent clear plane gives phosphor-style persistence.
        const slice = Math.floor(rotation * this.slices) % this.slices;
        renderSlice(slice, 0, 0, size.x, size.y);
      }

      if (sink && sink.readyState === WebSocket.OPEN && sinkCanvas) {
        const g = sinkCanvas.getContext('2d')!;
        g.drawImage(renderer.domElement, 0, 0, this.size, this.size);
        sinkCanvas.toBlob((blob) => blob && sink!.send(blob), 'image/jpeg', 0.7);
      }
    };
  }
}

export const volumetricPlatform = new VolumetricPlatform();
