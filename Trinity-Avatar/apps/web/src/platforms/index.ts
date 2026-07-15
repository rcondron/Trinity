import type { Platform } from './types.js';
import { arPlatform, vrPlatform } from './webxr.js';
import { lookingGlassPlatform } from './lookingglass.js';
import { volumetricPlatform } from './volumetric.js';
import { peppersPlatform } from './peppers.js';
import { overlayPlatform } from './overlay.js';

export * from './types.js';

export function resolvePlatform(id: string): Platform | null {
  switch (id) {
    case 'vr':
      return vrPlatform;
    case 'ar':
      return arPlatform;
    case 'lookingglass':
      return lookingGlassPlatform;
    case 'volumetric':
      return volumetricPlatform;
    case 'peppers':
      return peppersPlatform;
    case 'overlay':
      return overlayPlatform;
    default:
      return null; // 'web' — default pipeline
  }
}
