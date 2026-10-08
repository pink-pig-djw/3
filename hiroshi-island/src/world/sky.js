import {
  BackSide,
  BoxGeometry,
  CubeCamera,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
} from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';

const SKY_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunI;
uniform float uMoonI;
uniform float uHaze;
uniform vec3 uSunDisk;
uniform vec3 uMoonDisk;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform vec3 uCloudSun;
uniform vec3 uCloudAmb;
uniform float uStars;
uniform float uTime;
uniform vec3 uGround;
uniform vec3 uMS;
`;

const SKY_FUNCS = /* glsl */ `
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise2(p); p = mat2(1.7, 1.1, -1.1, 1.7) * p + 3.1; a *= 0.5; }
  return s;
}

vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 180.0 : 420.0;
    vec3 p = rd * sc;
    vec3 ip = floor(p);
    vec3 fp = fract(p) - 0.5;
    float h = hash13(ip + float(layer) * 17.0);
    float thr = layer == 0 ? 0.992 : 0.975;
    if (h > thr) {
      vec3 o = (hash33(ip) - 0.5) * 0.5;
      float d = length(fp - o);
      float mag = pow((h - thr) / (1.0 - thr), 3.0);
      float b = smoothstep(0.32, 0.0, d) * (layer == 0 ? 6.0 : 1.6) * (0.25 + mag * 4.0);
      float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 5.0) + h * 91.0);
      vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.82, 1.0), fract(h * 37.0));
      col += tint * b * tw;
    }
  }
  // milky way: a faint, dusty band
  vec3 mwN = normalize(vec3(0.42, 0.32, 0.85));
  float band = exp(-pow(dot(rd, mwN), 2.0) / 0.018);
  vec2 bp = vec2(atan(rd.z, rd.x) * 3.0, rd.y * 6.0);
  float dust = fbm5(bp * 2.0);
  col += vec3(0.55, 0.6, 0.75) * band * (0.25 + 0.75 * smoothstep(0.35, 0.8, dust)) * 0.35;
  return col;
}

// High altitude cloud layer (2.4 km), lit by the sun with forward scattering.
vec4 cloudLayer(vec3 rd) {
  if (rd.y < 0.008 || uCloudCover < 0.01) return vec4(0.0);
  float t = 2400.0 / rd.y;
  vec2 uv = rd.xz * t * 0.00022 + uCloudOffset;
  float n = fbm5(uv);
  float cov = uCloudCover;
  float d = smoothstep(1.0 - cov - 0.05, 1.0 - cov + 0.32, n + 0.12);
  // light march towards the sun for self shadowing / silver lining
  vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
  float n2 = fbm5(uv + toSun);
  float occl = smoothstep(1.0 - cov - 0.05, 1.0 - cov + 0.32, n2 + 0.12);
  float mu = dot(rd, uSunDir);
  float g = 0.55;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / (4.0 * 3.14159);
  vec3 sunLit = uCloudSun * (0.35 + 2.4 * hg) * exp(-occl * 1.6);
  vec3 col = uCloudAmb * (0.75 + 0.35 * (1.0 - d)) + sunLit;
  float fade = smoothstep(0.008, 0.16, rd.y);
  return vec4(col, d * fade * 0.92);
}

