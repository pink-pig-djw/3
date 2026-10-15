// Scenery: recycled 40 m chunks, one family per zone, plus zone gates.
//   city    open / tunnel / station
//   sunset  harbour / truss bridge
//   neon    neon street / neon-ring arcade
//   cyber   grid / data tunnel
//   galaxy  space bridge / warp tunnel
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W, laneX } from './config.js';
import { curved } from './curve.js';
import { THEMES, zoneOfZ } from './themes.js';
import * as T from './textures.js';
import * as S from './scenetex.js';

const CHUNK = 40;
const WALL_X = 6.6;
const DAY_COLORS = ['#f2a65a', '#7fb7be', '#d3c0d2', '#f6e27f', '#e7a3a3', '#9fd8cb', '#b7c7ff', '#ffc9a8', '#c5e17a'];
const NIGHT_COLORS = ['#3a3060', '#2c3a5c', '#4a2c52', '#23324a', '#3d2a40', '#2a2a48'];
const CONTAINER_COLORS = ['#d9472b', '#2f6fd6', '#1fa97c', '#f2a23a', '#7a4fd6', '#e2c23f', '#3aa0b8'];
const GATE_COLORS = ['#ff7a1a', '#ffb35c', '#ff3dbb', '#36e6ff', '#b46bff'];
const STATIONS = [['橙子站', 'ORANGE ST.'], ['晚霞路', 'SUNSET RD.'], ['涂鸦公园', 'GRAFFITI PARK'], ['终点站', 'LAST STOP']];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
function setUV(geo, fn) {
  const uv = geo.attributes.uv, pos = geo.attributes.position, nrm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const r = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), uv.getX(i), uv.getY(i));
    uv.setXY(i, r[0], r[1]);
  }
  return geo;
}
function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
// merge geometries that may or may not be indexed / have uvs
function merge(list) {
  const norm = list.map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    return x;
  });
  const withColor = norm.some((g) => g.attributes.color);
  if (withColor) for (const g of norm) if (!g.attributes.color) colorize(g, '#ffffff');
  return mergeGeometries(norm);
}
function mesh(g, list, mat) {
  if (!list.length) return null;
  const m = new THREE.Mesh(merge(list), mat);
  g.add(m);
  return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSignTexture(name, sub) {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#1d3f8f'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#ffffff'; g.fillRect(8, 8, 496, 4); g.fillRect(8, 116, 496, 4);
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(64, 64, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = '900 44px "Bungee", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('M', 64, 66);
    g.textAlign = 'left';
    g.font = '900 52px "ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(name, 122, 52);
    g.font = 'bold 22px "Bungee", "Arial Black", sans-serif';
    g.fillStyle = '#cfe0ff';
    g.fillText(sub, 124, 98);
  });
}

