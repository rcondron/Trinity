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
  hips: ['Hips'],
  spine: ['Spine'],
  chest: ['Spine1'],
  upperChest: ['Spine2'],
  neck: ['Neck'],
  head: ['Head'],
  leftShoulder: ['LeftShoulder'],
  leftUpperArm: ['LeftArm', 'LeftUpperArm'],
  leftLowerArm: ['LeftForeArm', 'LeftLowerArm'],
  leftHand: ['LeftHand'],
  rightShoulder: ['RightShoulder'],
  rightUpperArm: ['RightArm', 'RightUpperArm'],
  rightLowerArm: ['RightForeArm', 'RightLowerArm'],
  rightHand: ['RightHand'],
  leftUpperLeg: ['LeftUpLeg', 'LeftUpperLeg'],
  leftLowerLeg: ['LeftLeg', 'LeftLowerLeg'],
  leftFoot: ['LeftFoot'],
  leftToes: ['LeftToeBase', 'LeftToe'],
  rightUpperLeg: ['RightUpLeg', 'RightUpperLeg'],
  rightLowerLeg: ['RightLeg', 'RightLowerLeg'],
  rightFoot: ['RightFoot'],
  rightToes: ['RightToeBase', 'RightToe'],
};

/**
 * Normalize decorated rig names so exports from Mixamo/Sketchfab/DCCs all
 * match: strips "mixamorig"/"Armature|" style prefixes and "_01" style
 * numeric suffixes, drops separators, lowercases.
 *   "mixamorig:LeftForeArm" → "leftforearm", "Hips_01" → "hips"
 */
export function normalizeBoneName(name: string): string {
  return name
    .replace(/^.*[|]/, '')
    .replace(/^mixamorig[:_]?/i, '')
    // strip "_01"-style suffixes — separator required, so "Spine1" survives
    .replace(/[_-]\d+$/, '')
    .replace(/[\s:_-]/g, '')
    .toLowerCase();
}

/**
 * Which child bone defines each bone's "limb direction", and the world-space
 * direction that limb must point in a T-pose. Used to normalize A-pose (or
 * any) rest poses: the correction rotating restDir → target is baked into
 * the bone's rest orientation, so identity proxy rotation always means
 * T-pose regardless of how the model was exported.
 */
const TPOSE_TARGETS: Partial<Record<VrmBoneName, { child: VrmBoneName; dir: [number, number, number] }>> = {
  spine: { child: 'chest', dir: [0, 1, 0] },
  chest: { child: 'upperChest', dir: [0, 1, 0] },
  upperChest: { child: 'neck', dir: [0, 1, 0] },
  neck: { child: 'head', dir: [0, 1, 0] },
  leftUpperArm: { child: 'leftLowerArm', dir: [1, 0, 0] },
  leftLowerArm: { child: 'leftHand', dir: [1, 0, 0] },
  rightUpperArm: { child: 'rightLowerArm', dir: [-1, 0, 0] },
  rightLowerArm: { child: 'rightHand', dir: [-1, 0, 0] },
  leftUpperLeg: { child: 'leftLowerLeg', dir: [0, -1, 0] },
  leftLowerLeg: { child: 'leftFoot', dir: [0, -1, 0] },
  rightUpperLeg: { child: 'rightLowerLeg', dir: [0, -1, 0] },
  rightLowerLeg: { child: 'rightFoot', dir: [0, -1, 0] },
};

/** Hierarchy-ordered bone list so parents are normalized before children. */
const BONE_ORDER: VrmBoneName[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
];

/**
 * Wraps a raw GLB skeleton behind normalized proxy nodes: identity proxy
 * rotation = T-pose, like a VRM normalized humanoid.
 *
 * Real rigs (Mixamo, Sketchfab exports) have arbitrary joint orientations
 * and arbitrary rest poses (T-pose or A-pose), so proxy rotations — which
 * live in world-aligned T-pose space — are converted per bone:
 *   q_local = inv(correctedParentRestWorld) · q_proxy · correctedRestWorld
 * where "corrected" bakes in the rest-pose → T-pose normalization measured
 * from the skeleton's own limb directions.
 */
