/**
 * Generates the "Trinity" avatar skin as a self-contained .glb — a stylized
 * character based on the user's reference photo: dark hair pulled back in a
 * ponytail, grey tee, blue jeans, white sneakers, gold necklace/earrings,
 * warm skin, brown eyes. Style only — no facial likeness is reproduced.
 *
 * Restyle her by editing the Materials section (and proportions below) and
 * re-running this script.
 *
 * The output is a plain node hierarchy using Ready-Player-Me/Mixamo bone
 * names (Hips, Spine, LeftArm, …) with rigid-parented meshes, plus ARKit
 * blendshape morph targets on the face meshes — exactly what avatar-core's
 * GlbRig consumes, so body retargeting, lip sync, blinks and emotions all
 * work on it.
 *
 * Usage:  node apps/web/scripts/generate-trinity-skin.mjs
 * Output: apps/web/public/avatars/trinity.glb (committed — it's our own
 *         generated asset, MIT like the repo)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter's binary path uses FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
};

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/avatars/trinity.glb');

// ── Materials (styled from the user's reference photo: grey tee, blue
//    jeans, dark pulled-back hair, warm skin, gold jewelry, brown eyes) ──────
const tee = new THREE.MeshStandardMaterial({ color: 0x86868a, roughness: 0.88, metalness: 0.0 });
const denim = new THREE.MeshStandardMaterial({ color: 0x3c608f, roughness: 0.8, metalness: 0.0 });
const denimDark = new THREE.MeshStandardMaterial({ color: 0x2c4a72, roughness: 0.8 });
const skin = new THREE.MeshStandardMaterial({ color: 0xd7a07b, roughness: 0.62, metalness: 0.0 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 0.5, metalness: 0.08 });
const gold = new THREE.MeshStandardMaterial({ color: 0xd0a439, roughness: 0.3, metalness: 0.85 });
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.25 });
const iris = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.3 });
const pupil = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.3 });
const lipMat = new THREE.MeshStandardMaterial({ color: 0xb06a5a, roughness: 0.55 });
const browMat = new THREE.MeshStandardMaterial({ color: 0x241710, roughness: 0.5 });
const sneaker = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.6 });
const sole = new THREE.MeshStandardMaterial({ color: 0xcfcdc7, roughness: 0.7 });

// ── Skeleton (T-pose, world positions; names = RPM/Mixamo convention) ───────
const BONES = {
  Hips: [0, 0.95, 0],
  Spine: [0, 1.05, 0],
  Spine1: [0, 1.17, 0],
  Spine2: [0, 1.29, 0],
  Neck: [0, 1.43, 0],
  Head: [0, 1.51, 0],
  LeftShoulder: [0.055, 1.39, 0],
  LeftArm: [0.15, 1.39, 0],
  LeftForeArm: [0.405, 1.39, 0],
  LeftHand: [0.65, 1.39, 0],
  RightShoulder: [-0.055, 1.39, 0],
  RightArm: [-0.15, 1.39, 0],
  RightForeArm: [-0.405, 1.39, 0],
  RightHand: [-0.65, 1.39, 0],
  LeftUpLeg: [0.088, 0.92, 0],
  LeftLeg: [0.088, 0.5, 0],
  LeftFoot: [0.088, 0.075, 0],
  LeftToeBase: [0.088, 0.02, 0.11],
  RightUpLeg: [-0.088, 0.92, 0],
  RightLeg: [-0.088, 0.5, 0],
  RightFoot: [-0.088, 0.075, 0],
  RightToeBase: [-0.088, 0.02, 0.11],
};
const PARENTS = {
  Hips: null,
  Spine: 'Hips',
  Spine1: 'Spine',
  Spine2: 'Spine1',
  Neck: 'Spine2',
  Head: 'Neck',
  LeftShoulder: 'Spine2',
  LeftArm: 'LeftShoulder',
  LeftForeArm: 'LeftArm',
  LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2',
  RightArm: 'RightShoulder',
  RightForeArm: 'RightArm',
  RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips',
  LeftLeg: 'LeftUpLeg',
  LeftFoot: 'LeftLeg',
  LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips',
  RightLeg: 'RightUpLeg',
  RightFoot: 'RightLeg',
  RightToeBase: 'RightFoot',
};

const root = new THREE.Group();
root.name = 'TrinitySkin';
const nodes = {};
for (const [name, world] of Object.entries(BONES)) {
  const node = new THREE.Object3D();
  node.name = name;
  const parent = PARENTS[name];
  const p = parent ? BONES[parent] : [0, 0, 0];
  node.position.set(world[0] - p[0], world[1] - p[1], world[2] - p[2]);
  (parent ? nodes[parent] : root).add(node);
  nodes[name] = node;
}

const add = (bone, mesh, x = 0, y = 0, z = 0) => {
  mesh.position.set(x, y, z);
  nodes[bone].add(mesh);
  return mesh;
};
const sphere = (r, mat, sx = 1, sy = 1, sz = 1, seg = 20) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  m.scale.set(sx, sy, sz);
  return m;
};
const capsule = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

// ── Body ─────────────────────────────────────────────────────────────────────
// Hips: jeans + waistband + gold button; untucked tee hem overlaps the top
add('Hips', sphere(0.122, denim, 1.0, 0.56, 0.58));
const band = new THREE.Mesh(new THREE.TorusGeometry(0.117, 0.009, 8, 28), denimDark);
band.rotation.x = Math.PI / 2;
band.scale.set(1, 0.64, 1);
add('Hips', band, 0, 0.045, 0);
add('Hips', sphere(0.005, gold), 0, 0.05, 0.078);
const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.118, 0.05, 20), tee);
add('Hips', hem, 0, 0.075, 0);

// Relaxed tee torso (less hourglass than a bodysuit)
const waist = capsule(0.095, 0.1, tee);
waist.scale.set(1.0, 1, 0.7);
add('Spine', waist, 0, 0.055, 0);
add('Spine1', sphere(0.112, tee, 1.0, 0.8, 0.62), 0, 0.05, 0.006);
add('Spine2', sphere(0.108, tee, 1.0, 0.64, 0.56), 0, 0.045, 0);
// Thin gold necklace + pendant
const necklace = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.0035, 8, 26), gold);
necklace.rotation.x = Math.PI / 2 + 0.35;
add('Spine2', necklace, 0, 0.085, 0.02);
add('Spine2', sphere(0.0045, gold), 0, 0.062, 0.062);

add('Neck', capsule(0.03, 0.05, skin), 0, 0.03, 0);

// Head + jaw
add('Head', sphere(0.095, skin, 0.88, 1.08, 0.92), 0, 0.075, 0.004);
add('Head', sphere(0.058, skin, 0.8, 0.66, 0.55), 0, -0.006, 0.02); // jaw/chin

// Hair: pulled back tight to the skull, low ponytail, no fringe
add('Head', sphere(0.099, hairMat, 1.0, 1.05, 1.0), 0, 0.095, -0.02);
add('Head', box(0.155, 0.16, 0.045, hairMat), 0, 0.02, -0.072); // back volume
const pony = capsule(0.026, 0.085, hairMat);
pony.rotation.x = 0.55;
add('Head', pony, 0, -0.03, -0.095);
// Small gold earrings
add('Head', sphere(0.0045, gold), 0.081, 0.062, 0.012);
add('Head', sphere(0.0045, gold), -0.081, 0.062, 0.012);

// Arms (T-pose along ±X)
for (const side of [1, -1]) {
  const S = side > 0 ? 'Left' : 'Right';
  add(`${S}Shoulder`, sphere(0.034, tee, 1.0, 0.78, 0.78), side * 0.042, 0.005, 0);

  // Bare arm with a short tee sleeve over the top of the upper arm
  const up = capsule(0.032, 0.18, skin);
  up.rotation.z = side * -Math.PI / 2;
  add(`${S}Arm`, up, side * 0.1275, 0, 0);
  const sleeve = capsule(0.042, 0.07, tee);
  sleeve.rotation.z = side * -Math.PI / 2;
  add(`${S}Arm`, sleeve, side * 0.055, 0, 0);
  const fore = capsule(0.028, 0.17, skin);
  fore.rotation.z = side * -Math.PI / 2;
  add(`${S}ForeArm`, fore, side * 0.1225, 0, 0);
  add(`${S}Hand`, sphere(0.033, skin, 1.35, 0.75, 0.9), side * 0.025, 0, 0);

  // Jeans legs
  const thigh = capsule(0.056, 0.33, denim);
  add(`${S}UpLeg`, thigh, 0, -0.22, 0);
  const calf = capsule(0.046, 0.3, denim);
  add(`${S}Leg`, calf, 0, -0.2125, 0);
  // White sneakers
  add(`${S}Foot`, box(0.08, 0.06, 0.2, sneaker), 0, -0.025, 0.045);
  add(`${S}Foot`, box(0.084, 0.028, 0.22, sole), 0, -0.062, 0.05);
}

// ── Face (all under Head; ARKit morph targets) ──────────────────────────────
/** Attach morph targets to a mesh: {name: (i, x,y,z, out[3]) => writes delta}. */
function addMorphs(mesh, morphs) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  geo.morphTargetsRelative = true;
  geo.morphAttributes.position = [];
  mesh.morphTargetInfluences = [];
  mesh.morphTargetDictionary = {};
  let idx = 0;
  for (const [name, fn] of Object.entries(morphs)) {
    const deltas = new Float32Array(pos.count * 3);
    const out = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      out[0] = out[1] = out[2] = 0;
      fn(i, pos.getX(i), pos.getY(i), pos.getZ(i), out);
      deltas[i * 3] = out[0];
      deltas[i * 3 + 1] = out[1];
      deltas[i * 3 + 2] = out[2];
    }
    geo.morphAttributes.position.push(new THREE.BufferAttribute(deltas, 3));
    mesh.morphTargetInfluences.push(0);
    mesh.morphTargetDictionary[name] = idx++;
  }
}

