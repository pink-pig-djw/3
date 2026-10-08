import { MathUtils, Raycaster, Vector3 } from 'three';

export const FOCALS = [24, 28, 35, 50, 70, 85, 105, 135, 200];
export const FSTOPS = [1.8, 2, 2.8, 4, 5.6, 8, 11, 16];
const SENSOR_H = 24; // mm, full frame
const COC = 0.03; // mm, acceptable circle of confusion

/** Vertical field of view (deg) of a full-frame lens. */
export function fovFor(focalMM) {
  return (2 * Math.atan(SENSOR_H / 2 / focalMM) * 180) / Math.PI;
}

/** Near / far limits of acceptable sharpness (m) for focus distance s (m). */
export function depthOfField(s, focalMM, N) {
  const f = focalMM / 1000;
  const c = COC / 1000;
  const H = (f * f) / (N * c) + f;
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s < H ? (s * (H - f)) / (H - s) : Infinity;
  return { near, far, hyperfocal: H };
}

/**
 * The old camera: zoom, aperture, autofocus on the centre point (or manual
 * focus), driving the physically based DOF pass and the lens field of view.
 */
export class DSLR {
  constructor(world, camera, dofPass) {
    this.world = world;
    this.camera = camera;
    this.dof = dofPass;
    this.raised = false;
    this.raiseT = 0;
    this.focalIndex = 2;
    this.focal = 35;
    this.fIndex = 2;
    this.focus = 6;
    this.focusTarget = 6;
    this.manual = false;
    this.afLocked = false;
    this.walkFov = 62;
    this.ray = new Raycaster();
    this.tmp = new Vector3();
    this.afTimer = 0;
    this.focusables = []; // extra objects for AF raycasts (subjects, props)
  }

  get fstop() {
    return FSTOPS[this.fIndex];
  }

  get targetFocal() {
    return FOCALS[this.focalIndex];
  }

  setRaised(v) {
    this.raised = v;
  }

  zoom(steps) {
    this.focalIndex = MathUtils.clamp(this.focalIndex + steps, 0, FOCALS.length - 1);
  }

  aperture(steps) {
    this.fIndex = MathUtils.clamp(this.fIndex + steps, 0, FSTOPS.length - 1);
  }

  manualFocus(steps) {
    this.manual = true;
    this.focusTarget = MathUtils.clamp(this.focusTarget * Math.pow(1.12, steps), 0.35, 400);
  }

  toggleAF() {
    this.manual = !this.manual;
  }

  /** Distance to whatever is under the centre of the frame. */
  measure() {
    const cam = this.camera;
    const origin = cam.getWorldPosition(new Vector3());
    const dir = cam.getWorldDirection(new Vector3());
    let best = this.world.hf.raycast(origin, dir, 600, 0.25);
    // water surface
    const wl = (t) => this.world.hf.waterLevel(origin.x + dir.x * t, origin.z + dir.z * t);
    if (dir.y < -0.01) {
      for (let t = 0.3; t < Math.min(best, 200); t += 0.25) {
        const y = origin.y + dir.y * t;
        if (y < wl(t) && y > this.world.hf.height(origin.x + dir.x * t, origin.z + dir.z * t)) {
          best = t;
          break;
        }
      }
    }
    // meshes that matter (rocks, trees, buildings, subjects)
    this.ray.set(origin, dir);
    this.ray.far = best;
    this.ray.layers.set(0);
    const hits = this.ray.intersectObjects(this.focusables, true);
    if (hits.length) best = Math.min(best, hits[0].distance);
    return Number.isFinite(best) ? best : 400;
  }

  update(dt) {
    this.raiseT = MathUtils.damp(this.raiseT, this.raised ? 1 : 0, 9, dt);
    this.focal = MathUtils.damp(this.focal, this.targetFocal, 10, dt);
    const fov = MathUtils.lerp(this.walkFov, fovFor(this.focal), this.raiseT);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.near = this.raised ? 0.05 : 0.1;
      this.camera.updateProjectionMatrix();
    }
    if (this.raised && !this.manual) {
      this.afTimer -= dt;
      if (this.afTimer <= 0) {
        this.focusTarget = this.measure();
        this.afTimer = 0.12;
      }
    }
    // focus motor
    const k = 1 - Math.exp(-dt * (this.manual ? 14 : 7));
    this.focus = Math.exp(MathUtils.lerp(Math.log(this.focus), Math.log(this.focusTarget), k));
    this.afLocked = Math.abs(Math.log(this.focus / this.focusTarget)) < 0.03;
    // drive the DOF pass
    this.dof.enabled = this.raiseT > 0.02;
    this.dof.focal = this.focal;
    this.dof.fstop = this.fstop;
    this.dof.focus = this.focus;
  }

  /** Is a point at distance d (m) acceptably sharp right now? */
  inFocus(d) {
    const { near, far } = depthOfField(this.focus, this.focal, this.fstop);
    const tol = 0.12;
    return d > near * (1 - tol) && d < far * (1 + tol);
  }

  info() {
    const { near, far } = depthOfField(this.focus, this.focal, this.fstop);
    return { focal: this.targetFocal, fstop: this.fstop, focus: this.focus, near, far, manual: this.manual, locked: this.afLocked };
  }
}