class GlbRig implements AvatarRig {
  readonly kind = 'glb';
  readonly root: THREE.Object3D;
  readonly hipsRestY: number;
  private readonly proxies = new Map<VrmBoneName, THREE.Object3D>();
  private readonly real = new Map<
    VrmBoneName,
    { node: THREE.Object3D; pInvWorld: THREE.Quaternion; bWorld: THREE.Quaternion }
  >();
  private hipsParentInv = new THREE.Matrix4();
  private readonly morphMeshes: THREE.Mesh[] = [];
  /** Bone-driven eyes for models without eyeLook morphs (rest local quat kept). */
  private eyeBones: { left?: { node: THREE.Object3D; rest: THREE.Quaternion }; right?: { node: THREE.Object3D; rest: THREE.Quaternion } } = {};
  private hasEyeLookMorphs = false;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;

    // Normalize the model's size and grounding: some exports (Sketchfab,
    // cm-unit DCCs) arrive 100× too big or floating above the origin.
    this.root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    const height = bounds.max.y - bounds.min.y;
    if (height > 0 && (height < 0.5 || height > 3)) {
      const s = 1.7 / height;
      this.root.scale.multiplyScalar(s);
      this.root.updateWorldMatrix(true, true);
      bounds.setFromObject(this.root);
    }
    if (Math.abs(bounds.min.y) > 0.02) {
      this.root.position.y -= bounds.min.y; // feet on the ground
      this.root.updateWorldMatrix(true, true);
    }

    // Index nodes by normalized name so decorated rigs ("Hips_01",
    // "mixamorig:LeftArm") still map onto the VRM humanoid.
    const byName = new Map<string, THREE.Object3D>();
    this.root.traverse((o) => {
      const key = normalizeBoneName(o.name);
      if (!byName.has(key)) byName.set(key, o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary) this.morphMeshes.push(mesh);
    });
    // Pass 1 — locate nodes, capture rest world orientations/positions.
    const found = new Map<
      VrmBoneName,
      { node: THREE.Object3D; restWorld: THREE.Quaternion; restPos: THREE.Vector3 }
    >();
    const nodeToVrm = new Map<THREE.Object3D, VrmBoneName>();
    for (const vrmName of BONE_ORDER) {
      for (const candidate of VRM_TO_GLB_BONES[vrmName]) {
        const node = byName.get(normalizeBoneName(candidate));
        if (node) {
          const restWorld = new THREE.Quaternion();
          node.getWorldQuaternion(restWorld);
          const restPos = new THREE.Vector3();
          node.getWorldPosition(restPos);
          found.set(vrmName, { node, restWorld, restPos });
          nodeToVrm.set(node, vrmName);
          break;
        }
      }
    }

