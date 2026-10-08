import { Color, DirectionalLight, Fog, MathUtils, Object3D, Vector3 } from 'three';
import { dirFromAngles, skyRadiance, transmittance } from './atmosphere.js';
import { G } from './shaderlib.js';
import { Sky } from './sky.js';

export const TIMES = ['afternoon', 'golden', 'blue', 'night'];
export const TIME_LABELS = { afternoon: '午后', golden: '黄金时刻', blue: '蓝调时刻', night: '夜晚' };

/**
 * Key states. The sky itself is computed physically from the sun/moon
 * position; the rest are artistic controls interpolated between keys.
 */
const PRESETS = {
  afternoon: {
    sunAz: 222, sunEl: 36, moonAz: 110, moonEl: -20,
    haze: 1.15, cloud: 0.34, stars: 0, fog: 0.0030, fogFall: 0.075,
    exposure: 0.62, lanterns: 0, wind: 0.42, warmth: 0.0, sat: 1.04, contrast: 1.02,
  },
  golden: {
    sunAz: 291, sunEl: 5.5, moonAz: 100, moonEl: -8,
    haze: 2.1, cloud: 0.42, stars: 0, fog: 0.0055, fogFall: 0.07,
    exposure: 0.95, lanterns: 0.08, wind: 0.3, warmth: 0.08, sat: 1.08, contrast: 1.04,
  },
  blue: {
    sunAz: 299, sunEl: -4.6, moonAz: 62, moonEl: 3,
    haze: 1.5, cloud: 0.36, stars: 0.3, fog: 0.0065, fogFall: 0.08,
    exposure: 6.5, lanterns: 1, wind: 0.2, warmth: -0.04, sat: 1.0, contrast: 1.03,
  },
  night: {
    sunAz: 320, sunEl: -26, moonAz: 28, moonEl: 24,
    haze: 1.05, cloud: 0.22, stars: 1, fog: 0.005, fogFall: 0.085,
    exposure: 13.0, lanterns: 1, wind: 0.18, warmth: -0.06, sat: 0.9, contrast: 1.05,
  },
};

const SUN_I = 22; // sky scattering intensity of the sun
const MOON_I = 0.8; // ... and of the moon (not physical: keeps values in half-float range)
const SUN_E = 5.2; // irradiance scale of the directional light
const SUN_DISK = 1400;
const MOON_DISK = 26;

