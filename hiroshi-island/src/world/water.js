import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshPhysicalMaterial,
  Vector2,
  Vector3,
} from 'three';
import { G, GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';

export const WATER_LAYER = 1;

/**
 * Build the stream surface as a ribbon following the centre line samples
 * exported by blender/terrain.py: [x, y(water level), z, width, depth].
 */
function buildRibbon(points, step) {
  const n = points.length;
  const across = 11;
  const pos = new Float32Array(n * across * 3);
  const uv = new Float32Array(n * across * 2);
  const flow = new Float32Array(n * across * 4); // dir.xz, speed, cascade
  const nor = new Float32Array(n * across * 3);
  let s = 0;
  const dir = new Vector2();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, n - 1)];
    dir.set(b[0] - a[0], b[2] - a[2]).normalize();
    if (i > 0) s += Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]);
    const half = p[3] * 0.5 + 1.6;
    // slope of the water surface -> cascades
    const dy = (a[1] - b[1]) / Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), 1e-3);
    const cascade = Math.min(Math.max((dy - 0.05) * 3.0, 0), 1);
    // discharge ~ constant: speed ~ Q / (width * depth)
    const speed = Math.min(0.55 / (p[3] * Math.max(p[4], 0.2)) + dy * 6.0 + 0.12, 3.2);
    for (let j = 0; j < across; j++) {
      const t = (j / (across - 1)) * 2 - 1;
      const k = i * across + j;
      const off = t * half;
      pos[k * 3] = p[0] - dir.y * off;
      pos[k * 3 + 1] = p[1];
      pos[k * 3 + 2] = p[2] + dir.x * off;
      uv[k * 2] = off;
      uv[k * 2 + 1] = s;
      // slower near the banks
      const edge = 1 - Math.pow(Math.min(Math.abs(off) / (p[3] * 0.5 + 0.2), 1), 2);
      flow[k * 4] = dir.x;
      flow[k * 4 + 1] = dir.y;
      flow[k * 4 + 2] = speed * (0.35 + 0.65 * edge);
      flow[k * 4 + 3] = cascade;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j;
      const b = a + 1;
      const c = a + across;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new BufferAttribute(flow, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const WATER_FRAG_HEAD = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_COMMON}
uniform sampler2D tRefr;     // rgb = scene colour without water, a = linear view depth
uniform sampler2D tRipples;
uniform sampler2D tFoam;
uniform vec2 uRes;
uniform vec3 uAbsorb;
uniform vec3 uScatter;
uniform float uSSR;
uniform mat4 uProj;
uniform vec2 uCulvert; // x, z of the culvert face
varying vec3 vWW;
varying vec4 vFlow;
varying vec2 vRUv;

vec3 sampleRipples(vec2 fuv, float speed, float scale, float phaseOffset) {
  float P = 1.4;
  float t = uTime / P + phaseOffset;
  float ph0 = fract(t);
  float ph1 = fract(t + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  vec2 o0 = vec2(0.0, -speed * ph0 * P);
  vec2 o1 = vec2(0.37, 0.21 - speed * ph1 * P);
  vec3 a = texture(tRipples, (fuv + o0) / scale).xyz * 2.0 - 1.0;
  vec3 b = texture(tRipples, (fuv + o1) / scale).xyz * 2.0 - 1.0;
  return a * w0 + b * (1.0 - w0);
}

float sampleFoam(vec2 fuv, float speed) {
  float P = 2.2;
  float t = uTime / P;
  float ph0 = fract(t);
  float ph1 = fract(t + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  vec4 a = texture(tFoam, (fuv + vec2(0.0, -speed * ph0 * P)) / vec2(1.6, 2.2));
  vec4 b = texture(tFoam, (fuv + vec2(0.5, 0.3 - speed * ph1 * P)) / vec2(1.6, 2.2));
  vec4 f = a * w0 + b * (1.0 - w0);
  return f.r * 0.7 + f.g * 0.5;
}

vec4 traceSSR(vec3 P, vec3 R) {
  float stepLen = 0.35;
  vec3 pos = P;
  vec3 prev = P;
  for (int i = 0; i < 30; i++) {
    prev = pos;
    pos += R * stepLen;
    stepLen *= 1.16;
    vec4 clip = uProj * vec4(pos, 1.0);
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || clip.w < 0.0) break;
    float sceneZ = texture(tRefr, uv).a;
    float rayZ = -pos.z;
    float diff = rayZ - sceneZ;
    if (diff > 0.0 && diff < stepLen * 2.5 + 0.25) {
      // refine
      vec3 a = prev;
      vec3 b = pos;
      for (int k = 0; k < 5; k++) {
        vec3 m = (a + b) * 0.5;
        vec4 c = uProj * vec4(m, 1.0);
        vec2 u2 = c.xy / c.w * 0.5 + 0.5;
        if (-m.z > texture(tRefr, u2).a) b = m; else a = m;
      }
      vec4 c = uProj * vec4(b, 1.0);
      vec2 hit = c.xy / c.w * 0.5 + 0.5;
      vec2 edge = smoothstep(vec2(0.0), vec2(0.08), hit) * smoothstep(vec2(1.0), vec2(0.92), hit);
      float fade = edge.x * edge.y * (1.0 - float(i) / 30.0);
      return vec4(texture(tRefr, hit).rgb, fade);
    }
  }
  return vec4(0.0);
}
`;

const WATER_NORMAL = /* glsl */ `
  vec2 fdir = normalize(vFlow.xy + 1e-5);
  vec2 facr = vec2(-fdir.y, fdir.x);
  float speed = vFlow.z;
  float cascade = vFlow.w;
  vec2 fuv = vec2(dot(vWW.xz, facr), dot(vWW.xz, fdir));
  vec3 r1 = sampleRipples(fuv, speed, 1.25, 0.0);
  vec3 r2 = sampleRipples(fuv * vec2(1.0, 0.8) + 3.7, speed * 1.15, 0.42, 0.33);
  float turb = 0.22 + speed * 0.45 + cascade * 1.6 + uWind.z * 0.3;
  vec2 nxy = (r1.xy * 0.55 + r2.xy * 0.45) * turb;
  // bigger slow swell on the pool
  nxy += vec2(vnoise(vWW.xz * 0.6 + uTime * 0.13) - 0.5, vnoise(vWW.xz * 0.6 - uTime * 0.11 + 7.0) - 0.5) * 0.12;
  vec3 nT = normalize(vec3(nxy, 1.0));
  vec3 Ngeo = normalize(vNormal);
  vec3 nW = normalize(vec3(facr.x, 0.0, facr.y) * nT.x + vec3(fdir.x, 0.0, fdir.y) * nT.y + vec3(0.0, 1.0, 0.0) * nT.z);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
`;

const WATER_COLOR = /* glsl */ `
  // ---- refraction & absorption -------------------------------------------
  vec2 suv = gl_FragCoord.xy / uRes;
  float waterZ = -vViewPosition.z;
  vec4 behind0 = texture(tRefr, suv);
  float th0 = max(behind0.a - waterZ, 0.0);
  vec2 distort = normal.xy * 0.045 * clamp(th0 * 1.5, 0.0, 1.0) / (1.0 + waterZ * 0.08);
  vec4 behind = texture(tRefr, suv + distort);
  if (behind.a < waterZ) behind = behind0;
  float th = max(behind.a - waterZ, 0.0);
  vec3 Vv = normalize(vViewPosition);
  float NoV = clamp(dot(normal, Vv), 0.0, 1.0);
  float path = th * 1.15;
  vec3 Tr = exp(-uAbsorb * path);
  vec3 amb = uSunColor * 0.12 * max(uSunDirW.y, 0.0) + vec3(0.02, 0.03, 0.035) * (1.0 - uNight * 0.85);
  vec3 transmitted = behind.rgb * Tr + uScatter * amb * (1.0 - Tr);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);

  // ---- screen space reflections over the environment ----------------------
  vec3 Rv = reflect(-Vv, normal);
  vec4 ssr = uSSR > 0.5 ? traceSSR(-vViewPosition, Rv) : vec4(0.0);
  vec3 indirectSpec = mix(reflectedLight.indirectSpecular, ssr.rgb * F, ssr.a);
  // inside the culvert tunnel there is no sky to reflect
  float inTunnel = (1.0 - smoothstep(2.0, 2.6, abs(vWW.x - uCulvert.x))) * smoothstep(uCulvert.y + 1.6, uCulvert.y - 1.5, vWW.z);
  indirectSpec *= 1.0 - 0.94 * inTunnel;

  vec3 spec = reflectedLight.directSpecular + indirectSpec;
  vec3 foamLit = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse);
  outgoingLight = transmitted * (1.0 - F) * (1.0 - wFoam) + spec * (1.0 - wFoam * 0.8) + foamLit;
