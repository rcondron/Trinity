/**
 * Avatar loading: VRM 1.0 (canonical) and plain GLB with ARKit blendshapes
 * (Ready Player Me, MetaHuman exports). Returns an AvatarRig either way.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { ArkitBlendshape, FaceWeights } from '../face/arkit.js';
import type { AvatarRig, VrmBoneName } from './rig.js';

/** ARKit → VRM 1.0 preset expression approximation, used when the VRM lacks
 *  per-ARKit custom expressions. Weights accumulate; largest contributor wins. */
const ARKIT_TO_VRM_PRESET: Partial<Record<ArkitBlendshape, Array<[string, number]>>> = {
  jawOpen: [['aa', 1.0]],
  mouthFunnel: [['ou', 0.8]],
  mouthPucker: [['ou', 1.0]],
  mouthSmileLeft: [['happy', 0.5]],
  mouthSmileRight: [['happy', 0.5]],
  mouthFrownLeft: [['sad', 0.5]],
  mouthFrownRight: [['sad', 0.5]],
  mouthStretchLeft: [['ih', 0.5]],
  mouthStretchRight: [['ih', 0.5]],
  eyeBlinkLeft: [['blinkLeft', 1.0]],
  eyeBlinkRight: [['blinkRight', 1.0]],
  eyeWideLeft: [['surprised', 0.4]],
  eyeWideRight: [['surprised', 0.4]],
  browInnerUp: [['surprised', 0.25]],
  eyeLookUpLeft: [['lookUp', 0.5]],
  eyeLookUpRight: [['lookUp', 0.5]],
  eyeLookDownLeft: [['lookDown', 0.5]],
  eyeLookDownRight: [['lookDown', 0.5]],
  eyeLookInLeft: [['lookRight', 0.5]],
  eyeLookOutLeft: [['lookLeft', 0.5]],
  eyeLookInRight: [['lookLeft', 0.5]],
  eyeLookOutRight: [['lookRight', 0.5]],
};

class VrmRig implements AvatarRig {
  readonly kind = 'vrm';
  readonly root: THREE.Object3D;
  readonly hipsRestY: number;
  private readonly hasCustom: Set<string>;

  constructor(private readonly vrm: VRM) {
    this.root = vrm.scene;
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    const pos = new THREE.Vector3();
    hips?.getWorldPosition(pos);
    this.hipsRestY = pos.y || 0.95;
    this.hasCustom = new Set(
      Object.keys(vrm.expressionManager?.expressionMap ?? {}),
    );
  }

  getBone(bone: VrmBoneName): THREE.Object3D | null {
    return this.vrm.humanoid.getNormalizedBoneNode(bone);
  }

  applyFace(weights: FaceWeights): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    const presets = new Map<string, number>();
    for (const key in weights) {
      const k = key as ArkitBlendshape;
      const w = weights[k] ?? 0;
      if (this.hasCustom.has(k)) {
        // Model ships real ARKit expressions (e.g. VRM from RPM pipeline) — use directly.
        em.setValue(k, w);
        continue;
      }
      for (const [preset, scale] of ARKIT_TO_VRM_PRESET[k] ?? []) {
        presets.set(preset, Math.min(1, (presets.get(preset) ?? 0) + w * scale));
      }
    }
    for (const [preset, w] of presets) {
      if (this.hasCustom.has(preset) || em.getExpressionTrackName(preset)) em.setValue(preset, w);
    }
  }

  update(dt: number): void {
    this.vrm.update(dt);
  }

  dispose(): void {
    VRMUtils.deepDispose(this.vrm.scene);
  }
}