function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export class TimeOfDay {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky(renderer, { envSize: quality.envSize });
    scene.add(this.sky.dome);

    this.light = new DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(quality.shadowMap, quality.shadowMap);
    s.camera.near = 1;
    s.camera.far = 600;
    this.shadowExtent = quality.shadowExtent;
    s.camera.left = -this.shadowExtent;
    s.camera.right = this.shadowExtent;
    s.camera.top = this.shadowExtent;
    s.camera.bottom = -this.shadowExtent;
    s.bias = -0.0002;
    s.normalBias = 0.035;
    s.radius = 2;
    this.light.target = new Object3D();
    scene.add(this.light, this.light.target);

    scene.fog = new Fog(0xaabbcc, 0.003, 0.07);

    this.current = 'afternoon';
    this.state = { ...PRESETS.afternoon };
    this.from = null;
    this.to = null;
    this.t = 1;
    this.duration = 1;
    this.envTimer = 0;
    this.dirty = true;
    this.exposure = this.state.exposure;
    this.sunDir = new Vector3();
    this.moonDir = new Vector3();
    this.lightDir = new Vector3();
    this.lightIsMoon = false;
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  set(name, duration = 0) {
    if (!PRESETS[name]) return;
    if (duration <= 0) {
      this.state = { ...PRESETS[name] };
      this.t = 1;
      this.from = this.to = null;
    } else {
      this.from = { ...this.state };
      this.to = { ...PRESETS[name] };
      this.t = 0;
      this.duration = duration;
    }
    this.current = name;
    this.dirty = true;
    this.listeners.forEach((fn) => fn(name));
  }

  get transitioning() {
    return this.t < 1;
  }

  update(dt, focus) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = MathUtils.smootherstep(this.t, 0, 1);
      const a = this.from;
      const b = this.to;
      for (const key of Object.keys(b)) {
        if (key === 'sunAz' || key === 'moonAz') this.state[key] = lerpAngle(a[key], b[key], k);
        else if (key === 'exposure') this.state[key] = Math.exp(MathUtils.lerp(Math.log(a[key]), Math.log(b[key]), k));
        else this.state[key] = MathUtils.lerp(a[key], b[key], k);
      }
      this.dirty = true;
    }
    const u = this.sky.uniforms;
    u.uTime.value += dt;
    u.uCloudOffset.value.x += dt * 0.0016 * (0.4 + this.state.wind);
    u.uCloudOffset.value.y += dt * 0.0009 * (0.4 + this.state.wind);

    if (this.dirty) this.applyState();

    // environment map: every frame while the light changes, otherwise slowly (moving clouds)
    this.envTimer -= dt;
    if (this.dirty || this.envTimer <= 0) {
      this.scene.environment = this.sky.updateEnvironment();
      this.envTimer = this.transitioning ? 0.0 : 8.0;
      this.dirty = false;
    }

    this.updateShadowCamera(focus);
  }

  applyState() {
    const st = this.state;
    const u = this.sky.uniforms;
    const sun = dirFromAngles(st.sunAz, st.sunEl);
    const moon = dirFromAngles(st.moonAz, st.moonEl);
    this.sunDir.set(...sun);
    this.moonDir.set(...moon);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    const sunVis = MathUtils.smoothstep(st.sunEl, -6, 0.5);
    const moonVis = MathUtils.smoothstep(st.moonEl, -3, 4) * (1 - MathUtils.smoothstep(st.sunEl, -8, 2));
    u.uSunI.value = st.sunEl > -18 ? SUN_I : 0;
    u.uMoonI.value = MOON_I * moonVis;
    u.uHaze.value = st.haze;
    u.uCloudCover.value = st.cloud;
    u.uStars.value = st.stars;

    const ts = transmittance(sun, st.haze);
    const tm = transmittance(moon, st.haze);
    u.uSunDisk.value.set(ts[0], ts[1], ts[2]).multiplyScalar(SUN_DISK * sunVis);
    u.uMoonDisk.value.set(tm[0] * 0.95, tm[1], tm[2] * 1.06).multiplyScalar(MOON_DISK * MathUtils.smoothstep(st.moonEl, -2, 3));

    // sky light estimate for clouds, ground and fog
    const zen = this.radiance([0, 1, 0]);
    const hz = [0, 0, 0];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = this.radiance([Math.sin(a), 0.06, -Math.cos(a)]);
      for (let k = 0; k < 3; k++) hz[k] += r[k] / 6;
    }
    const skyE = (zen[0] + zen[1] + zen[2]) / 3;
    u.uCloudAmb.value.set(zen[0] * 0.55 + hz[0] * 0.6, zen[1] * 0.55 + hz[1] * 0.6, zen[2] * 0.55 + hz[2] * 0.6);
    const cloudSunVis = MathUtils.smoothstep(st.sunEl, -3.5, 1.0);
    u.uCloudSun.value.set(ts[0], ts[1], ts[2]).multiplyScalar(SUN_I * 0.09 * cloudSunVis);
    if (st.sunEl < -3 && moonVis > 0) {
      u.uCloudSun.value.set(tm[0], tm[1], tm[2]).multiplyScalar(MOON_I * 0.09 * moonVis);
    }
    u.uGround.value.set(hz[0] * 0.28, hz[1] * 0.3, hz[2] * 0.26);

    // directional light: sun while it is up, the moon at night
    const sunUp = st.sunEl > -1.5;
    this.lightIsMoon = !sunUp;
    const dir = sunUp ? this.sunDir : this.moonDir;
    this.lightDir.copy(dir);
    const tr = sunUp ? ts : tm;
    const amount = sunUp ? SUN_E * MathUtils.smoothstep(st.sunEl, -1.5, 2.5) : SUN_E * (MOON_I / SUN_I) * 1.6 * moonVis;
    this.light.color.setRGB(tr[0], tr[1], tr[2]);
    const lum = 0.2126 * tr[0] + 0.7152 * tr[1] + 0.0722 * tr[2];
    this.light.color.multiplyScalar(1 / Math.max(lum, 1e-3));
    this.light.intensity = amount * lum;
    this.light.castShadow = this.light.intensity > 0.02;

    // fog: in-scattered horizon colour
    const fogCol = new Color(hz[0], hz[1], hz[2]).multiplyScalar(0.92);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.near = st.fog;
    this.scene.fog.far = st.fogFall;

    this.exposure = st.exposure;
    G.uSunDirW.value.copy(dir);
    G.uSunColor.value.set(this.light.color.r, this.light.color.g, this.light.color.b).multiplyScalar(this.light.intensity);
    G.uNight.value = MathUtils.smoothstep(-st.sunEl, 2, 10);
    G.uLanterns.value = st.lanterns;
    G.uWind.value.z = st.wind;
    this.skyE = skyE;
    this.horizon = hz;
  }

  radiance(dir) {
    const st = this.state;
    const sun = dirFromAngles(st.sunAz, st.sunEl);
    const moon = dirFromAngles(st.moonAz, st.moonEl);
    const out = [0, 0, 0];
    const u = this.sky.uniforms;
    if (u.uSunI.value > 0) {
      const r = skyRadiance(dir, sun, u.uSunI.value, st.haze);
      for (let k = 0; k < 3; k++) out[k] += r[k];
    }
    if (u.uMoonI.value > 0) {
      const r = skyRadiance(dir, moon, u.uMoonI.value, st.haze);
      for (let k = 0; k < 3; k++) out[k] += r[k];
    }
    return out;
  }

  updateShadowCamera(focus) {
    if (!focus) return;
    const L = this.light;
    const cam = L.shadow.camera;
    // centre the shadow box a bit ahead of the viewer, snapped to shadow texels
    const center = focus.clone();
    const texel = (this.shadowExtent * 2) / L.shadow.mapSize.x;
    const dir = this.lightDir.clone().normalize();
    const up = Math.abs(dir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(up, dir).normalize();
    const up2 = new Vector3().crossVectors(dir, right);
    const x = Math.round(center.dot(right) / texel) * texel;
    const y = Math.round(center.dot(up2) / texel) * texel;
    const z = center.dot(dir);
    const snapped = right.multiplyScalar(x).add(up2.multiplyScalar(y)).add(dir.clone().multiplyScalar(z));
    L.target.position.copy(snapped);
    L.position.copy(snapped).addScaledVector(dir, 250);
    L.target.updateMatrixWorld();
    L.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }
}
