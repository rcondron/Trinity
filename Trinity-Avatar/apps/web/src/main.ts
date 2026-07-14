import './style.css';
import { Animator, ClientMotion } from '@trinity-avatar/avatar-core';
import { createScene } from './scene.js';
import { AvatarManager } from './avatar.js';
import { DebugOverlay } from './debug.js';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bundle = createScene(canvas);
const animator = new Animator();
const avatars = new AvatarManager(bundle.scene, animator);
const debug = new DebugOverlay(document.getElementById('debug-overlay')!);
debug.rendererBackend = bundle.backend;

avatars.onSwap = (rig) => {
  debug.skin = rig.kind;
};
avatars.bindDropTarget(document.body, document.getElementById('drop-hint')!);
await avatars.loadDefault();

// Until the motion service is wired (Phase 3), a client-side idle keeps the
// avatar alive: relaxed arms, weight shifts, breathing.
const clientMotion = new ClientMotion();
debug.motionBackend = 'client (fallback)';

let last = performance.now();
bundle.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  animator.pushPoseFrame(clientMotion.frame(dt));
  animator.update(dt);
  bundle.controls.update();
  debug.tick(animator);
  bundle.renderer.render(bundle.scene, bundle.camera);
});
