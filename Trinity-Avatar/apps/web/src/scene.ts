/**
 * Scene construction: renderer (WebGL2 default, WebGPU opt-in via ?webgpu=1),
 * lighting, environment, camera + orbit controls.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  userAnchor: THREE.Object3D;
  /** 'webgl2' | 'webgpu' — shown in the debug overlay. */
  backend: string;
  setEnvironmentVisible(visible: boolean): void;
}

export interface SceneOptions {
  transparent?: boolean;
  /** 'stage' = floor disc + grid + ring; 'void' = empty space, shadow only. */
  environment?: 'stage' | 'void';
}

export function createScene(canvas: HTMLCanvasElement, opts: SceneOptions = {}): SceneBundle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: opts.transparent ?? false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  if (!opts.transparent) {
    scene.background = new THREE.Color(0x04100b);
    scene.fog = new THREE.FogExp2(0x04100b, 0.09);
  }

  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.set(0, 1.25, 3.4);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.95, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.8;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.update();

  // ── Lighting: key / fill / rim ────────────────────────────────────────────
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.5, 2.8, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 10;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fd4ff, 0.6);
  fill.position.set(-2, 1.5, 1);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x22ff9a, 1.1);
  rim.position.set(0, 2.2, -2.5);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x2a4a3c, 0.7));

  // ── Environment ──────────────────────────────────────────────────────────
  const env = new THREE.Group();
  env.name = 'environment';
  const isVoid = opts.environment === 'void';

  if (isVoid) {
    // Empty space: the avatar stands in a dark void, grounded only by a
    // soft contact shadow (ShadowMaterial catches shadows, shows nothing else).
    const shadowCatcher = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.ShadowMaterial({ opacity: 0.45 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.receiveShadow = true;
    env.add(shadowCatcher);
    if (scene.fog) scene.fog = new THREE.FogExp2(0x04100b, 0.05);
  } else {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 48),
      new THREE.MeshStandardMaterial({ color: 0x071b12, roughness: 0.85, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    env.add(floor);

    const grid = new THREE.GridHelper(8, 32, 0x1d5c40, 0x0d3324);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = 0.002;
    env.add(grid);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.58, 64),
      new THREE.MeshBasicMaterial({ color: 0x22ff9a, transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    env.add(ring);
  }

  scene.add(env);

  // Where the "user" is assumed to stand/look from — gaze target, XR anchor.
  const userAnchor = new THREE.Object3D();
  userAnchor.position.set(0, 1.55, 2.2);
  scene.add(userAnchor);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    renderer,
    scene,
    camera,
    controls,
    userAnchor,
    backend: 'webgl2',
    setEnvironmentVisible: (v: boolean) => {
      env.visible = v;
    },
  };
}