vec3 moonColor(vec3 rd, float radius) {
  float c = dot(rd, uMoonDir);
  float cr = cos(radius);
  if (c < cr - 0.0004) return vec3(0.0);
  vec3 up = abs(uMoonDir.y) > 0.99 ? vec3(1, 0, 0) : vec3(0, 1, 0);
  vec3 tx = normalize(cross(up, uMoonDir));
  vec3 ty = cross(uMoonDir, tx);
  vec2 q = vec2(dot(rd, tx), dot(rd, ty)) / sin(radius);
  float r = length(q);
  float edge = smoothstep(1.0, 0.97, r);
  float maria = fbm5(q * 2.2 + 7.0);
  float tex = 0.78 + 0.22 * smoothstep(0.35, 0.65, maria);
  float limb = 0.65 + 0.35 * sqrt(max(1.0 - r * r, 0.0));
  return uMoonDisk * tex * limb * edge;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p;
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // on the far plane
}`;

// 1. scattering only (both light sources), the base of everything else
const SCATTER_FRAG = /* glsl */ `
${SKY_UNIFORMS}
${ATMOSPHERE_GLSL}
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 r = rd;
  r.y = max(r.y, 0.004);
  r = normalize(r);
  vec3 col = vec3(0.0);
  if (uSunI > 0.0) col += atmosphere(r, uSunDir, uSunI, uHaze);
  if (uMoonI > 0.0) col += atmosphere(r, uMoonDir, uMoonI, uHaze);
  // cheap multiple scattering: fills the earth's shadow at dusk with blue
  col += uMS * (0.55 + 0.45 * (1.0 - r.y));
  if (rd.y < 0.0) {
    // below the horizon: distant hazy ground
    float k = smoothstep(0.0, -0.12, rd.y);
    col = mix(col, uGround, k);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// 2. environment (for IBL + reflections): scattering + clouds + moon, no sun disk
const ENV_FRAG = /* glsl */ `
${SKY_UNIFORMS}
uniform samplerCube uScatter;
${SKY_FUNCS}
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 col = textureLod(uScatter, rd, 0.0).rgb;
  col += starField(rd) * uStars * 0.4 * smoothstep(0.0, 0.1, rd.y);
  col += moonColor(rd, 0.02);
  vec4 cl = cloudLayer(rd);
  col = mix(col, cl.rgb, cl.a);
  gl_FragColor = vec4(col, 1.0);
}`;

// 3. the visible sky dome
const DOME_FRAG = /* glsl */ `
${SKY_UNIFORMS}
uniform samplerCube uScatter;
${SKY_FUNCS}
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 col = textureLod(uScatter, rd, 0.0).rgb;
  float above = smoothstep(-0.01, 0.06, rd.y);
  // stars are dimmed by the brightness of the sky in front of them
  float skyL = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += starField(rd) * uStars * above * clamp(1.0 - skyL * 6.0, 0.0, 1.0) * 0.06;
  col += moonColor(rd, 0.0105) * above;
  // sun disk with limb darkening
  float cs = dot(rd, uSunDir);
  float sunR = 0.00475;
  if (cs > cos(sunR * 1.3)) {
    float r = acos(clamp(cs, -1.0, 1.0)) / sunR;
    float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - min(r, 1.0) * min(r, 1.0), 0.0)));
    col += uSunDisk * limb * smoothstep(1.05, 0.95, r) * above;
  }
  vec4 cl = cloudLayer(rd);
  col = mix(col, cl.rgb, cl.a);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(renderer, { envSize = 128 } = {}) {
    this.renderer = renderer;
    this.uniforms = {
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, 1, 0) },
      uSunI: { value: 22 },
      uMoonI: { value: 0 },
      uHaze: { value: 1 },
      uSunDisk: { value: new Vector3() },
      uMoonDisk: { value: new Vector3() },
      uCloudCover: { value: 0.35 },
      uCloudOffset: { value: new Vector2() },
      uCloudSun: { value: new Vector3(1, 1, 1) },
      uCloudAmb: { value: new Vector3(0.5, 0.6, 0.8) },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uGround: { value: new Vector3(0.05, 0.06, 0.04) },
      uMS: { value: new Vector3() },
      uScatter: { value: null },
    };

    const rtOpts = { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter };
    this.scatterRT = new WebGLCubeRenderTarget(envSize, rtOpts);
    this.envRT = new WebGLCubeRenderTarget(envSize, rtOpts);
    this.uniforms.uScatter.value = this.scatterRT.texture;

    const box = new BoxGeometry(10, 10, 10);
    this.scatterScene = new Scene();
    this.scatterScene.add(
      new Mesh(box, new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: SCATTER_FRAG, side: BackSide, depthWrite: false, depthTest: false })),
    );
    this.envScene = new Scene();
    this.envScene.add(
      new Mesh(box, new ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: ENV_FRAG, side: BackSide, depthWrite: false, depthTest: false })),
    );
    this.cubeCam = new CubeCamera(0.1, 100, this.scatterRT);

    this.dome = new Mesh(
      new SphereGeometry(1, 64, 32),
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: BackSide,
        depthWrite: false,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1000; // after opaque geometry: only fills empty pixels
    this.dome.scale.setScalar(1000);
    this.dome.name = 'sky';

    this.pmrem = new PMREMGenerator(renderer);
    this.envTarget = null;
  }

  /** Re-render the scattering cube, environment cube and its PMREM. */
  updateEnvironment() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    this.cubeCam.renderTarget = this.scatterRT;
    this.cubeCam.update(r, this.scatterScene);
    this.cubeCam.renderTarget = this.envRT;
    this.cubeCam.update(r, this.envScene);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromCubemap(this.envRT.texture, old ?? undefined);
    r.xr.enabled = prevXr;
    r.setRenderTarget(prevTarget);
    return this.envTarget.texture;
  }
}
