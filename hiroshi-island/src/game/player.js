import { MathUtils, Vector2, Vector3 } from 'three';

const EYE = 1.62;
const RADIUS = 0.3;
const STEP_UP = 0.42;

/**
 * First person walker: terrain following, wading in shallow water, walkable
 * platforms (deck, engawa, stepping stones) and simple 2D collision shapes.
 */
export class Player {
  constructor(world) {
    this.world = world;
    this.hf = world.hf;
    this.pos = new Vector3(); // feet
    this.vel = new Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.bobAmp = 0;
    this.speedScale = 1;
    this.sensitivity = 0.0022;
    this.surface = 'grass';
    this.stepDist = 0;
    this.onStep = null; // callback(surface)
    this.inWater = 0;
    this.blockedMsg = null;
    this.frozen = false;
    const b = world.layout.playable;
    this.bounds = b;
  }

  place(pose) {
    this.pos.copy(pose.position);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.pos.y = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
  }

  /** Height of whatever the feet would stand on at (x, z). */
  groundAt(x, z, feetY) {
    let g = this.hf.height(x, z);
    this.surface = 'grass';
    const wd = this.hf.waterLevel(x, z) - g;
    if (wd > 0.02) this.surface = 'water';
    // walkable platforms
    for (const p of this.world.platforms ?? []) {
      const dx = x - p.x;
      const dz = z - p.z;
      const lx = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
      const lz = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw);
      if (lx > p.x0 - 0.05 && lx < p.x1 + 0.05 && lz > p.z0 - 0.05 && lz < p.z1 + 0.05 && p.y > g && p.y < feetY + STEP_UP + 0.05) {
        g = p.y;
        this.surface = 'wood';
      }
    }
    // stepping stones and low rocks
    for (const c of this.world.colliders) {
      if (c.top === undefined || c.tree || c.rect || c.seg) continue;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r * 0.9 && c.top > g && c.top < feetY + STEP_UP + 0.05) {
        g = c.top;
        this.surface = 'stone';
      }
    }
    return g;
  }

  collide(next, feetY) {
    // push out of circles, rotated rectangles and segments
    for (const c of this.world.colliders) {
      if (c.seg) {
        const [ax, az, bx, bz] = c.seg;
        const abx = bx - ax;
        const abz = bz - az;
        const t = MathUtils.clamp(((next.x - ax) * abx + (next.z - az) * abz) / (abx * abx + abz * abz), 0, 1);
        const px = ax + abx * t;
        const pz = az + abz * t;
        const dx = next.x - px;
        const dz = next.z - pz;
        const d = Math.hypot(dx, dz);
        const min = RADIUS + c.r;
        if (d < min && d > 1e-5) {
          next.x = px + (dx / d) * min;
          next.z = pz + (dz / d) * min;
        }
      } else if (c.rect) {
        if (c.top !== undefined && c.top < feetY + STEP_UP) continue;
        const r = c.rect;
        const cs = Math.cos(r.yaw);
        const sn = Math.sin(r.yaw);
        const dx = next.x - r.x;
        const dz = next.z - r.z;
        let lx = dx * cs - dz * sn;
        let lz = dx * sn + dz * cs;
        const ex = r.hw + RADIUS;
        const ez = r.hd + RADIUS;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          const px = ex - Math.abs(lx);
          const pz = ez - Math.abs(lz);
          if (px < pz) lx = Math.sign(lx) * ex;
          else lz = Math.sign(lz) * ez;
          next.x = r.x + lx * cs + lz * sn;
          next.z = r.z - lx * sn + lz * cs;
        }
      } else {
        if (c.top !== undefined && c.top < feetY + STEP_UP) continue;
        const dx = next.x - c.x;
        const dz = next.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = RADIUS + c.r;
        if (d < min && d > 1e-5) {
          next.x = c.x + (dx / d) * min;
          next.z = c.z + (dz / d) * min;
        }
      }
    }
  }

  update(dt, input, { lookOnly = false, slow = 1 } = {}) {
    if (this.frozen) return;
    // look
    this.yaw -= input.dx * this.sensitivity * (slow < 1 ? 0.6 : 1);
    this.pitch -= input.dy * this.sensitivity * (slow < 1 ? 0.6 : 1);
    this.pitch = MathUtils.clamp(this.pitch, -1.45, 1.45);
    if (lookOnly) {
      this.vel.set(0, 0, 0);
      return;
    }
    // move
    const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const s = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    const depth = Math.max(this.hf.waterLevel(this.pos.x, this.pos.z) - this.pos.y, 0);
    this.inWater = depth;
    let speed = (run ? 3.3 : 1.55) * slow * (depth > 0.05 ? 0.55 : 1);
    const wish = new Vector2(s, -f);
    if (wish.lengthSq() > 1) wish.normalize();
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const tx = (wish.x * cy + wish.y * sy) * speed;
    const tz = (-wish.x * sy + wish.y * cy) * speed;
    const k = 1 - Math.exp(-dt * 10);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    const next = this.pos.clone();
    next.x += this.vel.x * dt;
    next.z += this.vel.z * dt;
    this.collide(next, this.pos.y);
    // boundaries of the chapter: gently hold the player inside
    const b = this.bounds;
    this.blockedMsg = null;
    if (next.x < b.x0 || next.x > b.x1 || next.z < b.z0 || next.z > b.z1) {
      next.x = MathUtils.clamp(next.x, b.x0, b.x1);
      next.z = MathUtils.clamp(next.z, b.z0, b.z1);
      this.blockedMsg = '再往前就是密林了。浩的相册里没有那边的照片。';
    }
    let gy = this.groundAt(next.x, next.z, this.pos.y);
    const ndepth = this.hf.waterLevel(next.x, next.z) - this.hf.height(next.x, next.z);
    const rise = gy - this.pos.y;
    const horiz = Math.hypot(next.x - this.pos.x, next.z - this.pos.z) + 1e-6;
    if (ndepth > 0.62) {
      // too deep: stay on the bank
      this.blockedMsg = '水太深了。';
      next.x = this.pos.x;
      next.z = this.pos.z;
      gy = this.groundAt(next.x, next.z, this.pos.y);
    } else if (rise > STEP_UP && rise / horiz > 1.2) {
      next.x = this.pos.x;
      next.z = this.pos.z;
      gy = this.groundAt(next.x, next.z, this.pos.y);
    }
    const moved = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
    this.pos.x = next.x;
    this.pos.z = next.z;
    // smooth vertical follow (stairs / stones) but never sink into the ground
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 14));
    if (this.pos.y < gy - 0.05) this.pos.y = gy - 0.05;

    // head bob + footsteps
    const sp = moved / Math.max(dt, 1e-4);
    this.bobAmp += ((sp > 0.2 ? Math.min(sp / 3.3, 1) : 0) - this.bobAmp) * (1 - Math.exp(-dt * 6));
    this.bob += moved * (run ? 2.0 : 2.4);
    this.stepDist += moved;
    if (this.stepDist > (run ? 0.95 : 0.72)) {
      this.stepDist = 0;
      this.onStep?.(this.inWater > 0.05 ? 'water' : this.surface, run);
    }
  }

  /** Apply the pose to a camera. */
  apply(camera, { steady = false } = {}) {
    const bobY = steady ? 0 : Math.sin(this.bob * 2) * 0.022 * this.bobAmp;
    const bobX = steady ? 0 : Math.cos(this.bob) * 0.012 * this.bobAmp;
    camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, bobX * 0.4);
    camera.translateX(bobX);
    camera.updateMatrixWorld();
  }

  forward(out = new Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}
