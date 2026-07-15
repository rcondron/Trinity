/**
 * The wire skeleton used by the motion service ("SOMA-24").
 *
 * This is the SMPL/SOMA body-model joint set that NVIDIA ARDY emits.
 * PoseFrame.rotations is ordered exactly by this list. The retargeting
 * layer in avatar-core maps these onto a VRM humanoid rig.
 */
export const SOMA_JOINTS = [
  'pelvis',
  'left_hip',
  'right_hip',
  'spine1',
  'left_knee',
  'right_knee',
  'spine2',
  'left_ankle',
  'right_ankle',
  'spine3',
  'left_foot',
  'right_foot',
  'neck',
  'left_collar',
  'right_collar',
  'head',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hand',
  'right_hand',
] as const;

export type SomaJoint = (typeof SOMA_JOINTS)[number];

export const SOMA_JOINT_COUNT = SOMA_JOINTS.length;

export const SOMA_JOINT_INDEX: Readonly<Record<SomaJoint, number>> = Object.fromEntries(
  SOMA_JOINTS.map((j, i) => [j, i]),
) as Record<SomaJoint, number>;

/** Parent index per joint (-1 for pelvis root), matching SMPL topology. */
export const SOMA_PARENTS: readonly number[] = [
  -1, // pelvis
  0, // left_hip
  0, // right_hip
  0, // spine1
  1, // left_knee
  2, // right_knee
  3, // spine2
  4, // left_ankle
  5, // right_ankle
  6, // spine3
  7, // left_foot
  8, // right_foot
  9, // neck
  9, // left_collar
  9, // right_collar
  12, // head
  13, // left_shoulder
  14, // right_shoulder
  16, // left_elbow
  17, // right_elbow
  18, // left_wrist
  19, // right_wrist
  20, // left_hand
  21, // right_hand
];

/**
 * VRM humanoid bone names (VRM 1.0 spec) that each SOMA joint drives.
 * Joints with no sensible VRM counterpart map to null.
 */
export const SOMA_TO_VRM: Readonly<Record<SomaJoint, string | null>> = {
  pelvis: 'hips',
  left_hip: 'leftUpperLeg',
  right_hip: 'rightUpperLeg',
  spine1: 'spine',
  left_knee: 'leftLowerLeg',
  right_knee: 'rightLowerLeg',
  spine2: 'chest',
  left_ankle: 'leftFoot',
  right_ankle: 'rightFoot',
  spine3: 'upperChest',
  left_foot: 'leftToes',
  right_foot: 'rightToes',
  neck: 'neck',
  left_collar: 'leftShoulder',
  right_collar: 'rightShoulder',
  head: 'head',
  left_shoulder: 'leftUpperArm',
  right_shoulder: 'rightUpperArm',
  left_elbow: 'leftLowerArm',
  right_elbow: 'rightLowerArm',
  left_wrist: 'leftHand',
  right_wrist: 'rightHand',
  left_hand: null,
  right_hand: null,
};
