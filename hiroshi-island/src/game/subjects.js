import { MathUtils, Raycaster, Vector3 } from 'three';
import { FEEDBACK, SUBJECTS } from './story.js';
import { TIME_LABELS } from '../world/timeofday.js';
import { G } from '../world/shaderlib.js';

const THIRDS = [
  [-1 / 3, -1 / 3],
  [1 / 3, -1 / 3],
  [-1 / 3, 1 / 3],
  [1 / 3, 1 / 3],
];

/**
 * Judges a photograph against Hiroshi's notes: is the subject in the frame,
 * big enough, unobstructed, inside the depth of field, under the right light,
 * and (for three stars) composed on a third or dead centre.
 */
export class Subjects {
  constructor(world, life, dslr) {
    this.world = world;
    this.life = life;
    this.dslr = dslr;
    this.ray = new Raycaster();
    this.byId = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
    const L = world.layout;
    const H = L.house;
    this.houseCenter = new Vector3(H.x, H.floor + 1.4, H.z);
    this.culvertCenter = new Vector3(L.culvert.x, L.culvert.spring + 0.9, L.culvert.z);
    this.pool = L.pool;
    this.occluders = [];
  }

  /** Candidate targets for each subject id. Each: { pos, radius, minSize, extra? } */
  targets(camera, timeName, player) {
    const t = {};
    const life = this.life;
    // any of the trout in the pool
    t.fish = life.fish.map((f) => ({ pos: f.pos.clone(), radius: 0.13 * f.s, minSize: 0.028, water: true }));
    const inStream = this.world.hf.waterDepth(player.pos.x, player.pos.z) > 0.0;
    t.view = [
      { pos: this.culvertCenter.clone(), radius: 2.0, minSize: 0.05, require: () => inStream, why: FEEDBACK.where, group: 'view' },
      { pos: this.houseCenter.clone(), radius: 3.6, minSize: 0.05, require: () => inStream, why: FEEDBACK.where, group: 'view' },
    ];
    if (timeName === 'afternoon' || timeName === 'golden') t.dragonfly = [{ pos: life.dragonfly.pos.clone(), radius: 0.07, minSize: 0.028 }];
    t.culvert = [{ pos: this.culvertCenter.clone(), radius: 3.2, minSize: 0.16, require: () => camera.position.z > this.culvertCenter.z + 1.0 }];
    t.furin = [{ pos: life.furinPos.clone().add(new Vector3(0, -0.12, 0)), radius: 0.14, minSize: 0.03 }];
    t.bench = [{ pos: life.hat.position.clone().add(new Vector3(0, 0.05, 0)), radius: 0.32, minSize: 0.04 }];
    const toros = life.toros.filter((x) => x.obj.visible).map((x) => ({ pos: x.obj.position.clone().add(new Vector3(0, 0.13, 0)), radius: 0.17, minSize: 0.022 }));
    if (toros.length) t.toro = toros;
    t.window = [{ pos: this.houseCenter.clone(), radius: 3.6, minSize: 0.08, require: () => camera.position.distanceTo(this.houseCenter) > 6, why: '退远一点，把整间屋子拍进来。' }];
    if (G.uNight.value > 0.6) t.fireflies = [{ fireflies: true }];
    t.moon = [{ moon: true }];
    return t;
  }

  occluded(camera, pos, radius) {
    const origin = camera.position;
    const dir = pos.clone().sub(origin);
    const dist = dir.length();
    dir.divideScalar(dist);
    const th = this.world.hf.raycast(origin, dir, dist, 0.2);
    if (th < dist - radius - 0.3) return true;
    this.ray.set(origin, dir);
    this.ray.far = Math.max(dist - radius * 1.1, 0.01);
    const hits = this.ray.intersectObjects(this.occluders, true);
    return hits.length > 0;
  }

  evalTarget(tg, camera, fovRad) {
    const v = tg.pos.clone().project(camera);
    if (v.z > 1 || v.z < -1) return { inFrame: false };
    // normalise to the 3:2 viewfinder rectangle
    v.x /= this.frame.sx;
    v.y = (v.y - this.frame.oy) / this.frame.sy;
    const dist = tg.pos.distanceTo(camera.position);
    const size = (2 * Math.atan(tg.radius / dist)) / (fovRad * this.frame.sy);
    const inFrame = Math.abs(v.x) < 1.0 && Math.abs(v.y) < 1.0;
    const nearEdge = Math.abs(v.x) > 0.86 || Math.abs(v.y) > 0.86;
    return { inFrame, nearEdge, v, dist, size };
  }

  judge(camera, timeName, player, frame = { sx: 1, sy: 1 }) {
    this.frame = { sx: frame.sx, sy: frame.sy, oy: frame.oy ?? 0 };
    const fovRad = MathUtils.degToRad(camera.fov);
    const all = this.targets(camera, timeName, player);
    const results = [];
    for (const s of SUBJECTS) {
      const list = all[s.id];
      if (!list) continue;
      let r = null;
      if (s.id === 'fireflies') r = this.judgeFireflies(camera);
      else if (s.id === 'moon') r = this.judgeMoon(camera);
      else if (s.id === 'view') r = this.judgeGroup(list, camera, fovRad);
      else {
        for (const tg of list) {
          const e = this.evalTarget(tg, camera, fovRad);
          if (!e.inFrame) continue;
          const c = this.score(tg, e, camera);
          if (!r || c.stars > r.stars || (c.stars === r.stars && c.size > r.size)) r = c;
        }
      }
      if (!r) continue;
      r.id = s.id;
      if (s.time !== timeName) {
        r.msg = FEEDBACK.wrongTime(TIME_LABELS[s.time]);
        r.stars = Math.min(r.stars, 0);
        r.wrongTime = true;
      }
      results.push(r);
    }
    if (!results.length) return null;
    // prefer subjects of the current light; wrong-time hints only if nothing else fits
    results.sort((a, b) => (a.wrongTime ? 1 : 0) - (b.wrongTime ? 1 : 0) || b.stars - a.stars || b.weight - a.weight);
    return results[0];
  }