function makeBillboardTextures() {
  const ads = [
    ['METRO DASH', '七海 · 今夜开跑', '#ff3dbb'],
    ['NIGHT RUN', '夜跑俱乐部招新中', '#2ef2ff'],
    ['七海 LIVE', '霓虹广场 21:00', '#ffe14d'],
  ];
  return ads.map(([a, b, color]) => canvasTex(512, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 512, 256);
    gr.addColorStop(0, '#1b0b36'); gr.addColorStop(1, '#0b1640');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    g.shadowColor = color; g.shadowBlur = 20;
    g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(12, 12, 488, 232);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = '900 64px "Bungee", "Arial Black", sans-serif';
    g.fillText(a, 256, 104);
    g.fillStyle = color; g.font = '900 40px "ZCOOL QingKe HuangYou", "PingFang SC", sans-serif';
    g.fillText(b, 256, 184);
  }));
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.makeMaterials();
    this.pools = new Map();
    this.built = new Set();
    this.active = [];
    this.gates = [];
    this.gateMeshes = [];
    this.nextZ = 0;
    this.queue = [];
  }

  makeMaterials() {
    const lam = (o) => curved(new THREE.MeshLambertMaterial(o));
    const basic = (o) => curved(new THREE.MeshBasicMaterial(o));
    const add = (o) => curved(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o }));
    const concTex = T.makeConcreteTexture();
    const neonWall = S.makeNeonWallTextures();
    const nightWin = S.makeNightWindowTextures();
    const deck = S.makeDeckTextures();
    this.seaTex = S.makeSeaTexture();
    this.warpTex = S.makeWarpTexture();
    this.warpTex.repeat.set(5, 2);
    const glow = T.makeGlowTexture();
    this.mats = {
      track: lam({ map: T.makeTrackTexture() }),
      rail: lam({ color: 0xd9dee6, emissive: 0x30343c }),
      railGlow: basic({ color: 0x5ff6ff }),
      conc: lam({ map: concTex }),
      wall: lam({ map: T.makeWallTexture() }),
      build: lam({ map: T.makeBuildingTexture(), vertexColors: true }),
      steel: lam({ color: 0x5d6575 }),
      tunnel: lam({ color: 0x77706b, side: THREE.DoubleSide }),
      brick: lam({ color: 0xc8643c }),
      lamp: basic({ color: 0xfff3c4 }),
      roof: lam({ color: 0xe8ecf2 }),
      // harbour
      metal: lam({ map: S.makeCorrugatedTexture(), vertexColors: true }),
      paint: lam({ vertexColors: true }),
      sea: lam({ map: this.seaTex, emissive: 0xff9a5a, emissiveMap: this.seaTex, emissiveIntensity: 0.55 }),
      truss: lam({ color: 0xd9472b }),
      warmGlow: add({ map: glow, color: 0xffc070 }),
      // neon
      neonWall: lam({ map: neonWall.map, emissiveMap: neonWall.glow, emissive: 0xffffff, emissiveIntensity: 1.1 }),
      nightBuild: lam({ map: nightWin.map, emissiveMap: nightWin.glow, emissive: 0xffffff, emissiveIntensity: 1, vertexColors: true }),
      signs: basic({ map: S.makeSignAtlas(), transparent: true }),
      signsFlicker: basic({ map: null, transparent: true }),
      pink: basic({ color: 0xff3dbb }),
      cyan: basic({ color: 0x2ef2ff }),
      yellow: basic({ color: 0xffe14d }),
      lantern: basic({ color: 0xff4a4a }),
      pinkGlow: add({ map: glow, color: 0xff3dbb }),
      cyanGlow: add({ map: glow, color: 0x2ef2ff }),
      darkSteel: lam({ color: 0x2c2838 }),
      // cyber
      grid: basic({ map: S.makeGridTexture() }),
      deck: lam({ map: deck.map, emissiveMap: deck.glow, emissive: 0xffffff, emissiveIntensity: 1 }),
      edgeCyan: basic({ map: S.makeEdgeTexture('#2ef2ff') }),
      edgePink: basic({ map: S.makeEdgeTexture('#ff3dbb') }),
      pyramid: basic({ color: 0x2a0b45 }),
      laserPink: add({ color: 0xff3dbb, opacity: 0.85 }),
      laserCyan: add({ color: 0x2ef2ff, opacity: 0.85 }),
      tunnelA: basic({ color: 0xff3dbb }),
      tunnelB: basic({ color: 0x2ef2ff }),
      // galaxy
      bridge: lam({ color: 0x2a2848, emissive: 0x120a30 }),
      rock: lam({ color: 0x6a5f8a, flatShading: true }),
      crystalA: basic({ color: 0x5ff6ff }),
      crystalB: basic({ color: 0xff6ae0 }),
      crystalC: basic({ color: 0xffd36b }),
      rainbow: basic({ vertexColors: true }),
      warp: curved(new THREE.MeshBasicMaterial({ map: this.warpTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide })),
    };
    this.mats.signsFlicker.map = this.mats.signs.map;
    this.billboards = makeBillboardTextures().map((t) => basic({ map: t }));
  }

  // ---------------------------------------------------------------- pools
  static SPECS = [
    { open: 8, specials: [['tunnel', 3, 2], ['station', 2, 1]] },
    { open: 7, specials: [['bridge', 3, 2]] },
    { open: 7, specials: [['arcade', 3, 2]] },
    { open: 7, specials: [['datatunnel', 3, 2]] },
    { open: 7, specials: [['warp', 3, 2]] },
  ];

  buildTheme(i) {
    if (this.built.has(i)) return;
    this.built.add(i);
    const spec = World.SPECS[i];
    const add = (type, n) => {
      const list = [];
      for (let k = 0; k < n; k++) {
        const g = this.makeChunk(i, type, k);
        g.visible = false;
        this.scene.add(g);
        list.push(g);
      }
      this.pools.set(`${i}:${type}`, list);
    };
    add('open', spec.open);
    for (const [type, n] of spec.specials) add(type, n);
    const gate = this.makeGate(i);
    gate.visible = false;
    this.scene.add(gate);
    this.gateMeshes[i] = gate;
  }

  buildAll() { for (let i = 0; i < THEMES.length; i++) this.buildTheme(i); }

  // make every pooled object visible for one compile pass
  setAllVisible(v) {
    for (const list of this.pools.values()) for (const g of list) g.visible = v;
    for (const g of this.gateMeshes) if (g) g.visible = v;
  }

  makeChunk(theme, type, k) {
    const g = new THREE.Group();
    g.userData = { theme, type, anims: [] };
    const fn = {
      'open:0': this.cityOpen, 'tunnel:0': this.cityTunnel, 'station:0': this.cityStation,
      'open:1': this.harbour, 'bridge:1': this.trussBridge,
      'open:2': this.neonStreet, 'arcade:2': this.neonArcade,
      'open:3': this.cyberGrid, 'datatunnel:3': this.dataTunnel,
      'open:4': this.spaceBridge, 'warp:4': this.warpTunnel,
    }[`${type}:${theme}`];
    fn.call(this, g, k);
    return g;
  }

  // ---------------------------------------------------------------- shared pieces
  trackBed(g, mat) {
    const bed = new THREE.PlaneGeometry(LANE_W * 3, CHUNK).rotateX(-Math.PI / 2).translate(0, 0, -CHUNK / 2);
    setUV(bed, (x, y, z) => [(x + LANE_W * 1.5) / LANE_W, -z / LANE_W]);
    g.add(new THREE.Mesh(bed, mat));
  }

  rails(g, mat) {
    const rails = [];
    for (let l = 0; l < 3; l++) for (const s of [-1, 1]) rails.push(box(0.1, 0.16, CHUNK, laneX(l) + s * 0.72, 0.08, -CHUNK / 2));
    mesh(g, rails, mat);
  }

  shoulders(g, mat, sides = [-1, 1], outer = WALL_X) {
    const sh = [];
    for (const s of sides) {
      const w = outer - LANE_W * 1.5;
      const p = new THREE.PlaneGeometry(w, CHUNK).rotateX(-Math.PI / 2).translate(s * (LANE_W * 1.5 + w / 2), 0.01, -CHUNK / 2);
      setUV(p, (x, y, z) => [s > 0 ? (x - LANE_W * 1.5) / 3.2 : (-x - LANE_W * 1.5) / 3.2, -z / 3]);
      sh.push(p);
    }
    mesh(g, sh, mat);
  }

  walls(g, mat, H = 3.4) {
    const walls = [];
    const seg = CHUNK / 3;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const row = Math.floor(Math.random() * 4);
        const p = new THREE.PlaneGeometry(seg, H).rotateY(-s * Math.PI / 2).translate(s * WALL_X, H / 2, -seg * (k + 0.5));
        setUV(p, (x, y, z, nx, ny, nz, u, v) => [u, (3 - row) / 4 + v / 4]);
        walls.push(p);
      }
    }
    mesh(g, walls, mat);
    const caps = [];
    for (const s of [-1, 1]) {
      caps.push(box(0.5, 0.25, CHUNK, s * (WALL_X + 0.2), H + 0.12, -CHUNK / 2));
      caps.push(box(0.4, H, CHUNK, s * (WALL_X + 0.25), H / 2, -CHUNK / 2));
    }
    return caps;
  }

  catenary(list) {
    for (const z of [-8, -28]) {
      for (const s of [-1, 1]) list.push(box(0.22, 6.6, 0.22, s * 5.6, 3.3, z));
      list.push(box(11.4, 0.22, 0.22, 0, 6.5, z));
      for (let l = 0; l < 3; l++) list.push(box(0.05, 0.6, 0.05, laneX(l), 6.1, z));
    }
    for (let l = 0; l < 3; l++) list.push(box(0.04, 0.04, CHUNK, laneX(l), 5.8, -CHUNK / 2));
    return list;
  }

  buildings(colors, minH, maxH, uvScale = 6) {
    const blds = [];
    for (const s of [-1, 1]) {
      let z = -rand(0, 4);
      while (z > -CHUNK) {
        const w = rand(7, 13), d = rand(6, 10), h = rand(minH, maxH);
        const x = s * (WALL_X + 3 + d / 2 + rand(0, 6));
        const b = box(d, h, w, x, h / 2, z - w / 2);
        const zz = z;
        setUV(b, (px, py, pz, nx, ny) => {
          if (Math.abs(ny) > 0.5) return [0.01, 0.99];
          if (Math.abs(nx) > 0.5) return [(pz - zz) / uvScale, py / uvScale];
          return [px / uvScale, py / uvScale];
        });
        blds.push({ geo: colorize(b, pick(colors)), x, z: z - w / 2, w, d, h, s });
        z -= w + rand(0.5, 3);
      }
    }
    return blds;
  }

  glowPlane(size) {
    return new THREE.PlaneGeometry(size, size);
  }

  // ---------------------------------------------------------------- city
  cityOpen(g) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    this.shoulders(g, m.conc);
    const steel = this.catenary(this.walls(g, m.wall));
    mesh(g, steel, m.steel);
    const blds = this.buildings(DAY_COLORS, 7, 24).map((b) => b.geo);
    for (const b of [...blds]) {
      if (Math.random() < 0.5) {
        b.computeBoundingBox();
        const bb = b.boundingBox;
        const r = box((bb.max.x - bb.min.x) * 0.4, rand(1, 2.5), (bb.max.z - bb.min.z) * 0.3, (bb.max.x + bb.min.x) / 2, bb.max.y + 0.8, (bb.max.z + bb.min.z) / 2);
        setUV(r, () => [0.01, 0.99]);
        blds.push(colorize(r, '#9aa3b5'));
      }
    }
    mesh(g, blds, m.build);
  }

  cityTunnel(g) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    this.shoulders(g, m.conc);
    const R = 7.2;
    const shell = new THREE.CylinderGeometry(R, R, CHUNK, 24, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0, -CHUNK / 2);
    g.add(new THREE.Mesh(shell, m.tunnel));
    const arches = [];
    for (const z of [0, -CHUNK]) {
      arches.push(new THREE.TorusGeometry(R + 0.4, 0.6, 6, 24, Math.PI).translate(0, 0, z));
      for (const s of [-1, 1]) arches.push(box(1.6, 0.8, 1.2, s * (R + 0.4), 0.4, z));
    }
    mesh(g, arches, m.brick);
    const lamps = [];
    for (let z = -4; z > -CHUNK; z -= 8) for (const s of [-1, 1]) lamps.push(box(0.3, 0.12, 2.4, s * 4.6, 5.2, z));
    mesh(g, lamps, m.lamp);
  }

  cityStation(g, variant) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    const parts = [], roof = [], steel = [];
    const PH = 1.0;
    for (const s of [-1, 1]) {
      const p = box(WALL_X - LANE_W * 1.5 + 2, PH, CHUNK, s * (LANE_W * 1.5 + (WALL_X - LANE_W * 1.5 + 2) / 2), PH / 2, -CHUNK / 2);
      setUV(p, (x, y, z, nx, ny) => [Math.abs(ny) > 0.5 ? (s > 0 ? (x - LANE_W * 1.5) / 3.2 : (-x - LANE_W * 1.5) / 3.2) : 0.9, -z / 3]);
      parts.push(p);
      for (let z = -4; z > -CHUNK; z -= 8) steel.push(box(0.35, 4.2, 0.35, s * 6.0, PH + 2.1, z));
      roof.push(box(4.6, 0.3, CHUNK, s * 6.6, PH + 4.3, -CHUNK / 2));
      for (const z of [-10, -26]) steel.push(box(0.5, 0.45, 2.2, s * 5.2, PH + 0.23, z));
      steel.push(box(0.3, 5.2, CHUNK, s * 8.7, 2.6, -CHUNK / 2));
    }
    mesh(g, parts, m.conc);
    mesh(g, roof, m.roof);
    mesh(g, steel, m.steel);
    const [name, sub] = STATIONS[variant % STATIONS.length];
    const signMat = curved(new THREE.MeshBasicMaterial({ map: makeSignTexture(name, sub) }));
    for (const s of [-1, 1]) {
      for (const z of [-12, -30]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), signMat);
        sign.position.set(s * 8.5, 3.2, z);
        sign.rotation.y = -s * Math.PI / 2;
        g.add(sign);
      }
    }
  }

  // ---------------------------------------------------------------- sunset harbour
  sea(g, sides) {
    const parts = [];
    for (const s of sides) {
      const p = new THREE.PlaneGeometry(240, CHUNK).rotateX(-Math.PI / 2).translate(s * (4.7 + 120), -0.7, -CHUNK / 2);
      setUV(p, (x, y, z) => [x / 30, -z / 30]);
      parts.push(p);
    }
    mesh(g, parts, this.mats.sea);
  }

  palm(list, x, z) {
    const lean = rand(-0.15, 0.15);
    const h = rand(5, 7);
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, h, 6, 4).translate(0, h / 2, 0);
    const pos = trunk.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + lean * pos.getY(i) * pos.getY(i) / h);
    list.push(colorize(trunk.translate(x, 0, z), '#8a5a3c'));
    const topX = x + lean * h;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const f = new THREE.ConeGeometry(0.45, 3.4, 4).scale(1, 1, 0.25);
      f.rotateZ(-Math.PI / 2 - 0.35);
      f.translate(1.6, -0.5, 0);
      f.rotateY(a);
      f.translate(topX, h, z);
      list.push(colorize(f, k % 2 ? '#2f9e5a' : '#3fb86a'));
    }
  }

  lampPost(list, glows, x, z, glowGeo) {
    list.push(box(0.14, 5, 0.14, x, 2.5, z));
    list.push(box(0.9, 0.12, 0.2, x - Math.sign(x) * 0.35, 5, z));
    const gp = glowGeo.clone().translate(x - Math.sign(x) * 0.7, 4.85, z + 0.05);
    glows.push(gp);
  }

  harbour(g) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    this.shoulders(g, m.conc, [-1], 12);
    this.shoulders(g, m.conc, [1], 5.0);
    this.sea(g, [1]);
    const paint = [], metal = [], glows = [];
    // low sea wall with railing posts
    paint.push(colorize(box(0.4, 1.0, CHUNK, 5.2, 0.5, -CHUNK / 2), '#c9c0b3'));
    for (let z = -2; z > -CHUNK; z -= 4) paint.push(colorize(box(0.08, 0.6, 0.08, 5.2, 1.3, z), '#e8ecf2'));
    paint.push(colorize(box(0.08, 0.08, CHUNK, 5.2, 1.6, -CHUNK / 2), '#e8ecf2'));
    // container stacks on the quay
    let z = -rand(0, 3);
    while (z > -CHUNK + 6) {
      const x = -rand(7.5, 10);
      const levels = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < levels; k++) {
        const c = box(2.4, 2.55, 6.1, x - (k % 2) * 0.1, 1.28 + k * 2.6, z - 3.05);
        setUV(c, (px, py, pz, nx, ny, nz) => (Math.abs(nx) > 0.5 ? [pz / 2.4, py / 2.6] : [px / 2.4, py / 2.6]));
        metal.push(colorize(c, pick(CONTAINER_COLORS)));
        if (Math.random() < 0.6) {
          const c2 = box(2.4, 2.55, 6.1, x - 2.6, 1.28 + k * 2.6, z - 3.05);
          setUV(c2, (px, py, pz, nx) => (Math.abs(nx) > 0.5 ? [pz / 2.4, py / 2.6] : [px / 2.4, py / 2.6]));
          metal.push(colorize(c2, pick(CONTAINER_COLORS)));
        }
      }
      z -= 7 + rand(0, 3);
    }
    // warehouses
    for (let wz = 0; wz > -CHUNK; wz -= 20) {
      const w = box(12, rand(7, 10), 18, -26, 4.5, wz - 10);
      setUV(w, (px, py, pz, nx, ny) => (Math.abs(ny) > 0.5 ? [0, 0] : Math.abs(nx) > 0.5 ? [pz / 3, py / 3] : [px / 3, py / 3]));
      metal.push(colorize(w, pick(['#c8a07a', '#9fb4c8', '#b88a8a', '#d6c38a'])));
    }
    // ship-to-shore crane straddling the quay, boom over the tracks and the sea
    if (Math.random() < 0.75) {
      const cz = -rand(12, 28);
      const red = '#d9472b', white = '#f2f2f2';
      for (const lx of [-19, -11]) for (const lz of [cz + 4, cz - 4]) paint.push(colorize(box(0.7, 18, 0.7, lx, 9, lz), red));
      for (const lz of [cz + 4, cz - 4]) paint.push(colorize(box(9, 0.8, 0.8, -15, 17.6, lz), white));
      paint.push(colorize(box(0.8, 0.8, 8.8, -19, 17.6, cz), white), colorize(box(0.8, 0.8, 8.8, -11, 17.6, cz), white));
      paint.push(colorize(box(62, 1.3, 2.2, 6, 19, cz), red));
      paint.push(colorize(box(3, 2.4, 3, -15, 21.2, cz), white));
      paint.push(colorize(box(0.3, 7, 0.3, -15, 25, cz), red));
      for (const tx of [-30, 34]) paint.push(colorize(box(0.12, 0.12, 0.12, tx, 19, cz), white));
      // cables
      const cable = box(0.06, 0.06, 1, 0, 0, 0);
      for (const tx of [10, 26]) {
        const len = Math.hypot(tx + 15, 6);
        const cg = box(0.06, len, 0.06, 0, 0, 0).rotateZ(Math.atan2(tx + 15, 6)).translate((tx - 15) / 2, 22, cz);
        paint.push(colorize(cg, '#555'));
      }
      cable.dispose();
    }
    // palms + lamps on the quay edge
    for (let pz = -rand(2, 6); pz > -CHUNK; pz -= 13) this.palm(paint, -4.7, pz);
    const glowGeo = this.glowPlane(2.2);
    for (const lz of [-6, -26]) this.lampPost(paint, glows, 4.6, lz, glowGeo);
    mesh(g, paint, m.paint);
    mesh(g, metal, m.metal);
    mesh(g, glows, m.warmGlow);
  }

  trussBridge(g) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    this.sea(g, [-1, 1]);
    const t = [], deck = [], glows = [];
    deck.push(box(9.6, 0.6, CHUNK, 0, -0.3, -CHUNK / 2));
    for (const s of [-1, 1]) {
      const x = s * 4.7;
      t.push(box(0.5, 0.5, CHUNK, x, 0.3, -CHUNK / 2));
      t.push(box(0.5, 0.5, CHUNK, x, 7.4, -CHUNK / 2));
      for (let z = 0; z >= -CHUNK; z -= 5) t.push(box(0.35, 7.2, 0.35, x, 3.8, z));
      for (let z = 0; z > -CHUNK; z -= 5) {
        const d = box(0.25, Math.hypot(5, 7.1), 0.25, 0, 0, 0).rotateX(((z / 5) % 2 ? 1 : -1) * Math.atan2(5, 7.1)).translate(x, 3.8, z - 2.5);
        t.push(d);
      }
    }
    for (let z = -5; z > -CHUNK; z -= 10) t.push(box(9.4, 0.35, 0.35, 0, 7.4, z));
    mesh(g, t, m.truss);
    mesh(g, deck, m.steel);
    const glowGeo = this.glowPlane(2);
    for (let z = -2; z > -CHUNK; z -= 10) for (const s of [-1, 1]) glows.push(glowGeo.clone().translate(s * 4.7, 7.9, z));
    mesh(g, glows, m.warmGlow);
  }

  // ---------------------------------------------------------------- neon city
  neonCommon(g, signsWanted = true) {
    const m = this.mats;
    this.trackBed(g, m.track);
    this.rails(g, m.rail);
    this.shoulders(g, m.conc);
    const steel = this.catenary(this.walls(g, m.neonWall));
    mesh(g, steel, m.darkSteel);
    // neon tubes along the wall tops
    const pink = [], cyan = [];
    pink.push(box(0.1, 0.1, CHUNK, -WALL_X + 0.05, 3.62, -CHUNK / 2));
    cyan.push(box(0.1, 0.1, CHUNK, WALL_X - 0.05, 3.62, -CHUNK / 2));
    for (let z = -5; z > -CHUNK; z -= 10) {
      pink.push(box(0.08, 3.2, 0.08, -WALL_X + 0.05, 1.8, z));
      cyan.push(box(0.08, 3.2, 0.08, WALL_X - 0.05, 1.8, z));
    }
    const blds = this.buildings(NIGHT_COLORS, 12, 44, 5);
    mesh(g, blds.map((b) => b.geo), m.nightBuild);
    if (signsWanted) {
      const steady = [], flicker = [];
      for (const b of blds) {
        const n = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < n; k++) {
          const i = Math.floor(Math.random() * S.SIGN_COUNT);
          const u0 = (i % 2) * 0.5, v1 = 1 - Math.floor(i / 2) * 0.25;
          const p = new THREE.PlaneGeometry(3.6, 1.8);
          const uv = p.attributes.uv;
          for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * 0.5, v1 - 0.25 + uv.getY(j) * 0.25);
          const innerX = b.x - b.s * (b.d / 2 + 0.06);
          p.rotateY(-b.s * Math.PI / 2).translate(innerX, rand(4.5, Math.min(14, b.h - 2)), b.z + rand(-b.w / 3, b.w / 3));
          (Math.random() < 0.3 ? flicker : steady).push(p);
        }
      }
      mesh(g, steady, m.signs);
      const fm = mesh(g, flicker, m.signsFlicker);
      if (fm) fm.userData.flicker = true;
      // rooftop billboard
      const b = pick(blds.filter((x) => x.h < 30)) || blds[0];
      const bb = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), pick(this.billboards));
      bb.position.set(b.x - b.s * 1, b.h + 3.2, b.z);
      bb.rotation.y = -b.s * Math.PI / 2.6;
      g.add(bb);
      pink.push(box(0.3, 3, 0.3, b.x, b.h + 1.5, b.z));
    }
    // lamp glows on the catenary poles
    const pg = [], cg = [];
    const glowGeo = this.glowPlane(1.8);
    for (const z of [-8, -28]) {
      pg.push(glowGeo.clone().translate(-5.6, 6.6, z + 0.2));
      cg.push(glowGeo.clone().translate(5.6, 6.6, z + 0.2));
    }
    mesh(g, pink, m.pink);
    mesh(g, cyan, m.cyan);
    mesh(g, pg, m.pinkGlow);
    mesh(g, cg, m.cyanGlow);
  }

  neonStreet(g) { this.neonCommon(g, true); }

  neonArcade(g) {
    this.neonCommon(g, false);
    const m = this.mats;
    const a = [], b = [], lanterns = [];
    for (let z = -2, k = 0; z > -CHUNK; z -= 4, k++) {
      const ring = new THREE.TorusGeometry(6.0, 0.13, 6, 40, Math.PI).translate(0, 0.2, z);
      (k % 2 ? a : b).push(ring);
    }
    for (let z = -1; z > -CHUNK; z -= 2.5) {
      for (const s of [-1, 1]) lanterns.push(new THREE.SphereGeometry(0.28, 8, 6).scale(1, 1.3, 1).translate(s * 4.4, 5.6, z));
    }
    mesh(g, a, m.pink);
    mesh(g, b, m.cyan);
    mesh(g, lanterns, m.lantern);
  }

  // ---------------------------------------------------------------- cyber grid
  gridFloor(g) {
    const parts = [];
    for (const s of [-1, 1]) {
      const p = new THREE.PlaneGeometry(80, CHUNK).rotateX(-Math.PI / 2).translate(s * (LANE_W * 1.5 + 40), -0.02, -CHUNK / 2);
      setUV(p, (x, y, z) => [x / 8, -z / 8]);
      parts.push(p);
    }
    mesh(g, parts, this.mats.grid);
  }

  cyberGrid(g) {
    const m = this.mats;
    this.trackBed(g, m.deck);
    this.rails(g, m.railGlow);
    this.gridFloor(g);
    // wireframe towers
    const cy = [], pk = [];
    for (const s of [-1, 1]) {
      let z = -rand(0, 6);
      while (z > -CHUNK) {
        const w = rand(4, 8), h = rand(8, 40), x = s * rand(12, 34);
        const b = box(w, h, w, x, h / 2, z - w / 2);
        (Math.random() < 0.5 ? cy : pk).push(b);
        z -= w + rand(4, 10);
      }
    }
    mesh(g, cy, m.edgeCyan);
    mesh(g, pk, m.edgePink);
    // distant pyramid
    if (Math.random() < 0.6) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(rand(8, 12), rand(10, 16), 4).rotateY(Math.PI / 4), m.pyramid);
      pyr.geometry.computeBoundingBox();
      pyr.position.set(s * rand(40, 55), -pyr.geometry.boundingBox.min.y, -rand(5, 35));
      g.add(pyr);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(pyr.geometry), curved(new THREE.LineBasicMaterial({ color: 0x2ef2ff })));
      pyr.add(edges);
    }
    // floating holo-rings over the tracks
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.14, 8, 48), m.pink));
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.06, 6, 48), m.cyan));
    ring.position.set(0, 3.2, -20);
    g.add(ring);
    g.userData.anims.push((t) => { ring.rotation.z = t * 0.6; ring.children[1].rotation.x = Math.sin(t * 1.3) * 0.3; });
    // sweeping lasers
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 16, 0, -rand(8, 32));
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 70, 0.09).translate(0, 35, 0), s < 0 ? m.laserPink : m.laserCyan);
      pivot.add(beam);
      g.add(pivot);
      const ph = Math.random() * 6;
      g.userData.anims.push((t) => { pivot.rotation.z = s * (0.25 + 0.35 * Math.sin(t * 0.9 + ph)); pivot.rotation.x = 0.4 * Math.sin(t * 0.6 + ph); });
    }
  }

  dataTunnel(g) {
    const m = this.mats;
    this.trackBed(g, m.deck);
    this.rails(g, m.railGlow);
    this.gridFloor(g);
    const a = [], b = [];
    for (let z = -2, k = 0; z > -CHUNK; z -= 4, k++) {
      const parts = [box(10, 0.22, 0.22, 0, 7, z), box(0.22, 7, 0.22, -5, 3.5, z), box(0.22, 7, 0.22, 5, 3.5, z)];
      (k % 2 ? a : b).push(...parts);
    }
    mesh(g, a, m.tunnelA);
    mesh(g, b, m.tunnelB);
  }

  // ---------------------------------------------------------------- galaxy
  spaceDeck(g) {
    const m = this.mats;
    this.trackBed(g, m.deck);
    this.rails(g, m.railGlow);
    const deck = [box(8.6, 0.8, CHUNK, 0, -0.41, -CHUNK / 2)];
    for (let z = -10; z > -CHUNK; z -= 20) deck.push(box(1.2, 30, 1.2, 0, -15.8, z));
    mesh(g, deck, m.bridge);
    const edge = [];
    for (const s of [-1, 1]) {
      edge.push(box(0.12, 0.12, CHUNK, s * 4.15, 0.55, -CHUNK / 2));
      edge.push(box(0.1, 0.1, CHUNK, s * 4.3, -0.82, -CHUNK / 2));
      for (let z = -1; z > -CHUNK; z -= 4) edge.push(box(0.08, 0.55, 0.08, s * 4.15, 0.27, z));
    }
    mesh(g, edge, m.cyan);
  }

  spaceBridge(g) {
    const m = this.mats;
    this.spaceDeck(g);
    // asteroids
    const rocks = [];
    for (let k = 0; k < 7; k++) {
      const r = rand(1, 4.5);
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const n = 0.75 + 0.25 * Math.sin(v.x * 3.1 + v.y * 2.3) * Math.cos(v.z * 2.7);
        pos.setXYZ(i, v.x * n, v.y * n, v.z * n);
      }
      geo.computeVertexNormals();
      const s = Math.random() < 0.5 ? -1 : 1;
      geo.rotateX(rand(0, 3)).rotateY(rand(0, 3)).translate(s * rand(11, 45), rand(-18, 16), -rand(0, CHUNK));
      rocks.push(geo);
    }
    const rm = mesh(g, rocks, m.rock);
    const ph = Math.random() * 6;
    g.userData.anims.push((t) => { rm.position.y = Math.sin(t * 0.5 + ph) * 0.8; });
    // glowing crystals
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.6, 1.6)), pick([m.crystalA, m.crystalB, m.crystalC]));
      const s = Math.random() < 0.5 ? -1 : 1;
      c.position.set(s * rand(7, 22), rand(1, 12), -rand(0, CHUNK));
      c.scale.y = 1.6;
      g.add(c);
      const p0 = c.position.y, cp = Math.random() * 6;
      g.userData.anims.push((t) => { c.rotation.y = t * 1.2 + cp; c.position.y = p0 + Math.sin(t * 1.4 + cp) * 0.5; });
    }
    // star gate arch with a rainbow gradient
    const arch = new THREE.TorusGeometry(6.4, 0.22, 8, 48, Math.PI);
    const pos = arch.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i)) / Math.PI;
      c.setHSL(0.5 + a * 0.45, 1, 0.6);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    arch.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    arch.translate(0, 0.1, -20);
    g.add(new THREE.Mesh(arch, m.rainbow));
  }

  warpTunnel(g) {
    const m = this.mats;
    this.spaceDeck(g);
    const tube = new THREE.CylinderGeometry(7.5, 7.5, CHUNK, 32, 1, true).rotateX(Math.PI / 2).translate(0, 1.5, -CHUNK / 2);
    g.add(new THREE.Mesh(tube, m.warp));
    const rings = [];
    for (let z = -4; z > -CHUNK; z -= 8) rings.push(new THREE.TorusGeometry(7.3, 0.1, 6, 48).translate(0, 1.5, z));
    mesh(g, rings, m.cyan);
  }

  // ---------------------------------------------------------------- gates
  makeGate(i) {
    const th = THEMES[i];
    const color = GATE_COLORS[i];
    const g = new THREE.Group();
    const frameMat = curved(new THREE.MeshLambertMaterial({ color: 0x241c3c, emissive: 0x120c26 }));
    const glowMat = curved(new THREE.MeshBasicMaterial({ color }));
    const signMat = curved(new THREE.MeshBasicMaterial({ map: S.makeGateSign(i + 1, th.name, th.en, color) }));
    const bottom = th.id === 'galaxy' ? -12 : 0;
    const pylonH = 8.8 - bottom;
    const frame = [], glow = [];
    for (const s of [-1, 1]) {
      frame.push(box(1.0, pylonH, 1.0, s * 5.6, bottom + pylonH / 2, 0));
      glow.push(box(0.14, pylonH, 0.14, s * 5.6, bottom + pylonH / 2, 0.56));
      glow.push(box(0.14, pylonH, 0.14, s * 5.6 - s * 0.45, bottom + pylonH / 2, 0.56));
    }
    frame.push(box(12.4, 2.4, 1.0, 0, 8.8, 0));
    glow.push(box(12.6, 0.14, 0.14, 0, 7.55, 0.56), box(12.6, 0.14, 0.14, 0, 10.05, 0.56));
    mesh(g, frame, frameMat);
    mesh(g, glow, glowMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 2.14), signMat);
    sign.position.set(0, 8.8, 0.52);
    g.add(sign);
    return g;
  }

  // ---------------------------------------------------------------- streaming
  reset(startZ) {
    for (const c of this.active) c.visible = false;
    for (const g of this.gates) g.mesh.visible = false;
    this.active = [];
    this.gates = [];
    this.nextZ = startZ + CHUNK;
    this.baseTheme = zoneOfZ(startZ - 1);
    this.lastTheme = this.baseTheme;
    this.sinceSpecial = 0;
    this.queue = [];
  }

  nextType(theme) {
    if (this.queue.length) return this.queue.shift();
    this.sinceSpecial++;
    if (this.sinceSpecial > 4 && Math.random() < 0.28) {
      this.sinceSpecial = 0;
      const specials = World.SPECS[theme].specials;
      const [type, , run] = pick(specials);
      this.queue = Array(run - 1).fill(type);
      return type;
    }
    return 'open';
  }

  take(theme, type) {
    this.buildTheme(theme);
    const list = this.pools.get(`${theme}:${type}`) || [];
    const free = list.filter((c) => !c.visible);
    if (!free.length) return type === 'open' ? list[0] : this.take(theme, 'open');
    return pick(free);
  }

  addGate(z, from, to) {
    this.buildTheme(to);
    const mesh = this.gateMeshes[to];
    mesh.position.set(0, 0, z);
    mesh.visible = true;
    this.gates.push({ z, dist: -z, from, to, mesh, announced: false });
    if (this.gates.length > 3) this.gates.shift();
  }

  // Which zones to blend for the camera/sky at this depth: a, b and t (0..1)
  themeBlend(playerZ) {
    const dist = -playerZ;
    let g = null;
    for (const gate of this.gates) if (dist >= gate.dist - 90) g = gate;
    if (!g) return { a: this.baseTheme, b: this.baseTheme, t: 1 };
    return { a: g.from, b: g.to, t: Math.min(1, Math.max(0, (dist - (g.dist - 90)) / 120)) };
  }

  update(playerZ, ahead, behind, time = 0, dt = 0) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      if (c.position.z - CHUNK > playerZ + behind) { c.visible = false; this.active.splice(i, 1); }
    }
    for (const g of this.gates) if (g.z > playerZ + behind + 10) g.mesh.visible = false;
    while (this.nextZ > playerZ - ahead) {
      const theme = zoneOfZ(this.nextZ - 1);
      if (theme !== this.lastTheme) {
        this.addGate(this.nextZ, this.lastTheme, theme);
        this.lastTheme = theme;
        this.queue = [];
        this.sinceSpecial = 0;
      }
      const c = this.take(theme, this.nextType(theme));
      c.position.z = this.nextZ;
      c.visible = true;
      this.active.push(c);
      this.nextZ -= CHUNK;
    }
    // animation
    for (const c of this.active) for (const fn of c.userData.anims) fn(time, dt);
    this.seaTex.offset.x = time * 0.02;
    this.warpTex.offset.y = -time * 1.6;
    this.mats.signsFlicker.opacity = Math.sin(time * 23) > -0.6 || Math.sin(time * 3.1) > 0 ? 1 : 0.25;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    this.mats.tunnelA.color.setHSL(0.88 + pulse * 0.06, 1, 0.6);
    this.mats.tunnelB.color.setHSL(0.5 + pulse * 0.05, 1, 0.55);
  }
}
