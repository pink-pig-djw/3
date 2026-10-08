import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { G } from './shaderlib.js';
import { patchWeathering } from './props.js';

const TINTS = {
  stone: new Color(1, 1, 1),
  wood: new Color(0.92, 0.9, 0.86),
  timber: new Color(0.46, 0.34, 0.25),
  boards: new Color(0.72, 0.62, 0.52),
  plaster: new Color(1, 1, 1),
  kawara: new Color(1, 1, 1),
};

/** Materials for the meshes from blender/architecture.py, by material name. */
function makeMaterials(tex, hf, moss) {
  const set = (name, t, opts = {}) => {
    const m = new MeshStandardMaterial({
      map: t.albedo,
      normalMap: t.normal,
      normalScale: new Vector2(1, -1).multiplyScalar(opts.normal ?? 1),
      roughnessMap: t.orm,
      aoMap: t.orm,
      aoMapIntensity: 0.8,
      roughness: opts.rough ?? 1,
      metalness: 0,
      vertexColors: true,
      color: TINTS[name] ?? new Color(1, 1, 1),
      side: opts.side ?? DoubleSide,
    });
    m.name = name;
    if (opts.weather) patchWeathering(m, { hf, moss, mossAmount: opts.moss ?? 0.4, streaks: name === 'stone', cacheKey: `arch-${name}` });
    return m;
  };
  const paper = new MeshStandardMaterial({
    color: new Color(0.74, 0.71, 0.64),
    roughness: 0.92,
    metalness: 0,
    emissive: new Color(1.0, 0.62, 0.32),
    emissiveIntensity: 0,
    side: DoubleSide,
  });
  paper.name = 'paper';
  const dark = new MeshStandardMaterial({ color: 0x0b0a09, roughness: 1, metalness: 0, side: DoubleSide });
  dark.name = 'dark';
  return {
    stone: set('stone', tex.rock, { weather: true, moss: 0.65, normal: 1.2 }),
    wood: set('wood', tex.wood, { weather: true, moss: 0.25 }),
    timber: set('timber', tex.wood, { weather: false }),
    boards: set('boards', tex.wood, { weather: false }),
    plaster: set('plaster', tex.plaster, { weather: false }),
    kawara: set('kawara', tex.kawara, { weather: true, moss: 0.3, rough: 0.9 }),
    paper,
    dark,
  };
}

function applyMaterials(root, mats) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || '').split('.')[0];
    if (mats[name]) o.material = mats[name];
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

function meshesOf(obj) {
  const out = [];
  obj.traverse((o) => o.isMesh && out.push(o));
  return out;
}

