/**
 * AvatarRig — the one interface every avatar skin implements.
 *
 * Body animation talks to bones by VRM humanoid name; face animation supplies
 * a full ARKit weight map. What the skin does with them (VRM expressions,
 * GLB morph targets, or procedural mesh transforms) is its own business —
 * the animator and retargeter never know which skin is loaded.
 */
import type * as THREE from 'three';
import type { FaceWeights } from '../face/arkit.js';

/** VRM 1.0 humanoid bone names used by this project (subset we animate). */
export type VrmBoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'leftToes'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'
  | 'rightToes';

export interface AvatarRig {
  readonly root: THREE.Object3D;
  readonly kind: 'vrm' | 'glb' | 'procedural';
  /**
   * Bone nodes are "normalized": setting an identity quaternion yields the
   * T-pose. Implementations wrap raw rigs so this invariant always holds.
   */
  getBone(bone: VrmBoneName): THREE.Object3D | null;
  /** Rest-pose world Y of the hips — retargeting scales root motion by this. */
  readonly hipsRestY: number;
  /** Apply a full ARKit face weight map for this frame (missing keys = 0). */
  applyFace(weights: FaceWeights): void;
  /** Per-frame internal update (VRM spring bones, look-at, etc.). */
  update(dt: number): void;
  dispose(): void;
}
