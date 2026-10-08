import {
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector2,
} from 'three';
import { GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';

/** Back-lit translucency for thin foliage (uses the directional light + its shadow). */
export const TRANSLUCENCY_GLSL = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  DirectionalLight dl0 = directionalLights[0];
  float sh0 = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow ds0 = directionalLightShadows[0];
    sh0 = receiveShadow ? getShadow(directionalShadowMap[0], ds0.shadowMapSize, ds0.shadowIntensity, ds0.shadowBias, ds0.shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
  #endif
  vec3 Lt = dl0.direction;
  float back = pow(clamp(dot(geometryViewDir, -Lt), 0.0, 1.0), 4.0);
  float through = clamp(dot(-geometryNormal, Lt), 0.0, 1.0);
  reflectedLight.directDiffuse += dl0.color * sh0 * diffuseColor.rgb * uTranslucency * (back * 2.2 + through * 0.6) * (1.0 - 0.75 * uNight);
}
#endif
`;

/**
 * A tuft of thin blades sharing one instance. Per-vertex attribute aLocal holds
 * the blade's offset from the tuft centre (xy), its yaw (z) and height factor (w).
 */
function tuftGeometry(blades, segments, seed) {
  const pos = [];
  const loc = [];
  const idx = [];
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.9;
    const r = 0.015 + rnd() * 0.05;
    const ox = Math.cos(a) * r;
    const oz = Math.sin(a) * r;
    const yaw = a + (rnd() - 0.5) * 1.2;
    const hf = b === 0 ? 1.0 : 0.45 + rnd() * 0.55;
    const base = pos.length / 3;
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      pos.push(-0.5, t, 0, 0.5, t, 0);
      loc.push(ox, oz, yaw, hf, ox, oz, yaw, hf);
    }
    pos.push(0, 1, 0);
    loc.push(ox, oz, yaw, hf);
    for (let i = 0; i < segments - 1; i++) {
      const q = base + i * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    const last = base + (segments - 1) * 2;
    idx.push(last, last + 1, base + segments * 2);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).fill(0), 3));
  g.setAttribute('aLocal', new BufferAttribute(new Float32Array(loc), 4));
  g.setIndex(idx);
  return g;
}

/** A small white wild flower: five petals around a yellow centre on a stem. */
function flowerGeometry() {
  const pos = [];
  const col = [];
  const idx = [];
  const add = (x, y, z, c) => {
    pos.push(x, y, z);
    col.push(...c);
    return pos.length / 3 - 1;
  };
  const white = [0.82, 0.82, 0.78];
  const yellow = [0.75, 0.55, 0.08];
  const stem = [0.08, 0.16, 0.04];
  // stem (two crossed thin quads), y = height fraction 0..1
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * 0.004;
    const dz = Math.sin(a) * 0.004;
    const i0 = add(-dx, 0, -dz, stem);
    const i1 = add(dx, 0, dz, stem);
    const i2 = add(dx, 0.97, dz, stem);
    const i3 = add(-dx, 0.97, -dz, stem);
    idx.push(i0, i1, i2, i0, i2, i3);
  }
  const c = add(0, 1.0, 0, yellow);
  const ring = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ring.push(add(Math.cos(a) * 0.006, 1.0, Math.sin(a) * 0.006, yellow));
  }
  for (let k = 0; k < 6; k++) idx.push(c, ring[(k + 1) % 6], ring[k]);
  for (let p = 0; p < 6; p++) {
    const a = (p / 6) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.0065;
    const L = 0.022;
    const b0 = add(ca * 0.004 - sa * w * 0.5, 0.995, sa * 0.004 + ca * w * 0.5, white);
    const b1 = add(ca * 0.004 + sa * w * 0.5, 0.995, sa * 0.004 - ca * w * 0.5, white);
    const t0 = add(ca * L + sa * w, 0.985, sa * L - ca * w, white);
    const t1 = add(ca * L - sa * w, 0.985, sa * L + ca * w, white);
    idx.push(b0, b1, t0, b0, t0, t1);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).fill(0), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  return g;
}

const PATCH_HEAD = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_COMMON}
attribute vec3 aBlade;
attribute vec4 aLocal;
uniform float uPatch;
uniform vec4 uFade;      // fade-in start/end, fade-out start/end (distance from camera)
uniform sampler2D tHeight;
uniform sampler2D tMasks;
uniform float uTSize;
uniform float uDensity;
uniform vec2 uBladeH;
uniform vec2 uBladeW;
varying vec3 vGCol;
varying float vGT;
`;

const BLADE_MAIN = /* glsl */ `
  vec2 cam = cameraPosition.xz;
  vec2 rel = mod(aBlade.xy - cam, uPatch) - 0.5 * uPatch;
  vec2 tuft = cam + rel;
  float r1 = aBlade.z;
  float r2 = fract(r1 * 13.37 + 0.123);
  float r3 = fract(r1 * 71.13 + 0.771);
  float r4 = fract(r1 * 31.71 + 0.417);
  float tuftScale = 0.75 + 0.6 * r3;
  vec2 wxz = tuft + aLocal.xy * tuftScale * 1.6;
  vec2 tuv = tuft / uTSize + 0.5;
  vec4 mk = textureLod(tMasks, tuv, 0.0);
  float dens = mk.r * uDensity;
  float dcam = length(rel);
  float fade = smoothstep(uFade.x, uFade.y, dcam) * smoothstep(uFade.w, uFade.z, dcam);
  float keep = step(r2, dens) * fade;
  float gy = textureLod(tHeight, wxz / uTSize + 0.5, 0.0).r - 0.04;
  float patchH = 0.6 + 0.8 * vnoise(tuft * 0.18 + 17.0);
  float H = mix(uBladeH.x, uBladeH.y, r1 * r1) * aLocal.w * patchH * (0.55 + 0.45 * mk.r) * keep;
  float Wd = mix(uBladeW.x, uBladeW.y, fract(r3 * 7.0 + aLocal.w)) * step(0.001, keep);
  float ang = aLocal.z + r4 * 6.2831853;
  vec2 odir = normalize(aLocal.xy + 1e-4);
  odir = vec2(odir.x * cos(r4 * 6.2831853) - odir.y * sin(r4 * 6.2831853), odir.x * sin(r4 * 6.2831853) + odir.y * cos(r4 * 6.2831853));
  vec2 fdir = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-fdir.y, fdir.x);
  float t = position.y;
  float gust = windGust(wxz);
  vec2 wind = uWind.xy * (gust * 0.95 + 0.08) + uWind.xy * sin(uTime * 2.6 + r1 * 40.0 + aLocal.z * 3.0 + dot(wxz, vec2(0.7, 0.5))) * 0.08 * uWind.z;
  vec2 lean = odir * (0.25 + 0.45 * (1.0 - aLocal.w)) + wind;
  vec2 toP = wxz - uPlayer.xz;
  float pd = length(toP);
  lean += (toP / max(pd, 1e-3)) * smoothstep(0.8, 0.05, pd) * 1.2 * step(uPlayer.y - 2.2, gy);
  float ll = min(length(lean), 1.4);
  float bendY = H * t * (1.0 - 0.4 * ll * t);
  vec2 bendXZ = lean * H * t * t;
  float halfW = Wd * 0.5 * (1.0 - pow(t, 1.5));
  vec3 gpos = vec3(wxz.x, gy, wxz.y) + vec3(bendXZ.x, bendY, bendXZ.y) + vec3(side.x, 0.0, side.y) * position.x * 2.0 * halfW;
  vec3 nB = normalize(vec3(fdir.x, 0.0, fdir.y) - vec3(lean.x, 0.0, lean.y) * t * 0.6 + vec3(side.x, 0.0, side.y) * position.x * 1.2);
  vec3 objectNormal = normalize(mix(nB, vec3(0.0, 1.0, 0.0), 0.6));
  float dry = clamp(smoothstep(0.55, 0.85, vnoise(tuft * 0.06 + 3.0)) * 0.6 + step(0.9, fract(r2 * 3.0 + aLocal.w)) * 0.6, 0.0, 1.0);
  vec3 cRoot = vec3(0.025, 0.05, 0.012);
  vec3 cTip = mix(vec3(0.15, 0.25, 0.045), vec3(0.34, 0.29, 0.12), dry);
  cTip = mix(cTip, vec3(0.08, 0.17, 0.035), smoothstep(0.3, 0.9, fract(r3 * 5.0 + aLocal.z)) * (1.0 - dry) * 0.65);
  vGCol = mix(cRoot, cTip, smoothstep(0.0, 0.8, t)) * (0.8 + 0.4 * fract(aLocal.z * 3.1 + r1));
  vGT = t;
`;

const FLOWER_MAIN = /* glsl */ `
  vec2 cam = cameraPosition.xz;
  vec2 rel = mod(aBlade.xy - cam, uPatch) - 0.5 * uPatch;
  vec2 wxz = cam + rel;
  float r1 = aBlade.z;
  float r2 = fract(r1 * 13.37 + 0.123);
  float r3 = fract(r1 * 71.13 + 0.771);
  vec2 tuv = wxz / uTSize + 0.5;
  vec4 mk = textureLod(tMasks, tuv, 0.0);
  float dcam = length(rel);
  float fade = smoothstep(uFade.w, uFade.z, dcam);
  float keep = step(r2, mk.g * uDensity) * fade;
  float gy = textureLod(tHeight, tuv, 0.0).r - 0.03;
  float H = mix(uBladeH.x, uBladeH.y, r1) * keep;
  float S = mix(0.8, 1.35, r3) * step(0.001, keep);
  float ang = r3 * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  vec2 wind = uWind.xy * (windGust(wxz) * 0.8 + 0.1) + vec2(sin(uTime * 3.1 + r1 * 30.0), cos(uTime * 2.7 + r1 * 20.0)) * 0.04 * uWind.z;
  float t = position.y;
  vec2 hp = vec2(position.x * ca - position.z * sa, position.x * sa + position.z * ca) * S * 1.6;
  vec3 gpos = vec3(wxz.x + hp.x + wind.x * H * t * t, gy + t * H, wxz.y + hp.y + wind.y * H * t * t);
  if (t < 0.97) gpos.xz = wxz + vec2(position.x * ca, position.x * sa) * S + wind * H * t * t;
  vec3 objectNormal = vec3(0.0, 1.0, 0.0);
  vGCol = vec3(0.85 + 0.3 * r1); // tinted by the vertex colours in color_fragment
  vGT = mix(0.4, 1.0, t);
`;

function patchMaterial(main, uniforms, { translucency = 0.6, rough = 0.5 } = {}) {
  const mat = new MeshStandardMaterial({ side: DoubleSide, roughness: rough, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    addShared(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PATCH_HEAD}`)
      .replace('#include <beginnormal_vertex>', main)
      .replace('#include <begin_vertex>', 'vec3 transformed = gpos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${GLSL_UNIFORMS}\nuniform float uTranslucency;\nvarying vec3 vGCol;\nvarying float vGT;`,
      )
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vGCol;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${TRANSLUCENCY_GLSL}\nreflectedLight.indirectDiffuse *= mix(0.5, 1.0, vGT);\nreflectedLight.directDiffuse *= mix(0.7, 1.0, vGT);`,
      );
    shader.uniforms.uTranslucency = { value: translucency };
  };
  return mat;
}

function makePatch({ geometry, count, size, seed, uniforms, main, material }) {
  const g = geometry.clone();
  const data = new Float32Array(count * 3);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // jittered grid for even coverage
  const n = Math.ceil(Math.sqrt(count));
  const cell = size / n;
  let k = 0;
  for (let j = 0; j < n && k < count; j++) {
    for (let i = 0; i < n && k < count; i++, k++) {
      data[k * 3] = (i + rnd()) * cell;
      data[k * 3 + 1] = (j + rnd()) * cell;
      data[k * 3 + 2] = rnd();
    }
  }
  g.setAttribute('aBlade', new InstancedBufferAttribute(data, 3));
  g.instanceCount = count;
  const mesh = new Mesh(g, material ?? patchMaterial(main, uniforms));
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Grass: a dense patch of individual blades around the camera, a sparser
 * patch of wider blades further out, and scattered white wild flowers. The
 * patches are toroidal: blades are fixed in the world and wrap around as the
 * camera moves, so there is no popping.
 */
export function createGrass(hf, masks, quality) {
  const base = {
    tHeight: { value: hf.heightTexture },
    tMasks: { value: masks },
    uTSize: { value: hf.size },
  };
  const nearSize = 46;
  const nearCount = Math.round(nearSize * nearSize * 15 * quality.grassNear);
  const nearU = {
    ...base,
    uPatch: { value: nearSize },
    uFade: { value: [-1, 0, 17, 22] },
    uDensity: { value: 1 },
    uBladeH: { value: new Vector2(0.22, 0.75) },
    uBladeW: { value: new Vector2(0.012, 0.026) },
  };
  const near = makePatch({ geometry: tuftGeometry(7, 4, 3), count: nearCount, size: nearSize, seed: 11, uniforms: nearU, main: BLADE_MAIN });
  near.name = 'grass-near';

  const farSize = 150;
  const farCount = Math.round(farSize * farSize * 1.6 * quality.grassFar);
  const farU = {
    ...base,
    uPatch: { value: farSize },
    uFade: { value: [16, 20, 58, 72] },
    uDensity: { value: 1 },
    uBladeH: { value: new Vector2(0.3, 0.75) },
    uBladeW: { value: new Vector2(0.06, 0.11) },
  };
  const far = makePatch({ geometry: tuftGeometry(3, 3, 5), count: farCount, size: farSize, seed: 23, uniforms: farU, main: BLADE_MAIN });
  far.name = 'grass-far';

  const flSize = 56;
  const flCount = Math.round(flSize * flSize * 7 * quality.grassNear);
  const flU = {
    ...base,
    uPatch: { value: flSize },
    uFade: { value: [0, 0, 22, 27] },
    uDensity: { value: 0.9 },
    uBladeH: { value: new Vector2(0.18, 0.42) },
    uBladeW: { value: new Vector2(1, 1) },
  };
  const flowerMat = patchMaterial(FLOWER_MAIN, flU, { translucency: 0.35, rough: 0.6 });
  flowerMat.vertexColors = true;
  const flowers = makePatch({ geometry: flowerGeometry(), count: flCount, size: flSize, seed: 37, uniforms: flU, material: flowerMat });
  flowers.name = 'flowers';

  return { near, far, flowers, meshes: [near, far, flowers] };
}