/** VRM humanoid name → common GLB (Mixamo/Ready Player Me) bone names. */
const VRM_TO_GLB_BONES: Record<VrmBoneName, string[]> = {
  hips: ['Hips', 'mixamorigHips'],
  spine: ['Spine', 'mixamorigSpine'],
  chest: ['Spine1', 'mixamorigSpine1'],
  upperChest: ['Spine2', 'mixamorigSpine2'],
  neck: ['Neck', 'mixamorigNeck'],
  head: ['Head', 'mixamorigHead'],
  leftShoulder: ['LeftShoulder', 'mixamorigLeftShoulder'],
  leftUpperArm: ['LeftArm', 'mixamorigLeftArm'],
  leftLowerArm: ['LeftForeArm', 'mixamorigLeftForeArm'],
  leftHand: ['LeftHand', 'mixamorigLeftHand'],
  rightShoulder: ['RightShoulder', 'mixamorigRightShoulder'],
  rightUpperArm: ['RightArm', 'mixamorigRightArm'],
  rightLowerArm: ['RightForeArm', 'mixamorigRightForeArm'],
  rightHand: ['RightHand', 'mixamorigRightHand'],
  leftUpperLeg: ['LeftUpLeg', 'mixamorigLeftUpLeg'],
  leftLowerLeg: ['LeftLeg', 'mixamorigLeftLeg'],
  leftFoot: ['LeftFoot', 'mixamorigLeftFoot'],
  leftToes: ['LeftToeBase', 'mixamorigLeftToeBase'],
  rightUpperLeg: ['RightUpLeg', 'mixamorigRightUpLeg'],
  rightLowerLeg: ['RightLeg', 'mixamorigRightLeg'],
  rightFoot: ['RightFoot', 'mixamorigRightFoot'],
  rightToes: ['RightToeBase', 'mixamorigRightToeBase'],
};

/**
 * Wraps a raw GLB skeleton behind normalized proxy nodes: each proxy's
 * quaternion is applied as `rest * q` on the real bone, so identity = T-pose
 * like a VRM normalized humanoid.
 */
class GlbRig implements AvatarRig {
  readonly kind = 'glb';
  readonly root: THREE.Object3D;
  readonly hipsRestY: number;
  private readonly proxies = new Map<VrmBoneName, THREE.Object3D>();
  private readonly real = new Map<VrmBoneName, { node: THREE.Object3D; rest: THREE.Quaternion }>();
  private readonly morphMeshes: THREE.Mesh[] = [];

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    const byName = new Map<string, THREE.Object3D>();
    this.root.traverse((o) => {
      byName.set(o.name, o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary) this.morphMeshes.push(mesh);
    });
    for (const vrmName of Object.keys(VRM_TO_GLB_BONES) as VrmBoneName[]) {
      for (const candidate of VRM_TO_GLB_BONES[vrmName]) {
        const node = byName.get(candidate);
        if (node) {
          this.real.set(vrmName, { node, rest: node.quaternion.clone() });
          const proxy = new THREE.Object3D();
          proxy.name = `proxy_${vrmName}`;
          this.proxies.set(vrmName, proxy);
          break;
        }
      }
    }
    const hips = this.real.get('hips');
    const pos = new THREE.Vector3();
    hips?.node.getWorldPosition(pos);
    this.hipsRestY = pos.y || 0.95;
  }

  getBone(bone: VrmBoneName): THREE.Object3D | null {
    return this.proxies.get(bone) ?? null;
  }

  applyFace(weights: FaceWeights): void {
    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const key in dict) {
        const idx = dict[key];
        if (idx !== undefined) {
          influences[idx] = (weights as Record<string, number | undefined>)[key] ?? 0;
        }
      }
    }
  }

  update(_dt: number): void {
    const q = new THREE.Quaternion();
    for (const [name, proxy] of this.proxies) {
      const target = this.real.get(name);
      if (!target) continue;
      q.copy(target.rest).multiply(proxy.quaternion);
      target.node.quaternion.copy(q);
      if (name === 'hips') {
        target.node.position.add(proxy.position);
        proxy.position.set(0, 0, 0);
      }
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

export async function loadAvatar(url: string | Blob): Promise<AvatarRig> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const objectUrl = typeof url === 'string' ? url : URL.createObjectURL(url);
  try {
    const gltf = await loader.loadAsync(objectUrl);
    const vrm = gltf.userData['vrm'] as VRM | undefined;
    if (vrm) {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      // VRM 0.x models face +Z; three-vrm rotates them, so both conventions work.
      VRMUtils.rotateVRM0(vrm);
      return new VrmRig(vrm);
    }
    return new GlbRig(gltf);
  } finally {
    if (typeof url !== 'string') URL.revokeObjectURL(objectUrl);
  }
}