/** Delta that rotates vertices around the local X axis by `angle`. */
const rotXDelta = (angle) => (i, x, y, z, out) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[1] = y * c - z * s - y;
  out[2] = y * s + z * c - z;
};

// Head surface at eye height sits near z ≈ 0.086 — features must protrude
// past it or they get buried in the skull.
const FACE_Z = 0.086;
for (const side of [1, -1]) {
  const sideName = side > 0 ? 'Left' : 'Right';
  const ex = side * 0.033;

  // Eye white + iris/pupil (iris mesh carries the gaze morphs)
  add('Head', sphere(0.019, eyeWhite, 1, 0.8, 0.7, 14), ex, 0.1, FACE_Z - 0.002);
  const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 12, 10), iris);
  const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 10, 8), pupil);
  pupilMesh.position.z = 0.007;
  // merge iris+pupil into one geometry so one morph set moves both
  irisMesh.updateMatrix();
  pupilMesh.updateMatrix();
  const eyeball = new THREE.Mesh(mergeGeoms([irisMesh, pupilMesh]), iris);
  const inDir = -side; // toward the nose
  addMorphs(eyeball, {
    [`eyeLookUp${sideName}`]: (i, x, y, z, out) => (out[1] = 0.006),
    [`eyeLookDown${sideName}`]: (i, x, y, z, out) => (out[1] = -0.006),
    [`eyeLookIn${sideName}`]: (i, x, y, z, out) => (out[0] = inDir * 0.007),
    [`eyeLookOut${sideName}`]: (i, x, y, z, out) => (out[0] = -inDir * 0.007),
  });
  add('Head', eyeball, ex, 0.1, FACE_Z + 0.008);

  // Eyelid: slim skin shell hidden above the eye; blink sweeps it down
  const lidGeo = new THREE.SphereGeometry(0.021, 14, 8, 0, Math.PI * 2, 0, 1.0);
  const lid = new THREE.Mesh(lidGeo, skin);
  lid.rotation.x = -1.5; // tucked up at rest
  addMorphs(lid, { [`eyeBlink${sideName}`]: rotXDelta(1.45) });
  add('Head', lid, ex, 0.1, FACE_Z - 0.002);

  // Brow
  const brow = box(0.042, 0.0065, 0.01, browMat);
  brow.rotation.z = side * 0.12;
  addMorphs(brow, {
    browInnerUp: (i, x, y, z, out) => (out[1] = 0.011),
    [`browOuterUp${sideName}`]: (i, x, y, z, out) => (out[1] = 0.009),
    [`browDown${sideName}`]: (i, x, y, z, out) => (out[1] = -0.008),
  });
  add('Head', brow, ex, 0.128, FACE_Z + 0.004);
}

