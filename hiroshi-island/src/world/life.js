import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { G, GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';

function find(gltf, name) {
  let out = null;
  gltf.scene.traverse((o) => {
    if (!out && o.name === name) out = o;
  });
  return out;
}

function meshes(obj) {
  const list = [];
  obj?.traverse((o) => o.isMesh && list.push(o));
  return list;
}

function patch(mat, key, vertexCode, extraUniforms = {}) {
  mat.onBeforeCompile = (shader) => {
    addShared(shader, extraUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GLSL_UNIFORMS}\n${GLSL_COMMON}\nattribute vec4 _wind;\n${Object.keys(extraUniforms).map((k) => `uniform float ${k};`).join('\n')}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexCode}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Point along the stream centre line at arc length s (m). */
function streamAt(points, s, out) {
  const step = 0.5;
  const f = MathUtils.clamp(s / step, 0, points.length - 1.001);
  const i = Math.floor(f);
  const t = f - i;
  const a = points[i];
  const b = points[i + 1];
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

/**
 * Everything that moves on its own: trout in the pool, a dragonfly by the
 * reeds, river lanterns at dusk, fireflies at night, the wind chime, dust in
 * the sunlight, and Hiroshi's straw hat on the bench.
 */
export function createLife(gltf, world) {
  const { layout, hf } = world;
  const objects = [];
  const pool = layout.pool;

  // ---------------------------------------------------------------- fish
  const fishSrc = meshes(find(gltf, 'fish'))[0];
  const fishMat = patch(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0, color: 0xb8b8b0 }),
    'fish',
    /* glsl */ `
      float tt = _wind.x;
      float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
      transformed.z += sin(uTime * 7.0 + ph - tt * 5.5) * 0.018 * (0.15 + tt * tt * 1.4) * uSwim;
    `,
    { uSwim: { value: 1 } },
  );
  const nFish = 7;
  const fish = new InstancedMesh(fishSrc.geometry, fishMat, nFish);
  fish.castShadow = false;
  fish.receiveShadow = true;
  fish.frustumCulled = false;
  objects.push(fish);
  const fishState = Array.from({ length: nFish }, (_, i) => ({
    a: (i / nFish) * Math.PI * 2,
    r: 1.4 + (i % 3) * 1.1,
    speed: 0.12 + (i % 4) * 0.05,
    depth: 0.3 + (i % 3) * 0.16,
    phase: i * 1.3,
    s: 1.25 + (i % 4) * 0.12,
    pos: new Vector3(),
  }));

  // ---------------------------------------------------------- dragonfly
  const dfSrc = meshes(find(gltf, 'dragonfly'))[0];
  const dfMat = patch(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1, side: DoubleSide, transparent: true, opacity: 0.92 }),
    'dragonfly',
    /* glsl */ `
      float span = _wind.z;
      float side = _wind.w > 0.5 ? 1.0 : -1.0;
      float flap = sin(uTime * 58.0 + side * 0.4) * 0.75 * uFlap;
      transformed.y += sin(flap) * abs(transformed.z) * 0.95 * step(0.001, span);
      transformed.z *= mix(1.0, cos(flap), step(0.001, span));
    `,
    { uFlap: { value: 1 } },
  );
  const dragonfly = new Mesh(dfSrc.geometry, dfMat);
  dragonfly.scale.setScalar(1.6);
  dragonfly.castShadow = false;
  objects.push(dragonfly);
  // perch: the reed clump nearest to the pool's east side
  let perch = new Vector3(pool.x + 6, pool.y + 1.2, pool.z);
  let bestD = Infinity;
  for (const r of layout.reeds) {
    const d = Math.hypot(r.p[0] - (pool.x + 5), r.p[2] - pool.z);
    if (d < bestD) {
      bestD = d;
      perch = new Vector3(r.p[0], hf.height(r.p[0], r.p[2]) + 1.25 * r.s, r.p[2]);
    }
  }
  const df = { pos: perch.clone(), target: perch.clone(), timer: 2, yaw: 0, hover: 0 };

  // ------------------------------------------------------- river lanterns
  const toroSrc = find(gltf, 'toro');
  const toroParts = meshes(toroSrc);
  const toroBodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const toroPaperMat = new MeshStandardMaterial({
    color: 0xf2e8d4,
    vertexColors: true,
    roughness: 0.9,
    emissive: new Color(1.0, 0.6, 0.28),
    emissiveIntensity: 0,
    side: DoubleSide,
  });
  const nToro = 4;
  const toros = [];
  for (let i = 0; i < nToro; i++) {
    const group = new Group();
    for (const part of toroParts) {
      const isPaper = (part.material?.name || '').startsWith('paper');
      const m = new Mesh(part.geometry, isPaper ? toroPaperMat : toroBodyMat);
      m.castShadow = false;
      group.add(m);
    }
    group.visible = false;
    objects.push(group);
    toros.push({ obj: group, s: -1000 - i * 45, spin: (i * 0.7) % 1 });
  }
  const toroLight = new PointLight(0xffa458, 0, 6, 2);
  objects.push(toroLight);
  const streamPts = world.stream.points;
  // arc length of the culvert mouth
  let sMouth = 0;
  {
    let acc = 0;
    for (let i = 1; i < streamPts.length; i++) {
      acc += Math.hypot(streamPts[i][0] - streamPts[i - 1][0], streamPts[i][2] - streamPts[i - 1][2]);
      if (streamPts[i][2] > layout.culvert.z + 0.2) {
        sMouth = acc - 1.5;
        break;
      }
    }
  }
  const sEnd = streamPts.length * 0.5 - 4;

  // ------------------------------------------------------------ fireflies
  const nFlies = 90;
  const flyGeo = new BufferGeometry();
  const flyPos = new Float32Array(nFlies * 3);
  const flyData = new Float32Array(nFlies * 4);
  const home = [];
  const D = layout.deck;
  for (let i = 0; i < nFlies; i++) {
    // around the deck and the west bank, a few over the pool reeds
    const cx = i < 65 ? D.x + 4 + Math.random() * 6 - 3 : pool.x - 5 + Math.random() * 4;
    const cz = i < 65 ? D.z + Math.random() * 12 - 4 : pool.z + Math.random() * 8 - 4;
    const p = new Vector3(cx, hf.height(cx, cz) + 0.4 + Math.random() * 1.6, cz);
    home.push(p);
    flyPos.set([p.x, p.y, p.z], i * 3);
    flyData.set([Math.random() * 100, 0.6 + Math.random() * 0.8, Math.random(), Math.random()], i * 4);
  }
  flyGeo.setAttribute('position', new BufferAttribute(flyPos, 3));
  flyGeo.setAttribute('aData', new BufferAttribute(flyData, 4));
  const flyMat = new ShaderMaterial({
    uniforms: { uTime: G.uTime, uOn: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aData;
      uniform float uTime;
      uniform float uOn;
      uniform float uScale;
      varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float blink = pow(max(sin(uTime * aData.y * 1.7 + aData.x), 0.0), 6.0);
        vGlow = blink * uOn;
        gl_PointSize = (2.0 + 26.0 * blink) * uScale / max(-mv.z, 0.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        float a = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.12, 0.0, d);
        vec3 c = vec3(0.75, 1.0, 0.35) * (a * 2.0 + core * 10.0) * vGlow;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const flies = new Points(flyGeo, flyMat);
  flies.frustumCulled = false;
  objects.push(flies);

  // ----------------------------------------------------------- wind chime
  const furinSrc = find(gltf, 'furin');
  const glassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55, side: DoubleSide });
  const stringMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const paperMat = patch(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }),
    'furin-paper',
    /* glsl */ `
      float w = _wind.z;
      transformed.x += sin(uTime * 5.0 + transformed.y * 20.0) * 0.02 * w * (0.4 + uWind.z);
      transformed.z += cos(uTime * 3.3) * 0.015 * w;
    `,
  );
  const furin = new Group();
  for (const part of meshes(furinSrc)) {
    const n = part.material?.name || '';
    furin.add(new Mesh(part.geometry, n.startsWith('glass') ? glassMat : n.startsWith('paper') ? paperMat : stringMat));
  }
  const H = layout.house;
  const ha = (H.yaw_deg * Math.PI) / 180;
  const ex = new Vector3(Math.cos(ha), 0, -Math.sin(ha));
  const ez = new Vector3(Math.sin(ha), 0, Math.cos(ha));
  const furinPos = new Vector3(H.x, H.ground + 2.62, H.z)
    .addScaledVector(ex, H.w / 2 + 0.9 - 0.25)
    .addScaledVector(ez, H.d / 2 + 0.95 - 0.2);
  furin.position.copy(furinPos);
  furin.scale.setScalar(1.25);
  objects.push(furin);
  const chime = { angle: 0, vel: 0, last: 0 };

  // -------------------------------------------------------------- the hat
  const hatSrc = meshes(find(gltf, 'hat'))[0];
  const hat = new Mesh(hatSrc.geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  hat.position.copy(world.arch.benchSeat).add(new Vector3(0.0, 0.0, 0.0));
  hat.rotation.set(0.04, 0.6, -0.03);
  hat.castShadow = true;
  hat.receiveShadow = true;
  objects.push(hat);

  // ------------------------------------------------------- dust in the sun
  const nDust = 500;
  const dustGeo = new BufferGeometry();
  const dustPos = new Float32Array(nDust * 3);
  for (let i = 0; i < nDust; i++) dustPos.set([Math.random() * 24 - 12, Math.random() * 7, Math.random() * 24 - 12], i * 3);
  dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
  const dustMat = new ShaderMaterial({
    uniforms: { uTime: G.uTime, uCam: { value: new Vector3() }, uSun: G.uSunDirW, uSunCol: G.uSunColor, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uSun; uniform float uAmt;
      varying float vA;
      void main() {
        vec3 p = position + vec3(sin(uTime * 0.13 + position.y) * 0.6, sin(uTime * 0.07 + position.x) * 0.3, cos(uTime * 0.11 + position.z) * 0.6);
        vec3 w = uCam + mod(p - uCam + 12.0, 24.0) - 12.0;
        w.y = uCam.y - 2.0 + mod(p.y + uTime * 0.05, 7.0);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        vec3 v = normalize(w - uCam);
        float fwd = pow(max(dot(v, uSun), 0.0), 3.0);
        float dc = length(w - uCam);
        vA = uAmt * (0.15 + 0.85 * fwd) * smoothstep(12.0, 3.0, dc) * smoothstep(1.2, 2.5, dc);
        gl_PointSize = clamp(9.0 / max(-mv.z, 0.5), 1.0, 3.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunCol;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uSunCol * 0.18 * vA * smoothstep(0.5, 0.0, d), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  objects.push(dust);

  // ----------------------------------------------------------------- update
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const tmp = new Vector3();
  const api = {
    objects,
    fish: fishState,
    dragonfly: df,
    toros,
    furinPos,
    hat,
    flies: { home, positions: flyPos, data: flyData },
    focusables: [hat, furin, dragonfly],
    update(dt, camera, timeName) {
      const t = G.uTime.value;
      const night = G.uNight.value;
      // fish circle lazily, pause now and then
      fishState.forEach((f, i) => {
        const slow = 0.55 + 0.45 * Math.sin(t * 0.21 + f.phase);
        f.a += dt * f.speed * slow;
        const r = f.r + Math.sin(t * 0.17 + f.phase) * 0.5;
        f.pos.set(pool.x + Math.cos(f.a) * r, pool.y - f.depth, pool.z + Math.sin(f.a) * r * 0.8);
        // nose (+x) along the direction of travel
        const vx = -Math.sin(f.a) * r;
        const vz = Math.cos(f.a) * r * 0.8;
        q.setFromAxisAngle(up, Math.atan2(-vz, vx));
        m4.compose(f.pos, q, tmp.setScalar(f.s));
        fish.setMatrixAt(i, m4);
      });
      fish.instanceMatrix.needsUpdate = true;

      // dragonfly: perched with small hops, only in daylight
      dragonfly.visible = timeName === 'afternoon' || timeName === 'golden';
      df.timer -= dt;
      if (df.timer <= 0) {
        const away = Math.random() < 0.35;
        df.target.copy(perch).add(new Vector3((Math.random() - 0.5) * (away ? 3 : 0.6), (Math.random() - 0.2) * (away ? 1.2 : 0.2), (Math.random() - 0.5) * (away ? 3 : 0.6)));
        df.timer = away ? 1.5 + Math.random() : 3 + Math.random() * 4;
      }
      const prev = df.pos.clone();
      df.pos.lerp(df.target, 1 - Math.exp(-dt * 3.5));
      const mv = df.pos.clone().sub(prev);
      if (mv.lengthSq() > 1e-7) df.yaw = MathUtils.lerp(df.yaw, Math.atan2(-mv.z, mv.x), 0.2);
      dragonfly.position.copy(df.pos).add(new Vector3(0, Math.sin(t * 9) * 0.008, 0));
      dragonfly.rotation.set(0, df.yaw, Math.sin(t * 3) * 0.04);

      // river lanterns: drift from the culvert at dusk and night
      const lanternsOn = timeName === 'blue' || timeName === 'night';
      toroPaperMat.emissiveIntensity = 3.2 * Math.max(G.uLanterns.value, 0.2);
      let nearest = null;
      let nd = Infinity;
      toros.forEach((tr, i) => {
        if (!lanternsOn) {
          tr.obj.visible = false;
          tr.s = -1000 - i * 45;
          return;
        }
        if (tr.s < -500) tr.s = sMouth - i * 38;
        tr.s += dt * 0.42;
        if (tr.s > sEnd) tr.s = sMouth - 20;
        tr.obj.visible = tr.s > sMouth - 1.2;
        const yaw = streamAt(streamPts, Math.max(tr.s, 0), tmp);
        tr.obj.position.set(tmp.x + Math.sin(tr.s * 0.37 + i) * 0.35, tmp.y + 0.01 + Math.sin(t * 1.3 + i) * 0.01, tmp.z);
        tr.obj.rotation.set(Math.sin(t * 1.1 + i) * 0.03, yaw + tr.spin * 6.28 + tr.s * 0.05, Math.cos(t * 0.9 + i) * 0.03);
        const d = tr.obj.position.distanceTo(camera.position);
        if (tr.obj.visible && d < nd) {
          nd = d;
          nearest = tr;
        }
      });
      toroLight.intensity = nearest ? 1.4 * G.uLanterns.value : 0;
      if (nearest) toroLight.position.copy(nearest.obj.position).add(new Vector3(0, 0.18, 0));

      // fireflies
      const on = MathUtils.clamp((night - 0.5) * 2.0, 0, 1);
      flyMat.uniforms.uOn.value = on;
      flies.visible = on > 0.01;
      if (flies.visible) {
        for (let i = 0; i < nFlies; i++) {
          const h = home[i];
          const s = flyData[i * 4];
          flyPos[i * 3] = h.x + Math.sin(t * 0.21 + s) * 1.2 + Math.sin(t * 0.53 + s * 2) * 0.4;
          flyPos[i * 3 + 1] = h.y + Math.sin(t * 0.31 + s * 3) * 0.35;
          flyPos[i * 3 + 2] = h.z + Math.cos(t * 0.17 + s) * 1.2 + Math.cos(t * 0.47 + s * 1.5) * 0.4;
        }
        flyGeo.attributes.position.needsUpdate = true;
      }

      // wind chime: damped pendulum driven by gusts
      const gust = G.uWind.value.z * (0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1.0));
      chime.vel += (-chime.angle * 18 + gust * 2.2 * Math.sin(t * 2.3)) * dt;
      chime.vel *= Math.exp(-dt * 1.4);
      chime.angle += chime.vel * dt;
      furin.rotation.set(chime.angle, 0.3, chime.angle * 0.5);
      chime.ring = Math.abs(chime.vel) > 0.35 && t - chime.last > 0.6;
      if (chime.ring) chime.last = t;

      // dust motes catch the light
      dustMat.uniforms.uCam.value.copy(camera.position);
      dustMat.uniforms.uAmt.value = (timeName === 'golden' ? 1.6 : timeName === 'afternoon' ? 0.7 : 0) * (1 - night);
      dust.visible = dustMat.uniforms.uAmt.value > 0.01;
    },
    chime,
  };
  return api;
}
