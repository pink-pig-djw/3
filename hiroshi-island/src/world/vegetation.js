import {
  DoubleSide,
  Frustum,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBADepthPacking,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { GLSL_COMMON, GLSL_UNIFORMS, addShared } from './shaderlib.js';
import { TRANSLUCENCY_GLSL } from './grass.js';

/** Vertex wind for meshes exported with the _WIND attribute (see blender/vegetation.py). */
const WIND_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 instPos = instanceMatrix[3].xyz;
  mat3 instRot = mat3(instanceMatrix);
#else
  vec3 instPos = vec3(0.0);
  mat3 instRot = mat3(1.0);
#endif
  {
    float sway = _wind.x;
    float phase = _wind.y * 6.2831853;
    float flutter = _wind.z;
    float flex = _wind.w;
    float gust = windGust(instPos.xz);
    float tp = uTime + dot(instPos.xz, vec2(0.13, 0.17));
    vec3 wdirO = normalize(transpose(instRot) * vec3(uWind.x, 0.0, uWind.y));
    float strength = uWind.z;
    // whole crown leans and sways with the gusts
    float bend = sway * (0.55 * gust + 0.12 * strength * sin(tp * 0.8 + phase * 0.1));
    transformed += wdirO * bend * uWindScale;
    transformed.y -= bend * bend * 0.15 * uWindScale;
    // branches bob
    transformed += vec3(sin(tp * 1.9 + phase), sin(tp * 1.4 + phase * 1.3) * 0.5, cos(tp * 1.6 + phase * 0.7))
      * 0.045 * sway * flex * (0.35 + gust * 1.6) * uWindScale;
    // leaves flutter
    transformed += normal * sin(tp * 11.0 + phase * 5.0 + dot(position, vec3(3.1, 2.3, 2.9)))
      * 0.03 * flutter * (0.25 + gust * 1.8);
  }
`;

function patchWind(mat, { scale = 1, leaves = false, cacheKey }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    addShared(shader, { uWindScale: { value: scale }, uTranslucency: { value: 0.32 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_UNIFORMS}\n${GLSL_COMMON}\nattribute vec4 _wind;\nuniform float uWindScale;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}`);
    if (leaves && shader.fragmentShader.includes('#include <lights_fragment_end>')) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTranslucency;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TRANSLUCENCY_GLSL}`);
    }
  };
  const pk = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${pk ? pk() : ''}|wind-${cacheKey}`;
  return mat;
}

function leafMaterials(maps, key) {
  const mat = new MeshStandardMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    normalScale: new Vector2(0.9, -0.9),
    alphaTest: 0.5,
    side: DoubleSide,
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
  });
  patchWind(mat, { leaves: true, cacheKey: key });
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: maps.albedo, alphaTest: 0.5 });
  patchWind(depth, { cacheKey: key + '-depth' });
  return { mat, depth };
}

function barkMaterial(maps, key) {
  const mat = new MeshStandardMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    normalScale: new Vector2(1.3, -1.3),
    roughnessMap: maps.orm,
    aoMap: maps.orm,
    roughness: 1,
    metalness: 0,
    vertexColors: false,
  });
  patchWind(mat, { cacheKey: key });
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  patchWind(depth, { cacheKey: key + '-depth' });
  return { mat, depth };
}

/**
 * Instanced vegetation with per-frame CPU culling and distance LOD. Instance
 * buffers are rewritten with only the visible instances (cheap for ~1000).
 */
class InstancedSet {
  constructor({ name, items, lods, maxDistance, shadowRange = 55 }) {
    this.name = name;
    this.items = items; // [{ matrix, pos, radius }]
    this.lods = lods; // [{ parts: [{geometry, material, depth}], maxDist }]
    this.maxDistance = maxDistance;
    this.shadowRange = shadowRange;
    this.meshes = [];
    for (const lod of lods) {
      lod.meshes = lod.parts.map((part) => {
        const im = new InstancedMesh(part.geometry, part.material, items.length);
        im.customDepthMaterial = part.depth;
        im.castShadow = part.castShadow ?? true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.name = `${name}-${part.name}`;
        this.meshes.push(im);
        return im;
      });
    }
    this.frustum = new Frustum();
    this.pm = new Matrix4();
    this.sphere = new Sphere();
  }