// Nose
const nose = box(0.012, 0.028, 0.012, skin);
nose.rotation.x = -0.25;
add('Head', nose, 0, 0.078, FACE_Z + 0.006);

// Lips: upper + lower, both carrying the mouth morph set
function mouthMorphs(isLower) {
  return {
    jawOpen: (i, x, y, z, out) => {
      out[1] = isLower ? -0.034 : 0.004;
      out[2] = isLower ? -0.004 : 0;
    },
    mouthClose: (i, x, y, z, out) => (out[1] = isLower ? 0.004 : -0.002),
    mouthSmileLeft: (i, x, y, z, out) => {
      if (x > 0.012) {
        out[1] = 0.009;
        out[0] = 0.004;
      }
    },
    mouthSmileRight: (i, x, y, z, out) => {
      if (x < -0.012) {
        out[1] = 0.009;
        out[0] = -0.004;
      }
    },
    mouthFrownLeft: (i, x, y, z, out) => {
      if (x > 0.012) out[1] = -0.008;
    },
    mouthFrownRight: (i, x, y, z, out) => {
      if (x < -0.012) out[1] = -0.008;
    },
    mouthPucker: (i, x, y, z, out) => {
      out[0] = -x * 0.4;
      out[2] = 0.007;
    },
    mouthFunnel: (i, x, y, z, out) => {
      out[0] = -x * 0.25;
      out[2] = 0.005;
      out[1] = isLower ? -0.004 : 0.004;
    },
    mouthStretchLeft: (i, x, y, z, out) => {
      if (x > 0.005) out[0] = 0.006;
    },
    mouthStretchRight: (i, x, y, z, out) => {
      if (x < -0.005) out[0] = -0.006;
    },
  };
}
const upperLip = box(0.05, 0.008, 0.013, lipMat);
addMorphs(upperLip, mouthMorphs(false));
add('Head', upperLip, 0, 0.049, FACE_Z);
const lowerLip = box(0.047, 0.009, 0.014, lipMat);
addMorphs(lowerLip, mouthMorphs(true));
add('Head', lowerLip, 0, 0.038, FACE_Z);

/** Merge simple geometries (applies each mesh's matrix). */
function mergeGeoms(meshes) {
  let total = 0;
  const geos = meshes.map((m) => {
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  const indices = [];
  let vOff = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vOff * 3);
    norm.set(g.attributes.normal.array, vOff * 3);
    const idx = g.index;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOff);
    vOff += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(indices);
  return out;
}

// ── Export ───────────────────────────────────────────────────────────────────
const exporter = new GLTFExporter();
exporter.parse(
  root,
  (result) => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(result));
    console.log(`wrote ${OUT} (${(result.byteLength / 1024).toFixed(0)} KB)`);
  },
  (err) => {
    console.error('export failed', err);
    process.exit(1);
  },
  { binary: true },
);
