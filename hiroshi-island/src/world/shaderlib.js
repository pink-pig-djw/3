import { ShaderChunk, Vector2, Vector3, Vector4 } from 'three';

/**
 * Uniforms shared by every patched material. Objects are shared by reference,
 * so updating `.value` here updates every material at once.
 */
export const G = {
  uTime: { value: 0 },
  // xy = wind direction, z = strength (0..1), w = gust phase
  uWind: { value: new Vector4(0.8, 0.6, 0.45, 0) },
  uPlayer: { value: new Vector3() },
  uTerrainSize: { value: 256 },
  uWaterRes: { value: 257 },
  uSunDirW: { value: new Vector3(0, 1, 0) }, // towards the sun / moon, world space
  uSunColor: { value: new Vector3(1, 1, 1) },
  uNight: { value: 0 }, // 0 day .. 1 night
  uLanterns: { value: 0 }, // 0..1 lantern glow
  uWet: { value: 0.0 },
  uResolution: { value: new Vector2(1, 1) },
};

/** GLSL helpers available to every patched shader. */
export const GLSL_COMMON = /* glsl */ `
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
// Wind field: large slow gusts travelling along the wind direction.
float windGust(vec2 xz) {
  vec2 d = uWind.xy;
  float t = uTime;
  float g = vnoise(xz * 0.045 - d * t * 0.35) * 0.65 + vnoise(xz * 0.13 - d * t * 0.9) * 0.35;
  return g * uWind.z;
}
`;

export const GLSL_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec4 uWind;
uniform vec3 uPlayer;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uLanterns;
`;

/** Attach shared uniforms to a compiled shader (inside onBeforeCompile). */
export function addShared(shader, extra = {}) {
  Object.assign(shader.uniforms, {
    uTime: G.uTime,
    uWind: G.uWind,
    uPlayer: G.uPlayer,
    uSunDirW: G.uSunDirW,
    uSunColor: G.uSunColor,
    uNight: G.uNight,
    uLanterns: G.uLanterns,
    ...extra,
  });
}

let installed = false;

/**
 * Replace three's fog with exponential height fog + sun-directional
 * in-scattering (aerial perspective). Encoded in a THREE.Fog:
 *   fog.color = horizon in-scatter colour, fog.near = density, fog.far = height falloff.
 */
export function installFogChunks() {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  {
    vec4 fw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      fw = instanceMatrix * fw;
    #endif
    #ifdef USE_BATCHING
      fw = batchingMatrix * fw;
    #endif
    vFogWorldPos = (modelMatrix * fw).xyz;
  }
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vFogWorldPos;
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fr = vFogWorldPos - cameraPosition;
    float fdist = length(fr);
    vec3 fdir = fr / max(fdist, 1e-4);
    float fb = fogFar;
    float ry = fdir.y * fdist;
    float base = fogNear * exp(-fb * max(cameraPosition.y, -20.0));
    float famt = abs(ry) > 1e-3 ? base * (1.0 - exp(-fb * ry)) / (fb * ry) * fdist : base * fdist;
    float ffac = 1.0 - exp(-max(famt, 0.0));
    vec3 fcol = fogColor;
    #if NUM_DIR_LIGHTS > 0
      vec3 sunW = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
      float sAmt = max(dot(fdir, sunW), 0.0);
      fcol += directionalLights[0].color * (pow(sAmt, 8.0) * 0.16 + pow(sAmt, 64.0) * 0.18);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, ffac);
  }
#endif`;
}
