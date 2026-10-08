import { Group, Vector3 } from 'three';
import { Heightfield, TERRAIN_LAYERS, createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { TimeOfDay } from './timeofday.js';
import { createGrass } from './grass.js';
import { createRocks } from './props.js';
import { createVegetation } from './vegetation.js';
import { createArchitecture } from './architecture.js';
import { G } from './shaderlib.js';

/** Loads everything produced by the Blender pipeline and assembles the valley. */
export class World {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.root = new Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.updaters = [];
  }

  async load(assets) {
    const [meta, heights, far, water, stream, layout] = await Promise.all([
      assets.json('data/terrain.json'),
      assets.floats('data/terrain_height.bin'),
      assets.floats('data/terrain_far.bin'),
      assets.floats('data/water_level.bin'),
      assets.json('data/stream.json'),
      assets.json('data/layout.json'),
    ]);
    this.layout = layout;
    this.stream = stream;
    this.hf = new Heightfield(meta, heights, water, far);
    G.uTerrainSize.value = meta.size;

    const texMeta = await assets.json('textures/textures.json');
    const layerPaths = (kind) => TERRAIN_LAYERS.map((n) => `textures/${n}_${kind}.webp`);
    const [alb, nrm, orm, splat, masks, ripples, foam] = await Promise.all([
      assets.textureArray(layerPaths('albedo'), { srgb: true }),
      assets.textureArray(layerPaths('normal')),
      assets.textureArray(layerPaths('orm')),
      assets.texture('textures/splat.png', { repeat: false, flipY: false, aniso: false }),
      assets.texture('textures/masks.png', { repeat: false, flipY: false, aniso: false }),
      assets.texture('textures/water_ripples.webp'),
      assets.texture('textures/water_foam.webp'),
    ]);
    const tiles = TERRAIN_LAYERS.map((n) => texMeta[n]?.size ?? 2);

    this.time = new TimeOfDay(this.renderer, this.scene, this.quality);

    const terrain = createTerrain(this.hf, { alb, nrm, orm, splat, masks, tiles });
    this.terrain = terrain;
    this.root.add(terrain.near, terrain.far);

    this.water = createWater(stream, { ripples, foam });
    this.water.userData.uniforms.uSSR.value = this.quality.ssr ? 1 : 0;
    this.root.add(this.water);

    this.grass = createGrass(this.hf, masks, this.quality);
    this.root.add(...this.grass.meshes);

    // ---- props -----------------------------------------------------------
    const [rocksGltf, rAlb, rNrm, rOrm, mossA, mossN] = await Promise.all([
      assets.gltf('models/rocks.glb'),
      assets.texture('textures/rocks_albedo.webp', { srgb: true, flipY: false, repeat: false }),
      assets.texture('textures/rocks_normal.webp', { flipY: false, repeat: false }),
      assets.texture('textures/rocks_orm.webp', { flipY: false, repeat: false }),
      assets.texture('textures/moss_albedo.webp', { srgb: true }),
      assets.texture('textures/moss_normal.webp'),
    ]);
    this.moss = { alb: mossA, nrm: mossN };
    const rocks = createRocks(rocksGltf, { albedo: rAlb, normal: rNrm, orm: rOrm }, layout, this.hf, this.moss);
    this.root.add(...rocks.meshes);

    // ---- vegetation --------------------------------------------------------
    const [treesGltf, plantsGltf, fA, fN, bA, bN, bO] = await Promise.all([
      assets.gltf('models/trees.glb'),
      assets.gltf('models/plants.glb'),
      assets.texture('textures/foliage_albedo.webp', { srgb: true, flipY: false, repeat: false }),
      assets.texture('textures/foliage_normal.webp', { flipY: false, repeat: false }),
      assets.texture('textures/bark_albedo.webp', { srgb: true, flipY: false }),
      assets.texture('textures/bark_normal.webp', { flipY: false }),
      assets.texture('textures/bark_orm.webp', { flipY: false }),
    ]);
    this.vegetation = createVegetation(
      treesGltf,
      plantsGltf,
      { foliage: { albedo: fA, normal: fN }, bark: { albedo: bA, normal: bN, orm: bO } },
      layout,
      this.hf,
      this.quality,
    );
    this.root.add(...this.vegetation.meshes);
    this.updaters.push((dt, cam) => this.vegetation.update(dt, cam));

    // ---- architecture --------------------------------------------------------
    const set = (name) =>
      Promise.all(['albedo', 'normal', 'orm'].map((k) =>
        assets.texture(`textures/${name}_${k}.webp`, { srgb: k === 'albedo', flipY: false }))).then(([albedo, normal, orm]) => ({ albedo, normal, orm }));
    const [archGltf, rock, wood, plaster, kawara] = await Promise.all([
      assets.gltf('models/architecture.glb'),
      set('rock'),
      set('wood'),
      set('plaster'),
      set('kawara'),
    ]);
    this.arch = createArchitecture(archGltf, { rock, wood, plaster, kawara }, layout, this.hf, this.moss);
    this.root.add(...this.arch.objects);
    this.updaters.push((dt, cam) => this.arch.update(dt, cam));

    this.colliders = [...rocks.colliders, ...this.vegetation.colliders, ...this.arch.colliders];
    this.platforms = this.arch.platforms;
    return this;
  }

  /** Start position from the layout, on the ground. */
  startPose() {
    const s = this.layout.start;
    return {
      position: new Vector3(s.x, this.hf.height(s.x, s.z), s.z),
      yaw: (s.yaw_deg * Math.PI) / 180,
      pitch: (s.pitch_deg * Math.PI) / 180,
    };
  }

  update(dt, camera) {
    G.uTime.value += dt;
    G.uPlayer.value.copy(camera.position);
    G.uWind.value.w += dt;
    this.time.update(dt, camera.position);
    for (const fn of this.updaters) fn(dt, camera);
  }
}
