// Level generator: obstacle patterns, coins and power-ups ahead of the runner,
// plus the geometry queries the physics needs.
import * as THREE from 'three';
import { TRAIN, LANE_W, laneX, AHEAD, BEHIND, JET_Y } from './config.js';

const TRAIN_LEN = (cars) => cars * TRAIN.CAR + (cars - 1) * TRAIN.GAP;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const COIN_STEP = 2.2;
const COIN_Y = 0.75;
const ROOF_COIN_Y = TRAIN.H + 0.75;

export class Level {
  constructor(scene, props) {
    this.scene = scene;
    this.props = props;
    this.obstacles = [];
    this.coins = [];
    this.powerups = [];
    this.coinMesh = props.coins(700);
    scene.add(this.coinMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  reset(startZ) {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const p of this.powerups) this.scene.remove(p.mesh);
    this.obstacles = [];
    this.coins = [];
    this.powerups = [];
    this.startZ = startZ;
    this.genZ = startZ - 50;
    this.sincePower = 0;
    this.patternCount = 0;
    this.lastPattern = '';
    // opening coin line in the middle lane
    for (let d = 12; d < 48; d += COIN_STEP) this.addCoin(laneX(1), COIN_Y, startZ - d);
  }

  // ---------- spawning primitives ----------
  addCoin(x, y, z) { this.coins.push({ x, y, z, magnet: false }); }

  coinLine(lane, z0, z1, y = COIN_Y) {
    for (let z = z0; z > z1; z -= COIN_STEP) this.addCoin(laneX(lane), y, z);
  }

  coinArc(lane, zc, height = 1.6) {
    for (let i = -3; i <= 3; i++) {
      const t = i / 3.5;
      this.addCoin(laneX(lane), COIN_Y + height * (1 - t * t), zc - i * 1.4);
    }
  }

  addTrain(lane, zFront, cars, { ramp = false, moving = 0, variant = rint(0, 3) } = {}) {
    let zF = zFront;
    if (ramp) {
      const mesh = this.props.ramp();
      mesh.position.set(laneX(lane), 0, zF);
      this.scene.add(mesh);
      this.obstacles.push({ kind: 'ramp', lane, x: laneX(lane), zF, zB: zF - TRAIN.RAMP, y0: 0, y1: TRAIN.H, u: 0, mesh });
      zF -= TRAIN.RAMP;
    }
    const len = TRAIN_LEN(cars);
    const mesh = this.props.train(variant, cars, moving > 0);
    mesh.position.set(laneX(lane), 0, zF);
    this.scene.add(mesh);
    const o = { kind: 'train', lane, x: laneX(lane), zF, zB: zF - len, y0: 0, y1: TRAIN.H, u: moving, active: false, mesh };
    this.obstacles.push(o);
    return o;
  }

  addBarrier(lane, z, kind) {
    const mesh = this.props.barrierMesh(kind);
    mesh.position.set(laneX(lane), 0, z);
    this.scene.add(mesh);
    const [y0, y1] = kind === 'hurdle' ? [0, 1.0] : [1.22, 2.35];
    this.obstacles.push({ kind, lane, x: laneX(lane), zF: z + 0.12, zB: z - 0.12, y0, y1, u: 0, mesh });
  }

  addPower(type, lane, y, z) {
    const mesh = this.props.powerup(type);
    mesh.position.set(laneX(lane), y, z);
    this.scene.add(mesh);
    this.powerups.push({ type, x: laneX(lane), y, z, mesh, t: Math.random() * 6 });
    this.sincePower = 0;
  }

  maybePower(lane, y, z, game) {
    if (this.sincePower < this.powerGap || game.player.jet > 0) return false;
    const types = ['magnet', 'magnet', 'jetpack', 'sneakers', 'x2'];
    this.addPower(pick(types), lane, y, z);
    this.powerGap = 220 + Math.random() * 180;
    return true;
  }

  // ---------- patterns ----------
  // Each pattern starts at this.genZ, builds toward -z and returns its length.
  pBreather(Z, g) {
    let lane = rint(0, 2);
    const L = 28;
    for (let d = 2; d < L; d += COIN_STEP) {
      if (Math.random() < 0.06) lane = Math.max(0, Math.min(2, lane + pick([-1, 1])));
      this.addCoin(laneX(lane), COIN_Y, Z - d);
    }
    this.maybePower((lane + rint(1, 2)) % 3, 1.1, Z - L / 2, g);
    return L;
  }

  pBarriers(Z, g) {
    const rows = rint(1, 2 + Math.round(g.diff * 1.5));
    const spacing = 15 + g.speed * 0.45;
    for (let r = 0; r < rows; r++) {
      const z = Z - 6 - r * spacing;
      let kinds;
      do {
        kinds = [0, 1, 2].map(() => (Math.random() < 0.28 - g.diff * 0.15 ? null : (Math.random() < 0.5 ? 'hurdle' : 'overhead')));
      } while (kinds.every((k) => k === null));
      kinds.forEach((k, lane) => { if (k) this.addBarrier(lane, z, k); });
      const cl = rint(0, 2);
      if (kinds[cl] === 'hurdle') this.coinArc(cl, z, 1.7);
      else if (kinds[cl] === 'overhead') this.coinLine(cl, z + 6, z - 6, 0.5);
      else this.coinLine(cl, z + 8, z - 8);
    }
    return 10 + rows * spacing;
  }

  pTrainsSide(Z, g) {
    const free = rint(0, 2);
    let end = 0;
    let rampDone = false;
    for (let lane = 0; lane < 3; lane++) {
      if (lane === free) continue;
      const cars = rint(1, 2 + Math.round(g.diff));
      const off = rint(0, 10);
      const ramp = !rampDone && Math.random() < 0.4;
      rampDone ||= ramp;
      const o = this.addTrain(lane, Z - off, cars, { ramp });
      end = Math.max(end, Z - o.zB);
      if (ramp) {
        for (let d = 1; d < TRAIN.RAMP; d += COIN_STEP) {
          this.addCoin(laneX(lane), (d / TRAIN.RAMP) * TRAIN.H + 0.75, Z - off - d);
        }
        this.coinLine(lane, o.zF - 1, o.zB + 1, ROOF_COIN_Y);
        this.maybePower(lane, TRAIN.H + 1.1, o.zB + 4, g);
      }
    }
    // free lane: coins and maybe barriers
    this.coinLine(free, Z - 2, Z - end + 2);
    if (g.diff > 0.15) {
      for (let d = 14; d < end - 6; d += 22) {
        if (Math.random() < 0.3 + g.diff * 0.5) {
          const z = Z - d;
          this.coins = this.coins.filter((c) => !(c.x === laneX(free) && Math.abs(c.z - z) < 5));
          const k = Math.random() < 0.5 ? 'hurdle' : 'overhead';
          this.addBarrier(free, z, k);
          if (k === 'hurdle') this.coinArc(free, z, 1.7);
        }
      }
    }
    return end + 4;
  }

  pRampHop(Z, g) {
    const a = rint(0, 2);
    const b = a === 0 ? 1 : a === 2 ? 1 : pick([0, 2]);
    const c = 3 - a - b;
    const t1 = this.addTrain(a, Z - 2, 3, { ramp: true });
    const t2 = this.addTrain(b, t1.zF - 14, 3);
    for (let d = 1; d < TRAIN.RAMP; d += COIN_STEP) this.addCoin(laneX(a), (d / TRAIN.RAMP) * TRAIN.H + 0.75, Z - 2 - d);
    this.coinLine(a, t1.zF - 1, t2.zF + 2, ROOF_COIN_Y);
    this.coinLine(b, t2.zF - 2, t2.zB + 1, ROOF_COIN_Y);
    let end = Z - Math.min(t1.zB, t2.zB);
    if (Math.random() < 0.5) {
      const t3 = this.addTrain(c, Z - rint(14, 24), rint(1, 2));
      end = Math.max(end, Z - t3.zB);
    } else {
      this.addBarrier(c, Z - 20, pick(['hurdle', 'overhead']));
      this.addBarrier(c, Z - 44, pick(['hurdle', 'overhead']));
    }
    this.maybePower(a, TRAIN.H + 1.1, t1.zF - 8, g);
    return end + 4;
  }

  pOncoming(Z, g) {
    const m = rint(0, 2);
    const u = 7 + g.diff * 6;
    const free = 42 + g.speed * 0.9;
    const cars = rint(2, 3);
    const t = this.addTrain(m, Z - free, cars, { moving: u });
    t.activateAt = free * (g.speed + u) / u; // start rolling so it meets the runner inside the free stretch
    this.coinLine(m, Z - 2, Z - 14);
    const others = [0, 1, 2].filter((l) => l !== m);
    const blocker = pick(others);
    const open = others.find((l) => l !== blocker);
    const ramp = Math.random() < 0.5;
    const bt = this.addTrain(blocker, Z - rint(8, 18), rint(1, 2), { ramp });
    if (ramp) this.coinLine(blocker, bt.zF - 1, bt.zB + 1, ROOF_COIN_Y);
    this.coinLine(open, Z - 16, Z - free - 10);
    if (g.diff > 0.3 && Math.random() < 0.6) {
      this.addBarrier(open, Z - free - 2, pick(['hurdle', 'overhead']));
    }
    const end = Math.max(free + TRAIN_LEN(cars), Z - bt.zB);
    return end + 4;
  }

  pZigzag(Z, g) {
    const blocks = rint(3, 4 + Math.round(g.diff));
    const gap = 7 + g.speed * 0.32;
    let f = rint(0, 2);
    let d = 4;
    for (let k = 0; k < blocks; k++) {
      for (let lane = 0; lane < 3; lane++) {
        if (lane === f) continue;
        if (Math.random() < 0.72) this.addTrain(lane, Z - d, 1);
        else this.addBarrier(lane, Z - d - TRAIN.CAR / 2, pick(['hurdle', 'overhead']));
      }
      this.coinLine(f, Z - d, Z - d - TRAIN.CAR);
      const nf = Math.random() < 0.3 ? f : Math.max(0, Math.min(2, f + pick([-1, 1])));
      f = nf;
      d += TRAIN.CAR + gap;
    }
    return d;
  }

  pTrainWall(Z, g) {
    const r = rint(0, 2);
    const t = this.addTrain(r, Z - 2, rint(2, 3), { ramp: true });
    for (let d = 1; d < TRAIN.RAMP; d += COIN_STEP) this.addCoin(laneX(r), (d / TRAIN.RAMP) * TRAIN.H + 0.75, Z - 2 - d);
    this.coinLine(r, t.zF - 1, t.zB + 1, ROOF_COIN_Y);
    let end = Z - t.zB;
    for (let lane = 0; lane < 3; lane++) {
      if (lane === r) continue;
      const o = this.addTrain(lane, t.zF, rint(2, 3));
      end = Math.max(end, Z - o.zB);
    }
    if (!this.maybePower(r, TRAIN.H + 1.1, t.zF - 10, g)) this.coinLine((r + 1) % 3, t.zF - 4, t.zF - 20, ROOF_COIN_Y);
    return end + 4;
  }

  spawnPattern(g) {
    const D = g.diff, dist = g.distance;
    const table = [
      ['breather', 1.6 - D],
      ['barriers', 3],
      ['trainsSide', 3],
      ['rampHop', 1.4 + D],
      ['oncoming', dist > 250 ? 0.6 + 2.4 * D : 0],
      ['zigzag', dist > 450 ? 0.5 + 2 * D : 0],
      ['trainWall', dist > 350 ? 0.5 + D : 0],
    ].filter(([n, w]) => w > 0 && !(n === this.lastPattern && n !== 'barriers'));
    let total = table.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let name = table[0][0];
    for (const [n, w] of table) { r -= w; if (r <= 0) { name = n; break; } }
    const fn = { breather: this.pBreather, barriers: this.pBarriers, trainsSide: this.pTrainsSide, rampHop: this.pRampHop, oncoming: this.pOncoming, zigzag: this.pZigzag, trainWall: this.pTrainWall }[name];
    const len = fn.call(this, this.genZ, g);
    this.lastPattern = name;
    this.patternCount++;
    const gap = 9 + g.speed * 0.3 - D * 3;
    this.genZ -= len + gap;
    this.sincePower += len + gap;
  }

  // coins in the sky for the jetpack
  skyCoins(fromZ, length) {
    let lane = rint(0, 2);
    for (let d = 8; d < length; d += COIN_STEP) {
      if (d % 36 < COIN_STEP && Math.random() < 0.7) lane = Math.max(0, Math.min(2, lane + pick([-1, 1])));
      this.addCoin(laneX(lane), JET_Y + 0.8, fromZ - d);
    }
  }

  // remove everything (obstacles + powerups) overlapping [z1, z0]
  clearRange(z0, z1, alsoMoving = true) {
    this.obstacles = this.obstacles.filter((o) => {
      const hit = (o.zB < z0 && o.zF > z1) || (alsoMoving && o.u > 0 && o.zF > z1 - 200);
      if (hit) this.scene.remove(o.mesh);
      return !hit;
    });
  }

  // ---------- per-frame ----------
  update(dt, g, time) {
    if (!this.powerGap) this.powerGap = 140;
    const pz = g.player.z;
    while (this.genZ > pz - AHEAD) this.spawnPattern(g);
    // moving trains
    for (const o of this.obstacles) {
      if (o.u <= 0) continue;
      if (!o.active && o.zF > pz - o.activateAt) o.active = true;
      if (o.active) {
        o.zF += o.u * dt; o.zB += o.u * dt;
        o.mesh.position.z = o.zF;
      }
      if (o.mesh.userData.warn) o.mesh.userData.warn.visible = Math.sin(time * 14) > 0;
    }
    // cleanup
    const limit = pz + BEHIND;
    this.obstacles = this.obstacles.filter((o) => {
      if (o.zB > limit) { this.scene.remove(o.mesh); return false; }
      return true;
    });
    this.powerups = this.powerups.filter((p) => {
      if (p.z > limit || p.taken) { this.scene.remove(p.mesh); return false; }
      p.t += dt;
      p.mesh.userData.spin.rotation.y = p.t * 2.4;
      p.mesh.position.y = p.y + Math.sin(p.t * 3) * 0.12;
      return true;
    });
    this.coins = this.coins.filter((c) => c.z < pz + 6 && !c.taken);
  }

  renderCoins(time, pz) {
    const m = this.coinMesh;
    let n = 0;
    this._e.set(0, time * 3.2, 0);
    this._q.setFromEuler(this._e);
    for (const c of this.coins) {
      if (c.z < pz - AHEAD - 10) continue;
      if (n >= m.instanceMatrix.count) break;
      this._p.set(c.x, c.y, c.z);
      this._m.compose(this._p, this._q, this._s);
      m.setMatrixAt(n++, this._m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }

  // Highest walkable surface under a footprint [x-hw, x+hw] at depth z.
  groundAt(x, z, hw = 0.25) {
    let h = 0;
    for (const o of this.obstacles) {
      if (o.kind !== 'train' && o.kind !== 'ramp') continue;
      if (z > o.zF || z < o.zB) continue;
      if (x + hw < o.x - TRAIN.W / 2 || x - hw > o.x + TRAIN.W / 2) continue;
      const top = o.kind === 'ramp' ? TRAIN.H * (o.zF - z) / (o.zF - o.zB) : o.y1;
      if (top > h) h = top;
    }
    return h;
  }
}

export { LANE_W };