`;

export function createWater(streamData, maps) {
  const geo = buildRibbon(streamData.points, streamData.step);
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
    envMapIntensity: 1,
  });
  const uniforms = {
    tRefr: { value: null },
    tRipples: { value: maps.ripples },
    tFoam: { value: maps.foam },
    uRes: { value: new Vector2(1, 1) },
    // per-metre absorption (red goes first) and in-scatter colour of the water body
    uAbsorb: { value: new Vector3(0.38, 0.1, 0.09) },
    uScatter: { value: new Color(0.035, 0.07, 0.055) },
    uSSR: { value: 1 },
    uCulvert: { value: new Vector2(0, -24.5) },
  };
  mat.onBeforeCompile = (shader) => {
    addShared(shader, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aFlow;\nvarying vec3 vWW;\nvarying vec4 vFlow;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFlow = aFlow;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_FRAG_HEAD}`)
      .replace('#include <normal_fragment_maps>', WATER_NORMAL)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float wFoam = 0.0;
        {
          vec2 fdir0 = normalize(vFlow.xy + 1e-5);
          vec2 fuv0 = vec2(dot(vWW.xz, vec2(-fdir0.y, fdir0.x)), dot(vWW.xz, fdir0));
          float fpat = sampleFoam(fuv0, vFlow.z);
          vec2 suv0 = gl_FragCoord.xy / uRes;
          float thick = max(texture(tRefr, suv0).a + vViewPosition.z, 0.0);
          float contact = 1.0 - smoothstep(0.0, 0.22 + vFlow.z * 0.08, thick);
          float casc = vFlow.w;
          wFoam = clamp(contact * (0.35 + fpat * 0.9) + casc * smoothstep(0.25, 0.75, fpat + casc * 0.4), 0.0, 1.0);
          wFoam *= smoothstep(0.0, 0.03, thick + casc);
        }
        diffuseColor.rgb = vec3(0.86, 0.88, 0.88) * wFoam;
        `,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.85, wFoam);')
      .replace('#include <opaque_fragment>', `${WATER_COLOR}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'water-v1';
  const mesh = new Mesh(geo, mat);
  mesh.name = 'water';
  mesh.layers.set(WATER_LAYER);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
