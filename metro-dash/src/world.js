// Scenery: recycled 40 m chunks of track, walls, buildings, tunnels and stations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W, laneX } from './config.js';
import { curved } from './curve.js';
import * as T from './textures.js';

const CHUNK = 40;
const WALL_X = 6.6;
const BUILDING_COLORS = ['#f2a65a', '#7fb7be', '#d3c0d2', '#f6e27f', '#e7a3a3', '#9fd8cb', '#b7c7ff', '#ffc9a8', '#c5e17a'];

function rand(a, b) { return a + Math.random() * (b - a); }

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
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

function makeSignTexture(name, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const STATIONS = [['橙子站', 'ORANGE ST.'], ['晚霞路', 'SUNSET RD.'], ['涂鸦公园', 'GRAFFITI PARK'], ['终点站', 'LAST STOP']];

export class World {
  constructor(scene) {
    this.scene = scene;
    const lam = (o) => curved(new THREE.MeshLambertMaterial(o));
    const trackTex = T.makeTrackTexture();
    const concTex = T.makeConcreteTexture();
    this.mats = {
      track: lam({ map: trackTex }),
      rail: lam({ color: 0xd9dee6, emissive: 0x30343c }),
      conc: lam({ map: concTex }),
      wall: lam({ map: T.makeWallTexture() }),
      build: lam({ map: T.makeBuildingTexture(), vertexColors: true }),
      steel: lam({ color: 0x5d6575 }),
      tunnel: lam({ color: 0x77706b, side: THREE.DoubleSide }),
      brick: lam({ color: 0xc8643c }),
      lamp: curved(new THREE.MeshBasicMaterial({ color: 0xfff3c4 })),
      roof: lam({ color: 0xe8ecf2 }),
      platform: lam({ map: concTex }),
    };
    this.pool = [];
    for (let i = 0; i < 8; i++) this.pool.push(this.makeChunk('open'));
    for (let i = 0; i < 3; i++) this.pool.push(this.makeChunk('tunnel'));
    for (let i = 0; i < 2; i++) this.pool.push(this.makeChunk('station', i));
    for (const c of this.pool) { c.visible = false; scene.add(c); }
    this.active = [];
    this.nextZ = 0;
    this.plan = [];
  }

  makeChunk(type, variant = 0) {
    const g = new THREE.Group();
    g.userData.type = type;
    const m = this.mats;
    // track bed for the three lanes + rails
    const bed = new THREE.PlaneGeometry(LANE_W * 3, CHUNK);
    bed.rotateX(-Math.PI / 2);
    bed.translate(0, 0, -CHUNK / 2);
    setUV(bed, (x, y, z) => [(x + LANE_W * 1.5) / LANE_W, -z / LANE_W]);
    g.add(new THREE.Mesh(bed, m.track));
    const rails = [];
    for (let l = 0; l < 3; l++) for (const s of [-1, 1]) rails.push(box(0.1, 0.16, CHUNK, laneX(l) + s * 0.72, 0.08, -CHUNK / 2));
    g.add(new THREE.Mesh(mergeGeometries(rails), m.rail));

    if (type === 'station') this.addStation(g, variant);
    else {
      // shoulders
      const sh = [];
      for (const s of [-1, 1]) {
        const p = new THREE.PlaneGeometry(WALL_X - LANE_W * 1.5, CHUNK);
        p.rotateX(-Math.PI / 2);
        p.translate(s * (LANE_W * 1.5 + (WALL_X - LANE_W * 1.5) / 2), 0.01, -CHUNK / 2);
        setUV(p, (x, y, z) => [s > 0 ? (x - LANE_W * 1.5) / 3.2 : (-x - LANE_W * 1.5) / 3.2, -z / 3]);
        sh.push(p);
      }
      g.add(new THREE.Mesh(mergeGeometries(sh), m.conc));
    }
    if (type === 'open') this.addOpen(g);
    if (type === 'tunnel') this.addTunnel(g);
    return g;
  }

  addOpen(g) {
    const m = this.mats;
    // graffiti walls, three 13.3 m panels a side
    const walls = [], caps = [];
    const seg = CHUNK / 3, H = 3.4;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const row = Math.floor(Math.random() * 4);
        const p = new THREE.PlaneGeometry(seg, H);
        p.rotateY(-s * Math.PI / 2);
        p.translate(s * WALL_X, H / 2, -seg * (k + 0.5));
        setUV(p, (x, y, z, nx, ny, nz, u, v) => [u, (3 - row) / 4 + v / 4]);
        walls.push(p);
      }
      caps.push(box(0.5, 0.25, CHUNK, s * (WALL_X + 0.2), H + 0.12, -CHUNK / 2));
      caps.push(box(0.4, H, CHUNK, s * (WALL_X + 0.25), H / 2, -CHUNK / 2));
    }
    g.add(new THREE.Mesh(mergeGeometries(walls), m.wall));
    // catenary poles + wires
    const steel = [...caps];
    for (const z of [-8, -28]) {
      for (const s of [-1, 1]) steel.push(box(0.22, 6.6, 0.22, s * 5.6, 3.3, z));
      steel.push(box(11.4, 0.22, 0.22, 0, 6.5, z));
      for (let l = 0; l < 3; l++) steel.push(box(0.05, 0.6, 0.05, laneX(l), 6.1, z));
    }
    for (let l = 0; l < 3; l++) steel.push(box(0.04, 0.04, CHUNK, laneX(l), 5.8, -CHUNK / 2));
    g.add(new THREE.Mesh(mergeGeometries(steel), m.steel));
    // buildings behind the walls
    const blds = [];
    for (const s of [-1, 1]) {
      let z = -rand(0, 4);
      while (z > -CHUNK) {
        const w = rand(7, 13), d = rand(6, 10), h = rand(7, 24);
        const x = s * (WALL_X + 3 + d / 2 + rand(0, 6));
        const b = box(d, h, w, x, h / 2, z - w / 2);
        setUV(b, (px, py, pz, nx, ny, nz) => {
          if (Math.abs(ny) > 0.5) return [0.01, 0.99]; // roof: plain colour
          if (Math.abs(nx) > 0.5) return [(pz - z) / 6, py / 6];
          return [px / 6, py / 6];
        });
        blds.push(colorize(b, BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)]));
        // rooftop box
        if (Math.random() < 0.6) {
          const r = box(d * 0.4, rand(1, 2.5), w * 0.3, x, h + 0.8, z - w / 2);
          setUV(r, () => [0.01, 0.99]);
          blds.push(colorize(r, '#9aa3b5'));
        }
        z -= w + rand(0.5, 3);
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(blds), m.build));
  }

  addTunnel(g) {
    const m = this.mats;
    const R = 7.2;
    const shell = new THREE.CylinderGeometry(R, R, CHUNK, 24, 1, true, -Math.PI / 2, Math.PI);
    shell.rotateX(Math.PI / 2);
    shell.rotateZ(0);
    shell.translate(0, 0, -CHUNK / 2);
    g.add(new THREE.Mesh(shell, m.tunnel));
    // portal arches at both ends
    const arches = [];
    for (const z of [0, -CHUNK]) {
      const a = new THREE.TorusGeometry(R + 0.4, 0.6, 6, 24, Math.PI);
      a.translate(0, 0, z);
      arches.push(a);
      for (const s of [-1, 1]) arches.push(box(1.6, 0.8, 1.2, s * (R + 0.4), 0.4, z));
    }
    g.add(new THREE.Mesh(mergeGeometries(arches), m.brick));
    // ceiling lamps
    const lamps = [];
    for (let z = -4; z > -CHUNK; z -= 8) {
      for (const s of [-1, 1]) {
        const lb = box(0.3, 0.12, 2.4, s * 4.6, 5.2, z);
        lamps.push(lb);
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(lamps), m.lamp));
  }

  addStation(g, variant) {
    const m = this.mats;
    const parts = [], roof = [], steel = [];
    const PH = 1.0;
    for (const s of [-1, 1]) {
      const p = box(WALL_X - LANE_W * 1.5 + 2, PH, CHUNK, s * (LANE_W * 1.5 + (WALL_X - LANE_W * 1.5 + 2) / 2), PH / 2, -CHUNK / 2);
      setUV(p, (x, y, z, nx, ny) => [Math.abs(ny) > 0.5 ? (s > 0 ? (x - LANE_W * 1.5) / 3.2 : (-x - LANE_W * 1.5) / 3.2) : 0.9, -z / 3]);
      parts.push(p);
      for (let z = -4; z > -CHUNK; z -= 8) steel.push(box(0.35, 4.2, 0.35, s * 6.0, PH + 2.1, z));
      roof.push(box(4.6, 0.3, CHUNK, s * 6.6, PH + 4.3, -CHUNK / 2));
      // benches
      for (const z of [-10, -26]) steel.push(box(0.5, 0.45, 2.2, s * 5.2, PH + 0.23, z));
      // back wall
      steel.push(box(0.3, 5.2, CHUNK, s * 8.7, 2.6, -CHUNK / 2));
    }
    g.add(new THREE.Mesh(mergeGeometries(parts), m.platform));
    g.add(new THREE.Mesh(mergeGeometries(roof), m.roof));
    g.add(new THREE.Mesh(mergeGeometries(steel), m.steel));
    // station name boards facing the tracks
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

  reset(startZ) {
    for (const c of this.active) c.visible = false;
    this.active = [];
    this.nextZ = startZ + CHUNK; // first chunk starts a bit behind the start
    this.sinceSpecial = 0;
    this.queue = [];
  }

  nextType() {
    if (this.queue.length) return this.queue.shift();
    this.sinceSpecial++;
    if (this.sinceSpecial > 5 && Math.random() < 0.25) {
      this.sinceSpecial = 0;
      if (Math.random() < 0.55) {
        this.queue = ['tunnel', 'tunnel'];
        return 'tunnel';
      }
      return 'station';
    }
    return 'open';
  }

  take(type) {
    const free = this.pool.filter((c) => c.userData.type === type && !c.visible);
    if (!free.length) return this.take('open');
    return free[Math.floor(Math.random() * free.length)];
  }

  update(playerZ, ahead, behind) {
    // retire chunks that are fully behind the camera
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      if (c.position.z - CHUNK > playerZ + behind) { c.visible = false; this.active.splice(i, 1); }
    }
    while (this.nextZ > playerZ - ahead) {
      const c = this.take(this.nextType());
      c.position.z = this.nextZ;
      c.visible = true;
      this.active.push(c);
      this.nextZ -= CHUNK;
    }
  }

  typeAt(z) {
    for (const c of this.active) if (z <= c.position.z && z > c.position.z - CHUNK) return c.userData.type;
    return 'open';
  }
}