export function createArchitecture(gltf, tex, layout, hf, moss) {
  const mats = makeMaterials(tex, hf, moss);
  const byName = {};
  gltf.scene.traverse((o) => {
    if (o.name) byName[o.name] ??= o;
  });
  const objects = [];
  for (const name of ['culvert', 'house', 'deck', 'stairs']) {
    const o = byName[name];
    if (!o) continue;
    applyMaterials(o, mats);
    o.updateMatrixWorld(true);
    objects.push(o);
  }

  // ---- fences: posts every ~2 m along the exported polylines, two rails between
  const postParts = meshesOf(byName.fence_post);
  const railParts = meshesOf(byName.fence_rail);
  const postM = [];
  const railM = [];
  const colliders = [];
  const q = new Quaternion();
  const m4 = new Matrix4();
  const X = new Vector3(1, 0, 0);
  for (const line of layout.fences) {
    const pts = [];
    let acc = 0;
    let last = null;
    for (const [x, z] of line) {
      if (last) acc += Math.hypot(x - last[0], z - last[1]);
      if (!last || acc >= 2.0) {
        pts.push(new Vector3(x, hf.height(x, z), z));
        acc = 0;
      }
      last = [x, z];
    }
    pts.forEach((p, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), i * 0.7);
      m4.compose(p, q, new Vector3(1, 1 + ((i * 37) % 7) * 0.01, 1));
      postM.push(m4.clone());
      if (i === 0) return;
      const a = pts[i - 1];
      for (const h of [0.42, 0.88]) {
        const p0 = a.clone().add(new Vector3(0, h, 0));
        const p1 = p.clone().add(new Vector3(0, h + ((i * 13) % 5) * 0.008, 0));
        const d = p1.clone().sub(p0);
        const len = d.length();
        q.setFromUnitVectors(X, d.clone().normalize());
        m4.compose(p0, q, new Vector3(len, 1, 1));
        railM.push(m4.clone());
      }
      colliders.push({ seg: [a.x, a.z, p.x, p.z], r: 0.12 });
    });
  }
  const inst = (parts, list) =>
    parts.map((part) => {
      const name = (part.material?.name || '').split('.')[0];
      const im = new InstancedMesh(part.geometry, mats[name] ?? mats.wood, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    });
  objects.push(...inst(postParts, postM), ...inst(railParts, railM));

  // ---- lanterns + a small pool of real point lights near the viewer
  const lanternM = layout.lanterns.map((l) => {
    const p = new Vector3(l.p[0], hf.height(l.p[0], l.p[2]), l.p[2]);
    q.setFromAxisAngle(new Vector3(0, 1, 0), (l.p[0] * 13.1) % 6.28);
    m4.compose(p, q, new Vector3(1, 1, 1));
    colliders.push({ x: p.x, z: p.z, r: 0.12, top: p.y + 1.45 });
    return m4.clone();
  });
  objects.push(...inst(meshesOf(byName.lantern), lanternM));
  const lanternPos = layout.lanterns.map((l) => new Vector3(l.p[0], hf.height(l.p[0], l.p[2]) + 1.27, l.p[2]));

  const lights = [];
  for (let i = 0; i < 4; i++) {
    const L = new PointLight(0xffb070, 0, 9, 2);
    L.castShadow = false;
    lights.push(L);
    objects.push(L);
  }
  // warm light inside the house (through the shoji)
  const H = layout.house;
  const a = (H.yaw_deg * Math.PI) / 180;
  const inside = new Vector3(H.x + Math.sin(a) * 1.0, H.floor + 1.5, H.z + Math.cos(a) * 1.0);
  const houseLight = new PointLight(0xffa860, 0, 14, 2);
  houseLight.position.copy(inside);
  objects.push(houseLight);

  // ---- colliders for the player
  const hx = H.x;
  const hz = H.z;
  colliders.push({ rect: { x: hx, z: hz, yaw: a, hw: H.w / 2 + 0.05, hd: H.d / 2 + 0.05 }, top: H.floor + 3 });
  const C = layout.culvert;
  colliders.push({ rect: { x: C.x, z: C.z - C.thickness / 2, yaw: 0, hw: C.half_width + 0.1, hd: C.thickness / 2 + 0.1 }, top: C.top + 0.6, wallTop: C.top + 0.18 });
  // walkable platforms: house floor + engawa, deck
  const platforms = [
    { x: hx, z: hz, yaw: a, x0: -H.w / 2, x1: H.w / 2 + 0.9, z0: -H.d / 2, z1: H.d / 2 + 0.95, y: H.floor },
  ];
  const D = layout.deck;
  const da = (D.yaw_deg * Math.PI) / 180;
  platforms.push({ x: D.x, z: D.z, yaw: da, x0: -D.w / 2, x1: D.w / 2, z0: -D.d / 2, z1: D.d / 2, y: D.level + D.height });

  const tmp = new Vector3();
  return {
    objects,
    colliders,
    platforms,
    benchSeat: (() => {
      // world position of the bench on the deck (for the rest interaction)
      const lx = 0;
      const lz = -D.d / 2 + 0.35;
      return new Vector3(D.x + Math.cos(da) * lx + Math.sin(da) * lz, D.level + D.height + 0.45, D.z - Math.sin(da) * lx + Math.cos(da) * lz);
    })(),
    housePoint: inside.clone(),
    update(dt, camera) {
      const glow = G.uLanterns.value;
      mats.paper.emissiveIntensity = glow * 2.6;
      houseLight.intensity = glow * 9;
      // nearest lanterns get real lights
      const order = lanternPos
        .map((p, i) => [p.distanceToSquared(camera.position), i])
        .sort((u, v) => u[0] - v[0]);
      lights.forEach((L, k) => {
        const e = order[k];
        if (!e) {
          L.intensity = 0;
          return;
        }
        L.position.copy(lanternPos[e[1]]);
        L.intensity = glow * 2.4;
      });
      tmp.set(0, 0, 0);
    },
  };
}