    // Pass 2 — normalize the rest pose to T-pose. For each bone, the world
    // correction accumulated from mapped ancestors (delta) rotates its limb
    // direction; if a T-pose target is defined and the limb points elsewhere
    // (A-pose exports), an additional correction is baked into its rest.
    const deltas = new Map<VrmBoneName, THREE.Quaternion>(); // accumulated world correction
    const dirNow = new THREE.Vector3();
    const target = new THREE.Vector3();
    for (const vrmName of BONE_ORDER) {
      const entry = found.get(vrmName);
      if (!entry) continue;

      // nearest mapped ancestor's accumulated correction
      let anc: THREE.Object3D | null = entry.node.parent;
      let ancDelta = new THREE.Quaternion();
      while (anc) {
        const ancVrm = nodeToVrm.get(anc);
        if (ancVrm && deltas.has(ancVrm)) {
          ancDelta = deltas.get(ancVrm)!;
          break;
        }
        anc = anc.parent;
      }

      const parentRestWorld = new THREE.Quaternion();
      (entry.node.parent ?? this.root).getWorldQuaternion(parentRestWorld);
      const correctedParent = ancDelta.clone().multiply(parentRestWorld);
      let correctedRest = ancDelta.clone().multiply(entry.restWorld);

      const t = TPOSE_TARGETS[vrmName];
      const child = t ? found.get(t.child) : undefined;
      if (t && child) {
        dirNow.copy(child.restPos).sub(entry.restPos);
        if (dirNow.lengthSq() > 1e-8) {
          dirNow.normalize().applyQuaternion(ancDelta);
          target.set(t.dir[0], t.dir[1], t.dir[2]);
          const fix = new THREE.Quaternion().setFromUnitVectors(dirNow, target);
          correctedRest = fix.multiply(correctedRest);
        }
      }
      deltas.set(vrmName, correctedRest.clone().multiply(entry.restWorld.clone().invert()));

      this.real.set(vrmName, {
        node: entry.node,
        pInvWorld: correctedParent.invert(),
        bWorld: correctedRest,
      });
      const proxy = new THREE.Object3D();
      proxy.name = `proxy_${vrmName}`;
      this.proxies.set(vrmName, proxy);
    }
    const hips = this.real.get('hips');
    const pos = new THREE.Vector3();
    hips?.node.getWorldPosition(pos);
    this.hipsRestY = pos.y || 0.95;
    if (hips?.node.parent) {
      hips.node.parent.updateWorldMatrix(true, false);
      this.hipsParentInv.copy(hips.node.parent.matrixWorld).invert();
    }

    // Eye BONES (RPM-style rigs): drive gaze directly when the model ships
    // no eyeLook morph targets — saccades/gaze keep working on static faces.
    this.hasEyeLookMorphs = this.morphMeshes.some((m) =>
      Object.keys(m.morphTargetDictionary ?? {}).some((k) => k.startsWith('eyeLook')),
    );
    this.root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = normalizeBoneName(o.name);
      if (n === 'lefteye' || n === 'eyeleft') {
        this.eyeBones.left = { node: o, rest: o.quaternion.clone() };
      } else if (n === 'righteye' || n === 'eyeright') {
        this.eyeBones.right = { node: o, rest: o.quaternion.clone() };
      }
    });
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

    if (!this.hasEyeLookMorphs) {
      const w = (k: keyof FaceWeights) => weights[k] ?? 0;
      // +X is the character's left; positive yaw (about +Y) turns gaze that way.
      const YAW_MAX = 0.35; // rad ≈ 20°
      const PITCH_MAX = 0.25;
      const apply = (
        eye: { node: THREE.Object3D; rest: THREE.Quaternion } | undefined,
        towardLeft: number,
        up: number,
      ) => {
        if (!eye) return;
        this.eyeEuler.set(-up * PITCH_MAX, towardLeft * YAW_MAX, 0, 'YXZ');
        this.eyeDelta.setFromEuler(this.eyeEuler);
        eye.node.quaternion.copy(eye.rest).multiply(this.eyeDelta);
      };
      apply(
        this.eyeBones.left,
        w('eyeLookOutLeft') - w('eyeLookInLeft'),
        w('eyeLookUpLeft') - w('eyeLookDownLeft'),
      );
      apply(
        this.eyeBones.right,
        w('eyeLookInRight') - w('eyeLookOutRight'),
        w('eyeLookUpRight') - w('eyeLookDownRight'),
      );
    }
  }

  private readonly eyeEuler = new THREE.Euler();
  private readonly eyeDelta = new THREE.Quaternion();

  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  update(_dt: number): void {
    for (const [name, proxy] of this.proxies) {
      const target = this.real.get(name);
      if (!target) continue;
      // world-aligned proxy rotation → this bone's local frame
      this.tmpQ.copy(target.pInvWorld).multiply(proxy.quaternion).multiply(target.bWorld);
      target.node.quaternion.copy(this.tmpQ);
      if (name === 'hips' && proxy.position.lengthSq() > 0) {
        // The animator writes absolute world-space hip positions (standing
        // height ≈ 0.95 m, so a real pose is never at the origin); convert
        // into the hips' parent space (handles scaled/rotated armatures).
        this.tmpV.copy(proxy.position).applyMatrix4(this.hipsParentInv);
        target.node.position.copy(this.tmpV);
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
