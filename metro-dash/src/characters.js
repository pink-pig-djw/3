// VRM characters: loading, retargeted Mixamo clips, expressions and props.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import animData from '../assets/anims.json';
import { curveObject, curved } from './curve.js';

export async function loadVRM(bytes) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  const vrm = gltf.userData.vrm;
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  curveObject(vrm.scene);
  return vrm;
}

function buildClips(vrm) {
  const h = vrm.humanoid;
  vrm.scene.updateMatrixWorld(true);
  const hipsH = h.getNormalizedBoneNode('hips').getWorldPosition(new THREE.Vector3()).y -
    vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const clips = {};
  for (const [name, c] of Object.entries(animData)) {
    const tracks = [];
    for (const t of c.tracks) {
      const node = h.getNormalizedBoneNode(t.b);
      if (!node) continue;
      if (t.p === 'q') tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, t.t, t.v));
      else tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, t.t, t.v.map((v) => v * hipsH)));
    }
    clips[name] = new THREE.AnimationClip(name, c.d, tracks);
  }
  return clips;
}

const FACES = ['happy', 'angry', 'sad', 'surprised'];

export class Character {
  constructor(vrm) {
    this.vrm = vrm;
    this.root = new THREE.Group(); // world placement
    this.body = new THREE.Group(); // lean / yaw / bob
    this.root.add(this.body);
    vrm.scene.rotation.y = Math.PI; // VRM 1.0 faces +Z, the game runs toward -Z
    this.body.add(vrm.scene);
    this.clips = buildClips(vrm);
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.actions = {};
    this.current = null;
    this.currentName = '';
    this.blinkTimer = 1 + Math.random() * 2;
    this.blinkPhase = 0;
    this.face = { happy: 0, angry: 0, sad: 0, surprised: 0 };
    this.faceTarget = { ...this.face };
    // Simulate hair/skirt springs in the character's own space so that running
    // at 30 m/s does not drag everything straight back.
    if (vrm.springBoneManager) {
      for (const j of vrm.springBoneManager.joints) j.center = this.root;
    }
  }

  bone(name) {
    return this.vrm.humanoid.getRawBoneNode(name);
  }

  action(name) {
    if (!this.actions[name]) this.actions[name] = this.mixer.clipAction(this.clips[name]);
    return this.actions[name];
  }

  play(name, { fade = 0.16, loop = true, speed = 1, restart = false, clamp = false } = {}) {
    const a = this.action(name);
    a.timeScale = speed;
    if (this.current === a && !restart) return a;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = clamp;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.current && this.current !== a && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current && this.current !== a) this.current.stop();
    this.current = a;
    this.currentName = name;
    return a;
  }

  setSpeed(speed) {
    if (this.current) this.current.timeScale = speed;
  }

  setFace(name, amount = 1) {
    for (const f of FACES) this.faceTarget[f] = f === name ? amount : 0;
  }

  resetSprings() {
    this.root.updateMatrixWorld(true);
    this.vrm.springBoneManager?.reset();
  }

  update(dt) {
    this.mixer.update(dt);
    const em = this.vrm.expressionManager;
    if (em) {
      for (const f of FACES) {
        this.face[f] += (this.faceTarget[f] - this.face[f]) * Math.min(1, dt * 10);
        em.setValue(f, this.face[f]);
      }
      // blink (skipped while the eyes are already squinting from "happy")
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) { this.blinkPhase = 0.16; this.blinkTimer = 2 + Math.random() * 3; }
      let blink = 0;
      if (this.blinkPhase > 0) {
        this.blinkPhase -= dt;
        blink = Math.sin((1 - Math.max(0, this.blinkPhase) / 0.16) * Math.PI);
      }
      em.setValue('blink', blink * (1 - this.face.happy));
    }
    this.vrm.update(dt);
  }
}

// ---------- props ----------
function mat(color, opts = {}) {
  return curved(new THREE.MeshToonMaterial({ color, ...opts }));
}

// Attach `obj` to a raw bone using model-space offsets (metres, +Z = facing
// direction of the model). VRoid raw bones carry no rest rotation, so the
// object keeps the model's orientation.
export function attachToBone(character, boneName, obj, offset = [0, 0, 0]) {
  const b = character.bone(boneName);
  if (!b) return null;
  obj.position.set(...offset);
  b.add(obj);
  curveObject(obj);
  return obj;
}

export function makeGuardCap() {
  const g = new THREE.Group();
  const navy = mat(0x1b2a55);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.118, 0.085, 24), navy);
  crown.position.y = 0.04;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.128, 0.03, 24), navy);
  top.position.y = 0.095;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.121, 0.121, 0.028, 24), mat(0x111111));
  band.position.y = 0.012;
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), mat(0x0e0e12));
  visor.position.set(0, 0.0, 0.06);
  visor.rotation.x = 0.18;
  visor.scale.set(1, 1, 0.85);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.01), mat(0xffc531, { emissive: 0x553300 }));
  badge.position.set(0, 0.05, 0.125);
  g.add(crown, top, band, visor, badge);
  return g;
}

export function makeHoverboard(texture) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const L = 0.62, W = 0.2;
  shape.moveTo(-L + W, -W);
  shape.lineTo(L - W, -W);
  shape.absarc(L - W, 0, W, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-L + W, W);
  shape.absarc(-L + W, 0, W, Math.PI / 2, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 2);
  // planar UVs on the deck
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getZ(i) + L) / (2 * L), (pos.getX(i) + W) / (2 * W));
  const deck = new THREE.Mesh(geo, curved(new THREE.MeshToonMaterial({ map: texture })));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.3), curved(new THREE.MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.04;
  g.add(deck, glow);
  g.userData.glow = glow;
  return g;
}

export function makeJetpack() {
  const g = new THREE.Group();
  const body = mat(0xff8a1f);
  const metal = mat(0xd0d6e0);
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 14), body);
    tank.position.set(s * 0.08, 0, 0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), body);
    cap.position.set(s * 0.08, 0.18, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.08, 12), metal);
    nozzle.position.set(s * 0.08, -0.22, 0);
    g.add(tank, cap, nozzle);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.04), metal);
  strap.position.set(0, 0.05, 0.06);
  g.add(strap);
  return g;
}

export function makeMagnet(scale = 1) {
  const g = new THREE.Group();
  const red = mat(0xff3b4e);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.1 * scale, 0.035 * scale, 8, 18, Math.PI), red);
  arc.rotation.z = Math.PI;
  const tipMat = mat(0xe8edf5);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * scale, 0.035 * scale, 0.08 * scale, 10), red);
    leg.position.set(s * 0.1 * scale, 0.04 * scale, 0);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.036 * scale, 0.036 * scale, 0.05 * scale, 10), tipMat);
    tip.position.set(s * 0.1 * scale, 0.105 * scale, 0);
    g.add(leg, tip);
  }
  g.add(arc);
  return g;
}

export function makeSneakerGlow() {
  return new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.018, 6, 16),
    curved(new THREE.MeshBasicMaterial({ color: 0x3ee07a, transparent: true, opacity: 0.85 })),
  );
}
