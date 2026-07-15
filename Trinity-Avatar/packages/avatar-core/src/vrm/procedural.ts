/**
 * Built-in procedural avatar — a stylized "hologram" humanoid assembled from
 * primitives. Zero downloaded assets, so the repo demos out of the box; any
 * VRM/GLB dropped onto the app replaces it. Implements the same AvatarRig
 * contract: T-pose rest with normalized bones, ARKit face weights.
 */
import * as THREE from 'three';
import type { FaceWeights } from '../face/arkit.js';
import type { AvatarRig, VrmBoneName } from './rig.js';

interface BoneSpec {
  name: VrmBoneName;
  parent: VrmBoneName | null;
  /** World-space rest position (T-pose, meters, feet at y=0). */
  pos: [number, number, number];
}

const BONES: BoneSpec[] = [
  { name: 'hips', parent: null, pos: [0, 0.95, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 1.06, 0] },
  { name: 'chest', parent: 'spine', pos: [0, 1.18, 0] },
  { name: 'upperChest', parent: 'chest', pos: [0, 1.3, 0] },
  { name: 'neck', parent: 'upperChest', pos: [0, 1.44, 0] },
  { name: 'head', parent: 'neck', pos: [0, 1.52, 0] },
  { name: 'leftShoulder', parent: 'upperChest', pos: [0.06, 1.4, 0] },
  { name: 'leftUpperArm', parent: 'leftShoulder', pos: [0.16, 1.4, 0] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', pos: [0.42, 1.4, 0] },
  { name: 'leftHand', parent: 'leftLowerArm', pos: [0.66, 1.4, 0] },
  { name: 'rightShoulder', parent: 'upperChest', pos: [-0.06, 1.4, 0] },
  { name: 'rightUpperArm', parent: 'rightShoulder', pos: [-0.16, 1.4, 0] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', pos: [-0.42, 1.4, 0] },
  { name: 'rightHand', parent: 'rightLowerArm', pos: [-0.66, 1.4, 0] },
  { name: 'leftUpperLeg', parent: 'hips', pos: [0.09, 0.9, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', pos: [0.09, 0.5, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', pos: [0.09, 0.08, 0] },
  { name: 'leftToes', parent: 'leftFoot', pos: [0.09, 0.02, 0.12] },
  { name: 'rightUpperLeg', parent: 'hips', pos: [-0.09, 0.9, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', pos: [-0.09, 0.5, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', pos: [-0.09, 0.08, 0] },
  { name: 'rightToes', parent: 'rightFoot', pos: [-0.09, 0.02, 0.12] },
];

const LIMB_SEGMENTS: Array<[VrmBoneName, VrmBoneName, number]> = [
  ['leftUpperArm', 'leftLowerArm', 0.045],
  ['leftLowerArm', 'leftHand', 0.038],
  ['rightUpperArm', 'rightLowerArm', 0.045],
  ['rightLowerArm', 'rightHand', 0.038],
  ['leftUpperLeg', 'leftLowerLeg', 0.06],
  ['leftLowerLeg', 'leftFoot', 0.05],
  ['rightUpperLeg', 'rightLowerLeg', 0.06],
  ['rightLowerLeg', 'rightFoot', 0.05],
];

export interface ProceduralAvatarOptions {
  color: number;
  emissive: number;
  opacity: number;
}

const DEFAULTS: ProceduralAvatarOptions = {
  color: 0x0d2b22,
  emissive: 0x22ff9a, // Trinity terminal green
  opacity: 0.96,
};

export class ProceduralRig implements AvatarRig {
  readonly kind = 'procedural';
  readonly root: THREE.Object3D;
  readonly hipsRestY: number;
  private readonly bones = new Map<VrmBoneName, THREE.Object3D>();
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly glowMat: THREE.MeshStandardMaterial;

  // Face parts
  private eyeL!: THREE.Object3D;
  private eyeR!: THREE.Object3D;
  private pupilL!: THREE.Mesh;
  private pupilR!: THREE.Mesh;
  private lidL!: THREE.Mesh;
  private lidR!: THREE.Mesh;
  private browL!: THREE.Mesh;
  private browR!: THREE.Mesh;
  private mouth!: THREE.Mesh;
  private mouthCornerL!: THREE.Mesh;
  private mouthCornerR!: THREE.Mesh;

  constructor(opts: Partial<ProceduralAvatarOptions> = {}) {
    const o = { ...DEFAULTS, ...opts };
    this.root = new THREE.Group();
    this.root.name = 'ProceduralAvatar';

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: o.color,
      emissive: o.emissive,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: o.opacity,
    });
    this.glowMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: o.emissive,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });

    // ── Skeleton: nodes positioned so local identity == T-pose ────────────
    for (const spec of BONES) {
      const node = new THREE.Object3D();
      node.name = spec.name;
      const parent = spec.parent ? this.bones.get(spec.parent) : undefined;
      const parentPos: [number, number, number] = spec.parent
        ? (BONES.find((b) => b.name === spec.parent)?.pos ?? [0, 0, 0])
        : [0, 0, 0];
      node.position.set(
        spec.pos[0] - parentPos[0],
        spec.pos[1] - parentPos[1],
        spec.pos[2] - parentPos[2],
      );
      (parent ?? this.root).add(node);
      this.bones.set(spec.name, node);
    }
    this.hipsRestY = 0.95;

    this.buildBody();
    this.buildFace();
  }

  private bone(name: VrmBoneName): THREE.Object3D {
    const b = this.bones.get(name);
    if (!b) throw new Error(`missing bone ${name}`);
    return b;
  }

  private capsuleBetween(
    from: VrmBoneName,
    to: VrmBoneName,
    radius: number,
  ): void {
    const a = BONES.find((b) => b.name === from)!.pos;
    const b = BONES.find((bb) => bb.name === to)!.pos;
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius), 6, 12);
    const mesh = new THREE.Mesh(geo, this.bodyMat);
    // CapsuleGeometry is Y-aligned and centered; move its center to len/2 and
    // rotate so +Y points at the child joint.
    mesh.position.copy(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.bone(from).add(mesh);
  }

  private buildBody(): void {
    // Torso: hips block + chest capsule
    const hipsGeo = new THREE.SphereGeometry(0.11, 16, 12);
    hipsGeo.scale(1.15, 0.75, 0.8);
    this.bone('hips').add(new THREE.Mesh(hipsGeo, this.bodyMat));

    const torso = new THREE.CapsuleGeometry(0.13, 0.22, 6, 14);
    torso.scale(1.15, 1, 0.72);
    const torsoMesh = new THREE.Mesh(torso, this.bodyMat);
    torsoMesh.position.set(0, 0.1, 0);
    this.bone('spine').add(torsoMesh);

    const chestGeo = new THREE.SphereGeometry(0.13, 16, 12);
    chestGeo.scale(1.25, 0.8, 0.75);
    const chestMesh = new THREE.Mesh(chestGeo, this.bodyMat);
    chestMesh.position.set(0, 0.1, 0);
    this.bone('upperChest').add(chestMesh);

    // Neck + head
    this.capsuleFromBone('neck', 0.035, 0.07);
    const headGeo = new THREE.SphereGeometry(0.105, 20, 16);
    headGeo.scale(0.92, 1.08, 0.98);
    const headMesh = new THREE.Mesh(headGeo, this.bodyMat);
    headMesh.position.set(0, 0.08, 0);
    this.bone('head').add(headMesh);

    // Limbs
    for (const [from, to, r] of LIMB_SEGMENTS) this.capsuleBetween(from, to, r);
    // Hands and feet
    for (const side of ['left', 'right'] as const) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), this.bodyMat);
      this.bone(`${side}Hand`).add(hand);
      const footGeo = new THREE.BoxGeometry(0.09, 0.06, 0.22);
      const foot = new THREE.Mesh(footGeo, this.bodyMat);
      foot.position.set(0, -0.02, 0.05);
      this.bone(`${side}Foot`).add(foot);
    }
  }

  private capsuleFromBone(bone: VrmBoneName, radius: number, length: number): void {
    const geo = new THREE.CapsuleGeometry(radius, length, 6, 10);
    const mesh = new THREE.Mesh(geo, this.bodyMat);
    mesh.position.set(0, length / 2, 0);
    this.bone(bone).add(mesh);
  }

  private buildFace(): void {
    const head = this.bone('head');
    const z = 0.088; // face plane depth on the head sphere

    const eyeGeo = new THREE.SphereGeometry(0.024, 12, 10);
    const pupilGeo = new THREE.SphereGeometry(0.011, 10, 8);
    const lidGeo = new THREE.SphereGeometry(0.027, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2);

    for (const side of [-1, 1] as const) {
      const eye = new THREE.Group();
      eye.position.set(0.038 * side, 0.1, z);
      const ball = new THREE.Mesh(eyeGeo, this.glowMat);
      const pupil = new THREE.Mesh(pupilGeo, this.bodyMat);
      pupil.position.set(0, 0, 0.018);
      const lid = new THREE.Mesh(lidGeo, this.bodyMat);
      lid.rotation.x = -0.35;
      lid.scale.setScalar(0.05); // open
      eye.add(ball, pupil, lid);
      head.add(eye);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.012), this.glowMat);
      brow.position.set(0.038 * side, 0.145, z);
      head.add(brow);

      if (side === 1) {
        this.eyeL = eye;
        this.pupilL = pupil;
        this.lidL = lid;
        this.browL = brow;
      } else {
        this.eyeR = eye;
        this.pupilR = pupil;
        this.lidR = lid;
        this.browR = brow;
      }
    }

    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.008, 0.01), this.glowMat);
    this.mouth.position.set(0, 0.028, z + 0.004);
    head.add(this.mouth);

    const cornerGeo = new THREE.SphereGeometry(0.007, 8, 6);
    this.mouthCornerL = new THREE.Mesh(cornerGeo, this.glowMat);
    this.mouthCornerL.position.set(0.032, 0.028, z + 0.004);
    this.mouthCornerR = new THREE.Mesh(cornerGeo, this.glowMat);
    this.mouthCornerR.position.set(-0.032, 0.028, z + 0.004);
    head.add(this.mouthCornerL, this.mouthCornerR);
  }

  getBone(bone: VrmBoneName): THREE.Object3D | null {
    return this.bones.get(bone) ?? null;
  }

  applyFace(w: FaceWeights): void {
    const g = (k: keyof FaceWeights) => w[k] ?? 0;

    // Eyelids: blink scales the lid shell over the eye
    const lidScale = (blink: number) => 0.05 + blink * 1.05;
    this.lidL.scale.setScalar(lidScale(g('eyeBlinkLeft')));
    this.lidR.scale.setScalar(lidScale(g('eyeBlinkRight')));

    // Gaze: pupils shift; positive look-in means toward the nose
    const lookXL = g('eyeLookOutLeft') - g('eyeLookInLeft');
    const lookXR = g('eyeLookInRight') - g('eyeLookOutRight');
    const lookYL = g('eyeLookUpLeft') - g('eyeLookDownLeft');
    const lookYR = g('eyeLookUpRight') - g('eyeLookDownRight');
    this.pupilL.position.set(lookXL * 0.012, lookYL * 0.01, 0.018);
    this.pupilR.position.set(lookXR * 0.012, lookYR * 0.01, 0.018);

    // Eye openness beyond blink (wide/squint)
    const wideL = 1 + g('eyeWideLeft') * 0.35 - g('eyeSquintLeft') * 0.3;
    const wideR = 1 + g('eyeWideRight') * 0.35 - g('eyeSquintRight') * 0.3;
    this.eyeL.scale.set(1, wideL, 1);
    this.eyeR.scale.set(1, wideR, 1);

    // Brows
    const innerUp = g('browInnerUp');
    this.browL.position.y = 0.145 + (g('browOuterUpLeft') + innerUp * 0.6) * 0.02 - g('browDownLeft') * 0.012;
    this.browR.position.y = 0.145 + (g('browOuterUpRight') + innerUp * 0.6) * 0.02 - g('browDownRight') * 0.012;
    this.browL.rotation.z = innerUp * 0.25 - g('browDownLeft') * 0.2;
    this.browR.rotation.z = -innerUp * 0.25 + g('browDownRight') * 0.2;

    // Mouth: open (scale y + drop), width (pucker/stretch), corners (smile/frown)
    const open = g('jawOpen');
    const pucker = Math.max(g('mouthPucker'), g('mouthFunnel') * 0.8);
    const stretch = (g('mouthStretchLeft') + g('mouthStretchRight')) / 2;
    const smile = (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
    const frown = (g('mouthFrownLeft') + g('mouthFrownRight')) / 2;
    const close = g('mouthClose');

    this.mouth.scale.set(
      1 - pucker * 0.55 + stretch * 0.35,
      Math.max(0.35, 1 - close * 0.6 + open * 4.5),
      1 + pucker * 0.8,
    );
    this.mouth.position.y = 0.028 - open * 0.018;
    const cornerY = 0.028 + smile * 0.014 - frown * 0.012;
    const cornerX = 0.032 * (1 - pucker * 0.5 + stretch * 0.3 + smile * 0.15);
    this.mouthCornerL.position.set(cornerX, cornerY, this.mouthCornerL.position.z);
    this.mouthCornerR.position.set(-cornerX, cornerY, this.mouthCornerR.position.z);
  }

  update(_dt: number): void {
    // No spring bones; nothing to integrate.
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.glowMat.dispose();
  }
}
