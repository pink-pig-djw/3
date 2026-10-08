import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  Vector3,
} from 'three';
import { GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';

/** CPU side height / water queries (collision, placement, gameplay). */
export class Heightfield {
  constructor(meta, heights, water, farHeights) {
    this.size = meta.size;
    this.res = meta.res;
    this.h = heights;
    this.wres = meta.waterRes;
    this.w = water;
    this.farSize = meta.farSize;
    this.farRes = meta.farRes;
    this.far = farHeights;
    this.cell = this.size / (this.res - 1);
  }

  static bilinear(arr, res, size, x, z) {
    const cell = size / (res - 1);
    let gx = (x + size / 2) / cell;
    let gz = (z + size / 2) / cell;
    gx = Math.min(Math.max(gx, 0), res - 1.0001);
    gz = Math.min(Math.max(gz, 0), res - 1.0001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * res + ix;
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + res];
    const d = arr[i + res + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  height(x, z) {
    if (Math.abs(x) < this.size / 2 && Math.abs(z) < this.size / 2) {
      return Heightfield.bilinear(this.h, this.res, this.size, x, z);
    }
    return Heightfield.bilinear(this.far, this.farRes, this.farSize, x, z);
  }

  waterLevel(x, z) {
    return Heightfield.bilinear(this.w, this.wres, this.size, x, z);
  }

  /** Water depth at (x, z): > 0 when the ground is under water. */
  waterDepth(x, z) {
    return this.waterLevel(x, z) - this.height(x, z);
  }

  normal(x, z, out = new Vector3()) {
    const e = this.cell;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** March a ray against the terrain. Returns distance or Infinity. */
  raycast(origin, dir, maxDist = 400, step = 0.5) {
    let prev = 0;
    let prevD = origin.y - this.height(origin.x, origin.z);
    if (prevD < 0) return 0;
    for (let t = step; t < maxDist; t += step * (1 + t * 0.02)) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const d = y - this.height(x, z);
      if (d < 0) {
        // refine
        let a = prev;
        let b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          const yy = origin.y + dir.y * m;
          if (yy - this.height(origin.x + dir.x * m, origin.z + dir.z * m) < 0) b = m;
          else a = m;
        }
        return (a + b) / 2;
      }
      prev = t;
      prevD = d;
    }
    return Infinity;
  }

  floatTexture(arr, res) {
    const t = new DataTexture(arr, res, res, RedFormat, FloatType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  get heightTexture() {
    this._ht ??= this.floatTexture(this.h, this.res);
    return this._ht;
  }

  get waterTexture() {
    this._wt ??= this.floatTexture(this.w, this.wres);
    return this._wt;
  }
}

function gridGeometry(hf, arr, res, size, skipInner = 0) {
  const n = res * res;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const cell = size / (res - 1);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const x = -size / 2 + i * cell;
      const z = -size / 2 + j * cell;
      pos[k * 3] = x;
      pos[k * 3 + 1] = arr[k];
      pos[k * 3 + 2] = z;
      const l = arr[j * res + Math.max(i - 1, 0)];
      const r = arr[j * res + Math.min(i + 1, res - 1)];
      const d = arr[Math.max(j - 1, 0) * res + i];
      const u = arr[Math.min(j + 1, res - 1) * res + i];
      let nx = l - r;
      let ny = 2 * cell;
      let nz = d - u;
      const len = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / len;
      nor[k * 3 + 1] = ny / len;
      nor[k * 3 + 2] = nz / len;
      uv[k * 2] = i / (res - 1);
      uv[k * 2 + 1] = j / (res - 1);
    }
  }
  const idx = [];
  const lim = skipInner;
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      if (skipInner > 0) {
        const x0 = -size / 2 + i * cell;
        const z0 = -size / 2 + j * cell;
        const x1 = x0 + cell;
        const z1 = z0 + cell;
        if (x0 > -lim && x1 < lim && z0 > -lim && z1 < lim) continue;
      }
      const a = j * res + i;
      const b = a + 1;
      const c = a + res;
      const d = c + 1;
      // alternate the diagonal to avoid directional artefacts
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// layers in the texture arrays
export const TERRAIN_LAYERS = ['grass', 'path', 'riverbed', 'forest', 'rock', 'moss'];

const TERRAIN_FRAG_HEAD = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_COMMON}
uniform highp sampler2DArray tAlb;
uniform highp sampler2DArray tNrm;
uniform highp sampler2DArray tOrm;
uniform sampler2D tSplat;
uniform sampler2D tMasks;
uniform sampler2D tWater;
uniform float uSize;
uniform float uTile[6];
varying vec3 vTW;
varying vec3 vTN;

struct LayerS { vec3 alb; vec3 n; vec3 orm; };

LayerS sampleLayer(int i, vec2 wp) {
  vec2 uv = wp / uTile[i];
  vec3 L = vec3(uv, float(i));
  LayerS s;
  s.alb = texture(tAlb, L).rgb;
  s.n = texture(tNrm, L).xyz * 2.0 - 1.0;
  s.orm = texture(tOrm, L).rgb;
  return s;
}

// second, rotated and scaled sample to break up tiling
LayerS sampleLayer2(int i, vec2 wp) {
  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  vec2 uv = (R * wp) / (uTile[i] * 2.37) + 0.37;
  vec3 L = vec3(uv, float(i));
  LayerS s;
  s.alb = texture(tAlb, L).rgb;
  s.n = texture(tNrm, L).xyz * 2.0 - 1.0;
  s.n.xy = R * s.n.xy;
  s.orm = texture(tOrm, L).rgb;
  return s;
}

LayerS triplanarRock(vec3 p, vec3 N) {
  vec3 w = pow(abs(N), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float t = uTile[4];
  LayerS sx; LayerS sy; LayerS sz;
  vec3 Lx = vec3(p.zy / t, 4.0);
  vec3 Ly = vec3(p.xz / t, 4.0);
  vec3 Lz = vec3(p.xy / t, 4.0);
  vec3 ax = texture(tAlb, Lx).rgb, ay = texture(tAlb, Ly).rgb, az = texture(tAlb, Lz).rgb;
  vec3 nx = texture(tNrm, Lx).xyz * 2.0 - 1.0;
  vec3 ny = texture(tNrm, Ly).xyz * 2.0 - 1.0;
  vec3 nz = texture(tNrm, Lz).xyz * 2.0 - 1.0;
  vec3 ox = texture(tOrm, Lx).rgb, oy = texture(tOrm, Ly).rgb, oz = texture(tOrm, Lz).rgb;
  LayerS s;
  s.alb = ax * w.x + ay * w.y + az * w.z;
  s.orm = ox * w.x + oy * w.y + oz * w.z;
  // whiteout blend of world-space normals (returned in world space!)
  vec3 wnx = vec3(0.0, nx.y, nx.x) * sign(N.x);
  vec3 wny = vec3(ny.x, 0.0, ny.y) * sign(N.y);
  vec3 wnz = vec3(nz.x, nz.y, 0.0) * sign(N.z);
  s.n = normalize(N + wnx * w.x + wny * w.y + wnz * w.z);
  return s;
}

float caustics(vec2 p, float t) {
  vec2 q = p * 1.35;
  float n1 = vnoise(q + vec2(t * 0.31, t * 0.17) + 0.7 * vnoise(q * 1.7 - t * 0.23));
  float n2 = vnoise(q * 1.21 - vec2(t * 0.24, -t * 0.29) + 0.7 * vnoise(q * 2.1 + t * 0.19));
  float r = 1.0 - abs(n1 - n2);
  return pow(r, 9.0) * 2.2;
}
`;

const TERRAIN_FRAG_MAIN = /* glsl */ `
  vec2 wp = vTW.xz;
  vec2 suv = wp / uSize + 0.5;
  vec4 splat = texture(tSplat, suv);
  vec4 masks = texture(tMasks, suv);
  vec3 N = normalize(vTN);
  float slope = 1.0 - N.y;
  float breakup = fbm2(wp * 0.45);
  float rockW = clamp(max(masks.a, smoothstep(0.30, 0.52, slope + (breakup - 0.5) * 0.12)), 0.0, 1.0);
  float wsum = 0.0;
  float W[5];
  W[0] = splat.r; W[1] = splat.g; W[2] = splat.b; W[3] = splat.a; W[4] = rockW * 1.6;
  for (int i = 0; i < 4; i++) W[i] *= (1.0 - rockW);

  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);

  vec3 alb = vec3(0.0); vec3 nW = vec3(0.0); vec3 orm = vec3(0.0);
  float hmax = -1.0;
  float H[5];
  vec3 A[5]; vec3 NN[5]; vec3 O[5];
  float macro = vnoise(wp * 0.035) * 0.6 + vnoise(wp * 0.11) * 0.4;
  for (int i = 0; i < 5; i++) {
    H[i] = -1.0;
    if (W[i] < 0.004) continue;
    LayerS s;
    if (i == 4) {
      s = triplanarRock(vTW, N);
      NN[i] = s.n;
    } else {
      s = sampleLayer(i, wp);
      LayerS s2 = sampleLayer2(i, wp);
      float m = smoothstep(0.35, 0.65, macro);
      s.alb = mix(s.alb, s2.alb, m * 0.5);
      s.n = normalize(mix(s.n, s2.n, m * 0.5));
      s.orm = mix(s.orm, s2.orm, m * 0.5);
      NN[i] = normalize(T * s.n.x + B * s.n.y + N * s.n.z);
    }
    A[i] = s.alb; O[i] = s.orm;
    H[i] = s.orm.b + W[i] * 1.6;
    hmax = max(hmax, H[i]);
  }
  float depth = 0.22;
  for (int i = 0; i < 5; i++) {
    if (H[i] < -0.5) continue;
    float b = max(H[i] - hmax + depth, 0.0);
    alb += A[i] * b; nW += NN[i] * b; orm += O[i] * b; wsum += b;
  }
  alb /= max(wsum, 1e-4); orm /= max(wsum, 1e-4);
  nW = normalize(nW);

  // large scale colour variation: patches of drier / lusher ground
  float dry = smoothstep(0.35, 0.75, fbm2(wp * 0.02 + 3.1));
  alb *= mix(vec3(1.0), vec3(1.08, 1.02, 0.86), dry * splat.r * 0.8);
  alb *= 0.88 + 0.24 * macro;

  // wetness near and under the water
  float wl = texture(tWater, suv).r;
  float under = wl - vTW.y;
  float wet = clamp(max(masks.b * 0.75, smoothstep(0.35, -0.02, -under)), 0.0, 1.0);
  wet = max(wet, step(0.0, under));
  alb *= mix(1.0, 0.62, wet);
  float rough = mix(orm.g, 0.24, wet * 0.85);
  float caus = 0.0;
  if (under > 0.0) {
    float fade = smoothstep(0.0, 0.08, under) * exp(-under * 0.6);
    caus = caustics(wp, uTime) * fade * (1.0 - uNight);
    // algae tint on the stream bed
    alb *= mix(vec3(1.0), vec3(0.86, 0.93, 0.78), smoothstep(0.1, 0.8, under) * 0.5);
  }
  diffuseColor.rgb = alb;
  float tRough = rough;
  vec3 tNormalW = nW;
  float tAO = mix(1.0, orm.r, 0.85);
  float tCaustic = caus;
`;

export function createTerrainMaterial(maps, hf) {
  const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    addShared(shader, {
      tAlb: { value: maps.alb },
      tNrm: { value: maps.nrm },
      tOrm: { value: maps.orm },
      tSplat: { value: maps.splat },
      tMasks: { value: maps.masks },
      tWater: { value: hf.waterTexture },
      uSize: { value: hf.size },
      uTile: { value: maps.tiles },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_HEAD}`)
      .replace('#include <map_fragment>', TERRAIN_FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
      .replace(
        '#include <aomap_fragment>',
        'reflectedLight.indirectDiffuse *= tAO;\nreflectedLight.indirectSpecular *= tAO;',
      )
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 1.0 + tCaustic;',
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

const FAR_FRAG_MAIN = /* glsl */ `
  vec2 wp = vTW.xz;
  vec3 N = normalize(vTN);
  // forested hills seen from far away: crowns as noise
  float crowns = fbm2(wp * 0.11);
  float big = fbm2(wp * 0.008);
  vec3 c1 = vec3(0.045, 0.07, 0.03);
  vec3 c2 = vec3(0.085, 0.11, 0.045);
  vec3 alb = mix(c1, c2, smoothstep(0.3, 0.7, crowns));
  alb = mix(alb, vec3(0.13, 0.12, 0.07), smoothstep(0.55, 0.8, big) * 0.5);
  float rocky = smoothstep(0.55, 0.8, 1.0 - N.y);
  alb = mix(alb, vec3(0.22, 0.21, 0.19), rocky);
  // shore / sea bed below sea level
  alb = mix(alb, vec3(0.32, 0.29, 0.22), smoothstep(1.5, -0.5, vTW.y));
  diffuseColor.rgb = alb;
  float e = 1.6;
  float hx = fbm2((wp + vec2(e, 0.0)) * 0.11) - fbm2((wp - vec2(e, 0.0)) * 0.11);
  float hz = fbm2((wp + vec2(0.0, e)) * 0.11) - fbm2((wp - vec2(0.0, e)) * 0.11);
  vec3 tNormalW = normalize(N + vec3(-hx, 0.0, -hz) * 2.5 * (1.0 - rocky));
`;

export function createFarMaterial() {
  const mat = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    addShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_UNIFORMS}\n${GLSL_COMMON}\nvarying vec3 vTW;\nvarying vec3 vTN;`)
      .replace('#include <map_fragment>', FAR_FRAG_MAIN)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'far-terrain-v1';
  return mat;
}

export function createTerrain(hf, maps) {
  const near = new Mesh(gridGeometry(hf, hf.h, hf.res, hf.size), createTerrainMaterial(maps, hf));
  near.name = 'terrain';
  near.receiveShadow = true;
  near.castShadow = true;
  near.matrixAutoUpdate = false;
  const far = new Mesh(gridGeometry(hf, hf.far, hf.farRes, hf.farSize, hf.size / 2 - 20), createFarMaterial());
  far.name = 'terrain-far';
  far.receiveShadow = true;
  far.matrixAutoUpdate = false;
  return { near, far };
}
