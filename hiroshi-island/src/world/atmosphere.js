/**
 * Single-scattering atmosphere (Rayleigh + Mie + ozone absorption), used both
 * on the GPU (sky dome / environment cube) and on the CPU (sun colour, fog
 * colour, exposure). Units are arbitrary but consistent between the two.
 */

export const ATMOSPHERE_GLSL = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif
const float R_E = 6360e3;
const float R_A = 6420e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BETA_M = vec3(3.996e-6);
const vec3 BETA_M_EXT = vec3(4.440e-6);
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float H_R = 8000.0;
const float H_M = 1200.0;

vec2 rsi(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }

// Radiance scattered towards the viewer along rd, lit by a source in direction ld.
vec3 atmosphere(vec3 rd, vec3 ld, float lightI, float haze) {
  vec3 ro = vec3(0.0, R_E + 150.0, 0.0);
  vec2 ta = rsi(ro, rd, R_A);
  float tmax = ta.y;
  vec2 tg = rsi(ro, rd, R_E);
  if (tg.x > 0.0 && tg.x < 1e8) tmax = min(tmax, tg.x);
  const int N = 16;
  const int NL = 8;
  float ds = tmax / float(N);
  float mu = dot(rd, ld);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.78;
  float pm = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  vec3 sr = vec3(0.0);
  vec3 sm = vec3(0.0);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (ds * (float(i) + 0.5));
    float h = max(length(p) - R_E, 0.0);
    float dR = exp(-h / H_R) * ds;
    float dM = exp(-h / H_M) * ds * haze;
    float dO = ozoneDensity(h) * ds;
    odR += dR; odM += dM; odO += dO;
    vec2 tgl = rsi(p, ld, R_E);
    if (tgl.x > 0.0 && tgl.x < 1e8) continue; // in the planet's shadow (a miss returns 1e9)
    vec2 tl = rsi(p, ld, R_A);
    float dsl = tl.y / float(NL);
    float lR = 0.0, lM = 0.0, lO = 0.0;
    for (int j = 0; j < NL; j++) {
      vec3 q = p + ld * (dsl * (float(j) + 0.5));
      float hq = max(length(q) - R_E, 0.0);
      lR += exp(-hq / H_R) * dsl;
      lM += exp(-hq / H_M) * dsl * haze;
      lO += ozoneDensity(hq) * dsl;
    }
    vec3 att = exp(-(BETA_R * (odR + lR) + BETA_M_EXT * (odM + lM) + BETA_O * (odO + lO)));
    sr += att * dR;
    sm += att * dM;
  }
  return lightI * (sr * BETA_R * pr + sm * BETA_M * pm);
}
`;

const R_E = 6360e3;
const R_A = 6420e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
const BETA_M = 3.996e-6;
const BETA_M_EXT = 4.44e-6;
const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6];
const H_R = 8000;
const H_M = 1200;

function rsi(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  let d = b * b - c;
  if (d < 0) return [1e9, -1e9];
  d = Math.sqrt(d);
  return [-b - d, -b + d];
}
const ozone = (h) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

/** Optical depths (rayleigh, mie, ozone) from p along dir to the top of the atmosphere. */
function opticalDepth(p, dir, haze, n = 24) {
  const tg = rsi(p, dir, R_E);
  if (tg[0] > 0 && tg[0] < 1e8) return null; // the planet is in the way
  const tl = rsi(p, dir, R_A);
  const ds = tl[1] / n;
  let r = 0;
  let m = 0;
  let o = 0;
  for (let j = 0; j < n; j++) {
    const t = ds * (j + 0.5);
    const q = [p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t];
    const h = Math.max(Math.hypot(q[0], q[1], q[2]) - R_E, 0);
    r += Math.exp(-h / H_R) * ds;
    m += Math.exp(-h / H_M) * ds * haze;
    o += ozone(h) * ds;
  }
  return [r, m, o];
}

/** Transmittance from the viewer towards direction `dir` (unit, y up). */
export function transmittance(dir, haze = 1) {
  const ro = [0, R_E + 150, 0];
  const od = opticalDepth(ro, dir, haze);
  if (!od) return [0, 0, 0];
  return [0, 1, 2].map((k) => Math.exp(-(BETA_R[k] * od[0] + BETA_M_EXT * od[1] + BETA_O[k] * od[2])));
}

/** CPU version of the GLSL atmosphere() for a handful of directions. */
export function skyRadiance(rd, ld, lightI, haze = 1) {
  const ro = [0, R_E + 150, 0];
  const ta = rsi(ro, rd, R_A);
  let tmax = ta[1];
  const tg = rsi(ro, rd, R_E);
  if (tg[0] > 0 && tg[0] < 1e8) tmax = Math.min(tmax, tg[0]);
  const N = 16;
  const ds = tmax / N;
  const mu = rd[0] * ld[0] + rd[1] * ld[1] + rd[2] * ld[2];
  const pr = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = 0.78;
  const pm = ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu))) / ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));
  const sr = [0, 0, 0];
  const sm = [0, 0, 0];
  let odR = 0;
  let odM = 0;
  let odO = 0;
  for (let i = 0; i < N; i++) {
    const t = ds * (i + 0.5);
    const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = Math.max(Math.hypot(p[0], p[1], p[2]) - R_E, 0);
    const dR = Math.exp(-h / H_R) * ds;
    const dM = Math.exp(-h / H_M) * ds * haze;
    odR += dR;
    odM += dM;
    odO += ozone(h) * ds;
    const od = opticalDepth(p, ld, haze, 8);
    if (!od) continue;
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(BETA_R[k] * (odR + od[0]) + BETA_M_EXT * (odM + od[1]) + BETA_O[k] * (odO + od[2])));
      sr[k] += att * dR;
      sm[k] += att * dM;
    }
  }
  return [0, 1, 2].map((k) => lightI * (sr[k] * BETA_R[k] * pr + sm[k] * BETA_M * pm));
}

/** Direction from azimuth (deg, clockwise from north = -z) and elevation (deg). */
export function dirFromAngles(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
