/**
 * WebXR platforms: immersive VR (life-size avatar in front of the user) and
 * AR (avatar placed on a real surface via hit-test where supported).
 *
 * Apple Vision Pro works through Safari's WebXR support; native visionOS is
 * out of scope but nothing in this adapter API precludes it.
 */
import * as THREE from 'three';
import type { Platform, PlatformContext } from './types.js';

function makeEnterButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText =
    'position:absolute;bottom:110px;left:50%;transform:translateX(-50%);z-index:60;' +
    'padding:12px 22px;border-radius:12px;border:1px solid #16b56d;background:rgba(6,24,17,.95);' +
    'color:#22ff9a;font-size:15px;cursor:pointer';
  document.body.appendChild(btn);
  return btn;
}

class XrPlatform implements Platform {
  constructor(
    readonly id: 'vr' | 'ar',
    readonly label: string,
    readonly hint: string,
  ) {}

  async activate(ctx: PlatformContext): Promise<(dt: number) => void> {
    const { renderer, scene, camera, userAnchor } = ctx.bundle;
    renderer.xr.enabled = true;
    const mode = this.id === 'vr' ? 'immersive-vr' : 'immersive-ar';
    const supported = await navigator.xr?.isSessionSupported(mode).catch(() => false);
    const btn = makeEnterButton(
      supported ? (this.id === 'vr' ? 'Enter VR' : 'Enter AR') : `${mode} not supported here`,
    );
    btn.disabled = !supported;

    btn.addEventListener('click', async () => {
      const session = await navigator.xr!.requestSession(mode, {
        optionalFeatures: ['local-floor', 'hit-test', 'hand-tracking'],
      });
      await renderer.xr.setSession(session as XRSession);
      btn.style.display = 'none';
      session.addEventListener('end', () => {
        btn.style.display = '';
      });

      if (this.id === 'ar') {
        // Real room is the environment.
        ctx.bundle.setEnvironmentVisible(false);
        scene.background = null;
        scene.fog = null;
      }
      // Place the avatar ~1.6 m in front of where the user starts, facing them.
      const root = ctx.getAvatarRoot();
      if (root) {
        root.position.set(0, 0, -1.6);
        root.rotation.y = 0; // VRM/procedural rigs face +Z after rotateVRM0
      }
    });

    // Spatial audio note: WebAudio PannerNode hookup lives in docs/platforms/webxr.md.
    const camWorld = new THREE.Vector3();
    return () => {
      // Gaze: the "user" is the XR camera while presenting.
      if (renderer.xr.isPresenting) {
        renderer.xr.getCamera().getWorldPosition(camWorld);
        userAnchor.position.copy(camWorld);
      }
      renderer.render(scene, camera);
    };
  }
}

export const vrPlatform = new XrPlatform('vr', 'WebXR — VR', 'Life-size in-headset avatar.');
export const arPlatform = new XrPlatform('ar', 'WebXR — AR', 'Avatar in your room.');
