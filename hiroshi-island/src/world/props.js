import {
  Box3,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';

/**
 * Shared world-space effects for solid props: moss on upward faces, darker &
 * glossier when wet (below / near the water line), optional fine detail
 * normal from the tileable rock texture.
 */
export function patchWeathering(mat, { hf, moss, mossAmount = 0.6, wetLine = true, cacheKey = 'weather' }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    addShared(shader, {
      tWaterLvl: { value: hf.waterTexture },
      uTSize: { value: hf.size },
      tMossA: { value: moss.alb },
      tMossN: { value: moss.nrm },
      uMossAmount: { value: mossAmount },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;\nvarying vec3 vPN;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          mat4 mw = modelMatrix;
          #ifdef USE_INSTANCING
            mw = modelMatrix * instanceMatrix;
          #endif
          vPW = (mw * vec4(transformed, 1.0)).xyz;
          vPN = normalize(mat3(mw) * objectNormal);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${GLSL_UNIFORMS}
        ${GLSL_COMMON}
        uniform sampler2D tWaterLvl;
        uniform float uTSize;
        uniform sampler2D tMossA;
        uniform sampler2D tMossN;
        uniform float uMossAmount;
        varying vec3 vPW;
        varying vec3 vPN;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        float wl = texture2D(tWaterLvl, vPW.xz / uTSize + 0.5).r;
        float above = vPW.y - wl;
        float wetK = ${wetLine ? 'smoothstep(0.12, -0.02, above + (vnoise(vPW.xz * 6.0) - 0.5) * 0.06)' : '0.0'};
        float up = clamp(normalize(vPN).y, 0.0, 1.0);
        float mossN = fbm2(vPW.xz * 0.9 + vPW.y * 0.6);
        float mossK = smoothstep(0.45, 0.85, up + (mossN - 0.5) * 0.7) * uMossAmount * smoothstep(-0.05, 0.25, above);
        mossK *= smoothstep(0.25, 0.55, mossN + up * 0.3);
        vec3 mossC = texture2D(tMossA, vPW.xz / 0.8).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, mossC, mossK);
        roughnessFactor = mix(roughnessFactor, 0.9, mossK);
        diffuseColor.rgb *= mix(1.0, 0.45, wetK);
        roughnessFactor = mix(roughnessFactor, 0.18, wetK);
        // faint darker band of dried water marks just above the line
        diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.35, 0.05, above) * (1.0 - wetK);
        `,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${cacheKey}`;
  return mat;
}

/** Boulders from blender/rocks.py, instanced per variant. */
export function createRocks(gltf, maps, layout, hf, moss) {
  const meshes = [];
  const variants = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh && /^rock_\d$/.test(o.name)) variants[+o.name.slice(5)] = o;
  });
  const mat = new MeshStandardMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    roughnessMap: maps.orm,
    aoMap: maps.orm,
    aoMapIntensity: 1,
    roughness: 1,
    metalness: 0,
    normalScale: new Vector2(1.2, -1.2), // glTF uv + derivative tangents
  });
  patchWeathering(mat, { hf, moss, mossAmount: 0.75, cacheKey: 'rocks' });

  const heights = variants.map((m) => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y;
  });
  const items = variants.map(() => []);
  const colliders = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const s = new Vector3();
  const p = new Vector3();
  let seed = 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const place = (r, isStep) => {
    const v = Math.min(r.v, variants.length - 1);
    const size = r.size;
    const sy = isStep ? size * 0.9 : size * (0.72 + 0.4 * (r.squash ?? 0.8));
    const h = heights[v] * sy;
    const ground = hf.height(r.p[0], r.p[2]);
    const y = isStep ? r.top - h : ground - (r.sink ?? 0.3) * h;
    e.set((rnd() - 0.5) * 0.25, (r.yaw * Math.PI) / 180, (rnd() - 0.5) * 0.25);
    q.setFromEuler(e);
    s.set(size, sy, size);
    p.set(r.p[0], y, r.p[2]);
    m4.compose(p, q, s);
    items[v].push(m4.clone());
    if (size > 0.45) colliders.push({ x: r.p[0], z: r.p[2], r: size * 0.42, top: y + h * 0.92, step: isStep });
  };
  layout.rocks.forEach((r) => place(r, false));
  layout.stepping.forEach((r) => place(r, true));

  variants.forEach((src, v) => {
    if (!items[v].length) return;
    const im = new InstancedMesh(src.geometry, mat, items[v].length);
    items[v].forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = `rocks-${v}`;
    meshes.push(im);
  });
  return { meshes, colliders };
}
