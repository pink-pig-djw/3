// Procedural sky dome: gradient, sun (or striped synthwave sun / moon), stars,
// nebula, aurora and a ringed planet, all blended between zones by uniforms.
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

const frag = /* glsl */ `
uniform vec3 uTop, uMid, uHorizon, uBottom, uSunDir, uSunColor, uSunColor2;
uniform float uStars, uNebula, uAurora, uPlanet, uSunSize, uStripes, uGlow, uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uMid, smoothstep(0.0, 0.2, h)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, h));
  col = mix(col, uTop, smoothstep(0.2, 0.75, h));

  // stars (also below the horizon, which shows in space)
  if (uStars > 0.001) {
    vec3 p = d * 180.0;
    vec3 c = floor(p);
    float r = hash(c);
    vec3 f = fract(p) - 0.5;
    float star = smoothstep(0.16, 0.0, length(f)) * step(0.955, r);
    float tw = 0.55 + 0.45 * sin(uTime * (2.0 + r * 4.0) + r * 60.0);
    float horizonFade = smoothstep(-0.05, 0.12, h) + step(1.2, uStars);
    col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * clamp(horizonFade, 0.0, 1.0);
  }

  // nebula
  if (uNebula > 0.001) {
    float n = fbm(d * 2.6 + vec3(0.0, 0.0, uTime * 0.01));
    float n2 = fbm(d * 5.0 + vec3(4.0, 1.0, -uTime * 0.008));
    vec3 neb = vec3(0.55, 0.12, 0.65) * smoothstep(0.48, 0.85, n) + vec3(0.1, 0.35, 0.8) * smoothstep(0.5, 0.9, n2);
    col += neb * uNebula * (0.6 + 0.4 * smoothstep(-0.4, 0.3, h));
  }

  // aurora ribbons
  if (uAurora > 0.001) {
    float w = fbm(vec3(d.x * 3.0, uTime * 0.05, d.z * 3.0));
    float band = 0.5 + 0.5 * sin(d.x * 7.0 + d.z * 2.0 + w * 6.0 + uTime * 0.25);
    float a = smoothstep(0.12, 0.28, h) * smoothstep(0.62, 0.32, h) * pow(band, 4.0);
    col += (vec3(0.15, 1.0, 0.65) * (1.0 - smoothstep(0.25, 0.5, h)) + vec3(0.65, 0.25, 1.0) * smoothstep(0.25, 0.5, h)) * a * uAurora;
  }

  // sun / moon
  vec3 sd = normalize(uSunDir);
  float cosA = dot(d, sd);
  float ang = acos(clamp(cosA, -1.0, 1.0));
  col += uSunColor * exp(-ang * 7.0) * 0.35 * uGlow;
  col += uSunColor2 * exp(-ang * 2.2) * 0.25 * uGlow;
  float disc = smoothstep(uSunSize, uSunSize * 0.96, ang);
  vec3 sunCol = mix(uSunColor2, uSunColor, smoothstep(-1.0, 1.0, (d.y - sd.y) / uSunSize));
  if (uStripes > 0.001) {
    float yy = (d.y - sd.y) / uSunSize; // -1..1 inside the disc
    float bands = step(0.0, sin((yy + uTime * 0.06) * 34.0) + (yy + 0.1) * 2.6);
    disc *= mix(1.0, bands, uStripes * step(yy, 0.15));
  }
  col = mix(col, sunCol, disc);

  // ringed planet
  if (uPlanet > 0.001) {
    vec3 pc = normalize(vec3(-0.55, 0.32, -1.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), pc));
    vec3 up = cross(pc, right);
    vec3 q = d - pc * dot(d, pc);
    vec2 uv = vec2(dot(q, right), dot(q, up));
    float R = 0.13;
    float pr = length(uv);
    vec2 ruv = vec2(uv.x * cos(0.35) - uv.y * sin(0.35), uv.x * sin(0.35) + uv.y * cos(0.35));
    float rr = length(vec2(ruv.x, ruv.y * 3.4));
    float ring = smoothstep(R * 1.35, R * 1.42, rr) * smoothstep(R * 2.1, R * 2.0, rr) * (0.6 + 0.4 * sin(rr * 160.0));
    float front = step(0.0, ruv.y) + step(R, pr);
    vec3 ringCol = vec3(0.95, 0.8, 0.6) * ring;
    if (pr < R && dot(d, pc) > 0.0) {
      float shade = clamp(0.35 + 0.9 * dot(normalize(vec3(uv / R, sqrt(max(0.0, 1.0 - dot(uv / R, uv / R))))), normalize(vec3(0.6, 0.5, 0.6))), 0.0, 1.0);
      vec3 pcol = mix(vec3(0.9, 0.45, 0.35), vec3(1.0, 0.75, 0.5), 0.5 + 0.5 * sin(uv.y / R * 9.0 + sin(uv.x / R * 3.0)));
      col = mix(col, pcol * shade, uPlanet);
      col += ringCol * uPlanet * step(0.0, ruv.y) ;
    } else if (dot(d, pc) > 0.0) {
      col += ringCol * uPlanet * front * 0.9;
      col += vec3(1.0, 0.6, 0.45) * exp(-max(pr - R, 0.0) * 40.0) * 0.25 * uPlanet;
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 0.2, -1) }, uSunColor: { value: new THREE.Color() }, uSunColor2: { value: new THREE.Color() },
      uStars: { value: 0 }, uNebula: { value: 0 }, uAurora: { value: 0 }, uPlanet: { value: 0 },
      uSunSize: { value: 0.05 }, uStripes: { value: 0 }, uGlow: { value: 0.5 }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  // Blend two zone skies; t in 0..1
  apply(a, b, t, time, camera) {
    const u = this.uniforms, A = a.sky, B = b.sky;
    for (const k of ['top', 'mid', 'horizon', 'bottom', 'sunColor', 'sunColor2']) {
      u['u' + k[0].toUpperCase() + k.slice(1)].value.copy(A[k]).lerp(B[k], t);
    }
    u.uSunDir.value.copy(A.sunDir).lerp(B.sunDir, t).normalize();
    for (const [k, n] of [['stars', 'uStars'], ['nebula', 'uNebula'], ['aurora', 'uAurora'], ['planet', 'uPlanet'], ['sunSize', 'uSunSize'], ['stripes', 'uStripes'], ['glow', 'uGlow']]) {
      u[n].value = A[k] + (B[k] - A[k]) * t;
    }
    u.uTime.value = time;
    this.mesh.position.copy(camera.position);
  }
}