  update(camera, force = false) {
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const cp = camera.position;
    const counts = this.lods.map(() => 0);
    for (const it of this.items) {
      const d = it.pos.distanceTo(cp);
      if (d > this.maxDistance + it.radius) continue;
      this.sphere.center.copy(it.pos);
      this.sphere.radius = it.radius;
      if (d > this.shadowRange && !this.frustum.intersectsSphere(this.sphere)) continue;
      let li = this.lods.findIndex((l) => d < l.maxDist);
      if (li < 0) li = this.lods.length - 1;
      const lod = this.lods[li];
      for (const im of lod.meshes) im.setMatrixAt(counts[li], it.matrix);
      counts[li]++;
    }
    this.lods.forEach((lod, li) => {
      for (const im of lod.meshes) {
        im.count = counts[li];
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}

function partsOf(obj) {
  const parts = [];
  obj.traverse((o) => {
    if (o.isMesh) parts.push(o);
  });
  return parts;
}

export function createVegetation(gltfTrees, gltfPlants, maps, layout, hf, quality) {
  const leaves = leafMaterials(maps.foliage, 'leaves');
  const bark = barkMaterial(maps.bark, 'bark');
  const reedMat = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.6 });
  patchWind(reedMat, { leaves: true, cacheKey: 'reeds' });
  const reedDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  patchWind(reedDepth, { cacheKey: 'reeds-depth' });

  const byName = {};
  for (const g of [gltfTrees, gltfPlants]) {
    g.scene.traverse((o) => {
      if (o.name && (o.isMesh || o.isGroup || o.isObject3D)) byName[o.name] ??= o;
    });
  }
  const toParts = (obj) =>
    partsOf(obj).map((m) => {
      const isLeaf = m.material?.name?.startsWith('leaves');
      const isReed = m.material?.name?.startsWith('reed');
      return {
        name: isLeaf ? 'leaves' : isReed ? 'reeds' : 'bark',
        geometry: m.geometry,
        material: isLeaf ? leaves.mat : isReed ? reedMat : bark.mat,
        depth: isLeaf ? leaves.depth : isReed ? reedDepth : bark.depth,
      };
    });

  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const mk = (x, y, z, yawDeg, s, radius) => {
    q.setFromAxisAngle(up, (yawDeg * Math.PI) / 180);
    const pos = new Vector3(x, y, z);
    m4.compose(pos, q, new Vector3(s, s, s));
    return { matrix: m4.clone(), pos: pos.clone().add(new Vector3(0, radius * 0.7, 0)), radius };
  };

  const sets = [];
  const colliders = [];
  // trees: one set per variant
  for (let v = 0; v < 4; v++) {
    const items = layout.trees
      .filter((t) => t.v === v)
      .map((t) => {
        const y = hf.height(t.p[0], t.p[2]) - 0.15;
        colliders.push({ x: t.p[0], z: t.p[2], r: 0.38 * t.s, top: y + 30, tree: true });
        return mk(t.p[0], y, t.p[2], t.yaw, t.s, 7 * t.s);
      });
    const lod0 = byName[`tree_${v}`];
    const lod1 = byName[`tree_${v}_lod1`];
    sets.push(
      new InstancedSet({
        name: `tree${v}`,
        items,
        lods: [
          { parts: toParts(lod0), maxDist: 70 },
          { parts: toParts(lod1), maxDist: Infinity },
        ],
        maxDistance: quality.treeDistance,
      }),
    );
  }
  // bushes
  for (let v = 0; v < 2; v++) {
    const items = layout.bushes
      .filter((b) => b.v === v)
      .map((b) => mk(b.p[0], hf.height(b.p[0], b.p[2]) - 0.05, b.p[2], b.yaw, b.s, 1.2 * b.s));
    sets.push(
      new InstancedSet({
        name: `bush${v}`,
        items,
        lods: [{ parts: toParts(byName[`bush_${v}`]), maxDist: Infinity }],
        maxDistance: quality.smallPlantDistance * 1.4,
        shadowRange: 25,
      }),
    );
  }
  sets.push(
    new InstancedSet({
      name: 'ferns',
      items: layout.ferns.map((f) => mk(f.p[0], hf.height(f.p[0], f.p[2]) - 0.03, f.p[2], f.yaw, f.s, 0.9 * f.s)),
      lods: [{ parts: toParts(byName.fern), maxDist: Infinity }],
      maxDistance: quality.smallPlantDistance,
      shadowRange: 15,
    }),
  );
  sets.push(
    new InstancedSet({
      name: 'reeds',
      items: layout.reeds.map((r) => mk(r.p[0], hf.height(r.p[0], r.p[2]) - 0.05, r.p[2], r.yaw, r.s, 1.2)),
      lods: [{ parts: toParts(byName.reeds), maxDist: Infinity }],
      maxDistance: quality.smallPlantDistance * 1.3,
      shadowRange: 20,
    }),
  );

  const meshes = sets.flatMap((s) => s.meshes);
  let timer = 0;
  const last = new Vector3(1e9, 0, 0);
  const lastQ = new Quaternion();
  return {
    meshes,
    colliders,
    sets,
    update(dt, camera) {
      timer -= dt;
      const moved = camera.position.distanceToSquared(last) > 0.25 || camera.quaternion.angleTo(lastQ) > 0.03;
      if (moved || timer <= 0) {
        for (const s of sets) s.update(camera);
        last.copy(camera.position);
        lastQ.copy(camera.quaternion);
        timer = 0.5;
      }
    },
  };
}
