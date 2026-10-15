// Meshes for trains, ramps, barriers, coins and power-up pickups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAIN } from './config.js';
import { curved } from './curve.js';
import * as T from './textures.js';
import { makeMagnet, makeJetpack } from './characters.js';

const A = T.TRAIN_ATLAS;
// canvas pixel rect -> uv rect (flipY textures)
const uvRect = ([x, y, w, h]) => [x / A.W, 1 - (y + h) / A.H, (x + w) / A.W, 1 - y / A.H];

// Remap a BoxGeometry's UVs per face to atlas regions. Face order: +x -x +y -y +z -z
function mapBox(geo, regions) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = uvRect(regions[f]);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
    }
  }
  return geo;
}

function trainCarGeometry() {
  const L = TRAIN.CAR, W = TRAIN.W, H = TRAIN.H, base = 0.45;
  const body = new THREE.BoxGeometry(W, H - base, L);
  // BoxGeometry already lays u out left-to-right on both long sides
  mapBox(body, [A.side, A.side, A.roof, A.dark, A.front, A.front]);
  body.translate(0, base + (H - base) / 2, -L / 2);
  const under = new THREE.BoxGeometry(W * 0.82, base, L - 1.2);
  mapBox(under, [A.dark, A.dark, A.dark, A.dark, A.dark, A.dark]);
  under.translate(0, base / 2, -L / 2);
  const parts = [body, under];
  for (const z of [-2, -L + 2]) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12);
      wheel.rotateZ(Math.PI / 2);
      const wuv = wheel.attributes.uv;
      const [du0, dv0] = uvRect(A.dark);
      for (let i = 0; i < wuv.count; i++) wuv.setXY(i, du0 + 0.01, dv0 + 0.01);
      wheel.translate(s * W * 0.42, 0.32, z);
      parts.push(wheel);
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function rampGeometry() {
  // wedge: rises from 0 (z = 0, near end) to TRAIN.H at z = -RAMP
  const L = TRAIN.RAMP, W = TRAIN.W * 0.98, H = TRAIN.H;
  const hw = W / 2;
  const p = [];
  const uv = [];
  const quad = (a, b, c, d, ua, ub, uc, ud) => { p.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); };
  const tri = (a, b, c) => { p.push(...a, ...b, ...c); uv.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5); };
  const r = L / 2.4;
  // slope
  quad([-hw, 0, 0], [hw, 0, 0], [hw, H, -L], [-hw, H, -L], [0, 0], [1, 0], [1, r], [0, r]);
  // sides
  tri([hw, 0, 0], [hw, 0, -L], [hw, H, -L]);
  tri([-hw, 0, 0], [-hw, H, -L], [-hw, 0, -L]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function barrierGeometry(kind) {
  // returns [boardGeo, frameGeo]
  const boards = [], frame = [];
  if (kind === 'hurdle') {
    const b = new THREE.BoxGeometry(2.0, 0.5, 0.12);
    b.translate(0, 0.72, 0);
    boards.push(b);
    for (const s of [-1, 1]) {
      frame.push(new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(s * 0.96, 0.5, 0));
      frame.push(new THREE.BoxGeometry(0.16, 0.08, 0.7).translate(s * 0.96, 0.04, 0));
    }
  } else {
    const b = new THREE.BoxGeometry(2.1, 1.0, 0.14);
    b.translate(0, 1.78, 0);
    boards.push(b);
    for (const s of [-1, 1]) {
      frame.push(new THREE.BoxGeometry(0.16, 2.4, 0.16).translate(s * 1.1, 1.2, 0));
      frame.push(new THREE.BoxGeometry(0.2, 0.12, 0.8).translate(s * 1.1, 0.06, 0));
    }
  }
  return [mergeGeometries(boards), mergeGeometries(frame)];
}

export class Props {
  constructor() {
    const lam = (o) => curved(new THREE.MeshLambertMaterial(o));
    this.carGeo = trainCarGeometry();
    this.trainMats = T.TRAIN_VARIANTS.map((v, i) => lam({ map: T.makeTrainTexture(v, i * 17 + 3) }));
    this.rampGeo = rampGeometry();
    this.rampMat = lam({ map: T.makeRampTexture() });
    const [hb, hf] = barrierGeometry('hurdle');
    const [ob, of] = barrierGeometry('overhead');
    this.barrier = {
      hurdle: { board: hb, frame: hf, mat: lam({ map: T.makeStripeTexture('#ffffff', '#e8343f', 7) }) },
      overhead: { board: ob, frame: of, mat: lam({ map: T.makeStripeTexture('#ffd23f', '#1b1530', 6) }) },
    };
    this.frameMat = lam({ color: 0x5d6575 });
    this.glowTex = T.makeGlowTexture();
    this.headlightMat = curved(new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0xfff1a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.beamMat = curved(new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.warnMat = curved(new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    // shared small geometries
    this.couplingGeo = new THREE.BoxGeometry(1.2, 1.6, TRAIN.GAP + 0.1);
    this.headGeo = new THREE.PlaneGeometry(1.1, 1.1);
    this.beamGeo = new THREE.PlaneGeometry(2.0, 14);
    this.warnGeo = new THREE.BoxGeometry(0.5, 0.12, 0.1);
    this.lightGeo = new THREE.SphereGeometry(0.1, 8, 6);
    // coins
    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.09, 24);
    coinGeo.rotateX(Math.PI / 2);
    this.coinGeo = coinGeo;
    this.coinMat = lam({ map: T.makeCoinTexture(), emissive: 0x664400 });
    this.powerTex = {
      x2: T.makeLabelTexture('×2', '#ffffff', '#9b4dff'),
    };
  }

  train(variant, cars, moving) {
    const g = new THREE.Group();
    for (let i = 0; i < cars; i++) {
      const car = new THREE.Mesh(this.carGeo, this.trainMats[variant % this.trainMats.length]);
      car.position.z = -i * (TRAIN.CAR + TRAIN.GAP);
      g.add(car);
      if (i > 0) { // coupling
        const c = new THREE.Mesh(this.couplingGeo, this.frameMat);
        c.position.set(0, 1.4, -i * (TRAIN.CAR + TRAIN.GAP) + TRAIN.GAP / 2 + 0.05);
        g.add(c);
      }
    }
    if (moving) {
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(this.headGeo, this.headlightMat);
        h.position.set(s * 0.64, 0.87, 0.06);
        g.add(h);
      }
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(0, 0.03, 7);
      g.add(beam);
      const warn = new THREE.Mesh(this.warnGeo, this.warnMat);
      warn.position.set(0, TRAIN.H - 0.25, 0.04);
      g.add(warn);
      g.userData.warn = warn;
    }
    return g;
  }

  ramp() {
    return new THREE.Mesh(this.rampGeo, this.rampMat);
  }

  barrierMesh(kind) {
    const b = this.barrier[kind];
    const g = new THREE.Group();
    g.add(new THREE.Mesh(b.board, b.mat), new THREE.Mesh(b.frame, this.frameMat));
    if (kind === 'overhead') {
      for (const s of [-1, 1]) {
        const l = new THREE.Mesh(this.lightGeo, this.warnMat);
        l.position.set(s * 1.1, 2.48, 0);
        g.add(l);
      }
    }
    return g;
  }

  coins(capacity) {
    const m = new THREE.InstancedMesh(this.coinGeo, this.coinMat, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }

  powerup(type) {
    const g = new THREE.Group();
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), curved(new THREE.MeshBasicMaterial({
      map: this.glowTex, color: { magnet: 0xff4d5e, jetpack: 0xffb02e, sneakers: 0x3ee07a, x2: 0xb56bff }[type],
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    g.add(halo);
    const spin = new THREE.Group();
    g.add(spin);
    const toon = (c, o = {}) => curved(new THREE.MeshToonMaterial({ color: c, ...o }));
    if (type === 'magnet') {
      const m = makeMagnet(2.6);
      m.rotation.z = Math.PI;
      m.position.y = 0.1;
      spin.add(m);
    } else if (type === 'jetpack') {
      const j = makeJetpack();
      j.scale.setScalar(1.6);
      spin.add(j);
    } else if (type === 'sneakers') {
      const shoe = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.6), toon(0xffffff));
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.42), toon(0x3ee07a));
      upper.position.set(0, 0.14, 0.08);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), toon(0x3ee07a));
      toe.scale.set(1, 0.7, 1);
      toe.position.set(0, 0.08, -0.18);
      const spring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 12), toon(0xdddddd));
      spring.rotation.x = Math.PI / 2;
      spring.position.y = -0.1;
      const spring2 = spring.clone(); spring2.position.y = -0.18;
      shoe.add(sole, upper, toe, spring, spring2);
      shoe.position.y = 0.05;
      spin.add(shoe);
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24), [
        toon(0xffffff), toon(0xffffff, { map: this.powerTex.x2 }), toon(0xffffff, { map: this.powerTex.x2 }),
      ]);
      disc.rotation.x = Math.PI / 2;
      spin.add(disc);
    }
    g.userData.spin = spin;
    g.userData.halo = halo;
    return g;
  }
}
