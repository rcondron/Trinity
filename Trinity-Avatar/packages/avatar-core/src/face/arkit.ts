/** The ARKit-52 blendshape set — the canonical face weight space for this project. */
export const ARKIT_BLENDSHAPES = [
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type ArkitBlendshape = (typeof ARKIT_BLENDSHAPES)[number];

/** Sparse face weight map; missing keys mean 0. All values clamped to [0,1] by consumers. */
export type FaceWeights = Partial<Record<ArkitBlendshape, number>>;

/** Merge additively into `dst`, clamping to [0,1]. */
export function addWeights(dst: FaceWeights, src: FaceWeights, scale = 1): FaceWeights {
  for (const key in src) {
    const k = key as ArkitBlendshape;
    const v = (dst[k] ?? 0) + (src[k] ?? 0) * scale;
    dst[k] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return dst;
}
