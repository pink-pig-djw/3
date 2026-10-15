// Retargets the Mixamo FBX animations from the animation library onto the VRM
// humanoid rig (three-vrm "normalized" bones) and writes a compact JSON file.
//
// Usage: node tools/convert-anims.mjs <path-to-mixamoLibrary>
// Output: assets/anims.json
//
// Rotation retarget follows three-vrm's Mixamo example:
//   q_vrm = parentRestWorld * q_mixamo * inverse(restWorld)
// Hips positions are stored divided by the Mixamo hips height; the game
// multiplies them by each VRM's own hips height.
import fs from 'node:fs';
import path from 'node:path';

globalThis.self = globalThis;
globalThis.window = globalThis;
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const LIB = process.argv[2];
if (!LIB) {
  console.error('usage: node tools/convert-anims.mjs <path-to-mixamoLibrary>');
  process.exit(1);
}
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/anims.json');

// flat: 'xz' strips root motion, 'xyz' also locks height (physics drives jumps)
// trim: [start, end] seconds
const CLIPS = {
  run: { file: '02_Locomotion/Fast Run.fbx', flat: 'xz' },
  jog: { file: '02_Locomotion/Running.fbx', flat: 'xz' },
  jump: { file: '03_Jump_Climb/Running Jump.fbx', flat: 'xyz' },
  roll: { file: '03_Jump_Climb/Sprinting Forward Roll.fbx', flat: 'xz', trim: [0.47, 1.17] },
  fall: { file: '03_Jump_Climb/Falling Idle.fbx', flat: 'xz' },
  death: { file: '04_Combat/Falling Back Death.fbx', flat: 'xz' },
  dance: { file: '07_Dance/Hip Hop Dancing.fbx', flat: 'xz' },
  idle: { file: '01_Idle/Happy Idle.fbx', flat: 'xz' },
  shake: { file: '06_Emote/Shaking Head No.fbx', flat: 'xz' },
  cheer: { file: '06_Emote/Victory.fbx', flat: 'xz' },
};

const SIDES = { Left: 'left', Right: 'right' };
const MAP = {
  mixamorigHips: 'hips', mixamorigSpine: 'spine', mixamorigSpine1: 'chest', mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck', mixamorigHead: 'head',
};
for (const [S, s] of Object.entries(SIDES)) {
  Object.assign(MAP, {
    [`mixamorig${S}Shoulder`]: `${s}Shoulder`, [`mixamorig${S}Arm`]: `${s}UpperArm`,
    [`mixamorig${S}ForeArm`]: `${s}LowerArm`, [`mixamorig${S}Hand`]: `${s}Hand`,
    [`mixamorig${S}UpLeg`]: `${s}UpperLeg`, [`mixamorig${S}Leg`]: `${s}LowerLeg`,
    [`mixamorig${S}Foot`]: `${s}Foot`, [`mixamorig${S}ToeBase`]: `${s}Toes`,
    [`mixamorig${S}HandThumb1`]: `${s}ThumbMetacarpal`, [`mixamorig${S}HandThumb2`]: `${s}ThumbProximal`,
    [`mixamorig${S}HandThumb3`]: `${s}ThumbDistal`,
  });
  for (const [f, v] of [['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Pinky', 'Little']]) {
    MAP[`mixamorig${S}Hand${f}1`] = `${s}${v}Proximal`;
    MAP[`mixamorig${S}Hand${f}2`] = `${s}${v}Intermediate`;
    MAP[`mixamorig${S}Hand${f}3`] = `${s}${v}Distal`;
  }
}
const isFinger = (b) => /Thumb|Index|Middle|Ring|Little/.test(b);

const round = (v, d) => Math.round(v * d) / d;

const out = {};
for (const [name, opt] of Object.entries(CLIPS)) {
  const b = fs.readFileSync(path.join(LIB, opt.file));
  const asset = new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  asset.updateMatrixWorld(true);
  let clip = asset.animations[0];
  if (opt.trim) {
    clip = THREE.AnimationUtils.subclip(clip, name, Math.round(opt.trim[0] * 30), Math.round(opt.trim[1] * 30), 30);
  }
  const hipsRestY = asset.getObjectByName('mixamorigHips').position.y;
  const restInv = new THREE.Quaternion();
  const parentRest = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const tracks = [];
  for (const track of clip.tracks) {
    const [rig, prop] = track.name.split('.');
    const bone = MAP[rig];
    if (!bone) continue;
    const node = asset.getObjectByName(rig);
    node.getWorldQuaternion(restInv).invert();
    node.parent.getWorldQuaternion(parentRest);
    let times = Array.from(track.times);
    let values = Array.from(track.values);
    if (prop === 'quaternion') {
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i).premultiply(parentRest).multiply(restInv).normalize();
        q.toArray(values, i);
      }
      if (isFinger(bone)) { // fingers barely matter at game distance: keep one pose
        times = [0];
        values = values.slice(0, 4);
      }
      values = values.map((v) => round(v, 1000));
    } else if (prop === 'position' && bone === 'hips') {
      const x0 = values[0], y0 = values[1], z0 = values[2];
      for (let i = 0; i < values.length; i += 3) {
        if (opt.flat) { values[i] = 0; values[i + 2] = 0; } else { values[i] -= x0; values[i + 2] -= z0; }
        if (opt.flat === 'xyz') values[i + 1] = y0;
        values[i] /= hipsRestY; values[i + 1] /= hipsRestY; values[i + 2] /= hipsRestY;
      }
      values = values.map((v) => round(v, 10000));
    } else {
      continue;
    }
    // Drop tracks that never move.
    const n = prop === 'quaternion' ? 4 : 3;
    let constant = true;
    for (let i = n; i < values.length && constant; i++) if (Math.abs(values[i] - values[i % n]) > 1e-3) constant = false;
    if (constant) { times = [0]; values = values.slice(0, n); }
    tracks.push({ b: bone, p: prop === 'quaternion' ? 'q' : 'p', t: times.map((t) => round(t, 1000)), v: values });
  }
  out[name] = { d: round(clip.duration, 1000), tracks };
  console.log(`${name}: ${clip.duration.toFixed(2)}s, ${tracks.length} tracks`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