  score(tg, e, camera) {
    const out = { stars: 0, size: e.size, weight: e.size, msg: '' };
    if (tg.require && !tg.require()) {
      out.msg = tg.why || FEEDBACK.small;
      return out;
    }
    if (e.size < tg.minSize * 0.55) {
      out.msg = FEEDBACK.small;
      return out;
    }
    if (this.occluded(camera, tg.pos, tg.radius)) {
      out.msg = FEEDBACK.hidden;
      return out;
    }
    out.stars = 1;
    out.msg = FEEDBACK.stars[1];
    if (!this.dslr.inFocus(e.dist)) {
      out.msg = FEEDBACK.blur;
      return out;
    }
    if (e.size < tg.minSize) {
      out.msg = FEEDBACK.small;
      return out;
    }
    out.stars = 2;
    out.msg = e.nearEdge ? FEEDBACK.edge : FEEDBACK.stars[2];
    const third = THIRDS.some(([x, y]) => Math.hypot(e.v.x - x * 1.0, e.v.y - y * 1.0) < 0.2);
    const centred = Math.hypot(e.v.x, e.v.y) < 0.14;
    if (!e.nearEdge && (third || centred) && e.size < 0.85) {
      out.stars = 3;
      out.msg = FEEDBACK.stars[3];
    }
    return out;
  }

  judgeGroup(list, camera, fovRad) {
    const parts = list.map((tg) => [tg, this.evalTarget(tg, camera, fovRad)]);
    if (!parts.every(([, e]) => e.inFrame)) return parts.some(([, e]) => e.inFrame) ? { stars: 0, size: 0, weight: 0, msg: '把小屋和涵洞都放进画面里。' } : null;
    const scores = parts.map(([tg, e]) => this.score(tg, e, camera));
    const stars = Math.min(...scores.map((s) => s.stars));
    const worst = scores.find((s) => s.stars === stars);
    const r = { stars, size: Math.max(...scores.map((s) => s.size)), weight: 0.3, msg: worst.msg };
    if (stars >= 2) {
      // composition: the house above the culvert, both well inside the frame
      const [, a] = parts[0];
      const [, b] = parts[1];
      const stacked = b.v.y > a.v.y + 0.1;
      r.stars = stacked && !a.nearEdge && !b.nearEdge ? 3 : 2;
      r.msg = FEEDBACK.stars[r.stars];
    }
    return r;
  }

  judgeFireflies(camera) {
    const f = this.life.flies;
    const tt = G.uTime.value;
    let count = 0;
    let sharp = 0;
    const p = new Vector3();
    for (let i = 0; i < f.home.length; i++) {
      p.set(f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2]);
      const v = p.clone().project(camera);
      v.x /= this.frame.sx;
      v.y = (v.y - this.frame.oy) / this.frame.sy;
      if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) continue;
      const blink = Math.pow(Math.max(Math.sin(tt * f.data[i * 4 + 1] * 1.7 + f.data[i * 4]), 0), 6);
      if (blink < 0.05) continue;
      count++;
      if (this.dslr.inFocus(p.distanceTo(camera.position))) sharp++;
    }
    if (count === 0) return null;
    const r = { stars: 0, size: 0, weight: count / 30, msg: '' };
    if (count < 4) {
      r.msg = '萤火虫太少了，等它们多亮一些。';
      r.stars = count > 1 ? 1 : 0;
      return r;
    }
    if (sharp < 3) {
      r.stars = 1;
      r.msg = FEEDBACK.blur;
      return r;
    }
    r.stars = sharp >= 7 ? 3 : 2;
    r.msg = FEEDBACK.stars[r.stars];
    return r;
  }

  judgeMoon(camera) {
    const moon = this.world.time.moonDir;
    if (moon.y < 0.05) return null;
    const P = this.pool;
    const o = camera.position;
    if (o.y <= P.y) return null;
    // mirror image of the moon on the pool surface
    const dir = new Vector3(moon.x, -moon.y, moon.z);
    const tHit = (o.y - P.y) / moon.y;
    const hit = o.clone().addScaledVector(dir, tHit);
    const onPool = Math.hypot(hit.x - P.x, hit.z - P.z) < P.r;
    const v = hit.clone().project(camera);
    v.x /= this.frame.sx;
    v.y = (v.y - this.frame.oy) / this.frame.sy;
    const inFrame = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
    if (!inFrame) return null;
    if (!onPool) return { stars: 0, size: 0, weight: 0.2, msg: '月亮的倒影不在潭里。绕到深潭的另一边看看。' };
    const r = { stars: 2, size: 0.1, weight: 0.5, msg: FEEDBACK.stars[2] };
    const third = THIRDS.some(([x, y]) => Math.hypot(v.x - x, v.y - y) < 0.22);
    if (third || Math.abs(v.x) < 0.15) {
      r.stars = 3;
      r.msg = FEEDBACK.stars[3];
    }
    return r;
  }
}
