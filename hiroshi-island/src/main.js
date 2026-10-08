import { NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { Assets } from './core/assets.js';
import { Pipeline } from './core/pipeline.js';
import { SoundScape } from './core/audio.js';
import { QUALITY, pickQuality } from './config.js';
import { installFogChunks } from './world/shaderlib.js';
import { World } from './world/world.js';
import { createLife } from './world/life.js';
import { Input } from './game/input.js';
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';

installFogChunks();

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot'); // headless screenshot mode (see README)
// a quality switch that couldn't be saved survives the reload in the hash
const HASH_QUALITY = /^#q-(low|medium|high)$/.exec(location.hash)?.[1];

function loadSettings() {
  const d = { quality: pickQuality().name, sens: 1, volume: 0.8 };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('hiroshi.settings') || '{}');
  } catch {
    /* storage may be unavailable */
  }
  const forced = params.get('quality') || HASH_QUALITY;
  return { ...d, ...saved, ...(forced ? { quality: forced } : {}) };
}
const settings = loadSettings();
const quality = QUALITY[settings.quality] ?? QUALITY.medium;

const canvas = document.getElementById('view');
const ui = new UI(document.getElementById('ui'));
let renderer;
try {
  renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: SHOT,
  });
} catch (e) {
  ui.fatal('这个浏览器打不开 WebGL 2，岛画不出来。请换用最新版的 Chrome、Edge、Safari 或 Firefox，并打开硬件加速。');
  throw e;
}
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.setPixelRatio(quality.pixelRatio);

const scene = new Scene();
const camera = new PerspectiveCamera(62, 1, 0.1, 4000);
camera.rotation.order = 'YXZ';

const assets = new Assets(renderer, (done, total) => ui.progress(done, total));
const world = new World(renderer, scene, quality);
const audio = new SoundScape();
audio.setVolume(settings.volume);
const input = new Input(canvas);
let pipeline = null;
let game = null;
let life = null;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline?.setSize(w, h);
}

function saveSettings() {
  try {
    localStorage.setItem('hiroshi.settings', JSON.stringify(settings));
    return JSON.parse(localStorage.getItem('hiroshi.settings')).quality === settings.quality;
  } catch {
    return false;
  }
}

ui.on('setting', (k, v) => {
  if (k === 'quality') {
    settings.quality = v;
    const saved = saveSettings();
    ui.toast('正在用新的画质重新载入……', 2500);
    setTimeout(() => {
      if (!saved || HASH_QUALITY) location.hash = `q-${v}`;
      location.reload();
    }, 600);
  } else if (k === 'sens') {
    settings.sens = Number(v);
    if (game) game.player.sensitivity = 0.0022 * settings.sens;
    saveSettings();
  } else if (k === 'volume') {
    settings.volume = Number(v);
    audio.setVolume(settings.volume);
    saveSettings();
  }
});

/** What a live update of the page should carry over (see the end of this file). */
function snapshot() {
  if (!game || ['title', 'intro'].includes(game.state)) return null;
  const p = game.player;
  return { pose: [p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch], time: world.time.current };
}

async function boot(resume) {
  await world.load(assets);
  const creatures = await assets.gltf('models/creatures.glb');
  life = createLife(creatures, world);
  world.root.add(...life.objects);

  world.water.userData.uniforms.uProj = { value: camera.projectionMatrix };
  pipeline = new Pipeline(renderer, scene, camera, world.water, quality);
  resize();
  window.addEventListener('resize', resize);

  game = new Game({ renderer, camera, world, pipeline, input, ui, audio, life, settings });
  world.time.onChange(() => {
    const s = world.time.to ?? world.time.state;
    pipeline.setLook({ contrast: s.contrast, sat: s.sat, warmth: s.warmth });
  });

  // initial view behind the title screen: the stream, looking up to the culvert
  const time = params.get('time') || game.save.time || 'afternoon';
  world.time.set(time, 0);
  const s0 = world.layout.start;
  game.player.place({ position: new Vector3(s0.x, 0, s0.z), yaw: (-s0.yaw_deg * Math.PI) / 180, pitch: (s0.pitch_deg * Math.PI) / 180 });
  game.player.apply(camera, { steady: true });

  if (SHOT) {
    // camera pose override: cam=x,y,z,yawDeg,pitchDeg (yaw clockwise from north)
    const camParam = params.get('cam');
    if (camParam) {
      const [x, y, z, yw, pt] = camParam.split(',').map(Number);
      game.player.pos.set(x, y - 1.62, z);
      game.player.yaw = (-yw * Math.PI) / 180;
      game.player.pitch = (pt * Math.PI) / 180;
    }
    if (params.has('raise')) {
      game.dslr.setRaised(true);
      game.dslr.raiseT = 1;
      game.dslr.focalIndex = Number(params.get('focal') ?? 2);
      game.dslr.focal = [24, 28, 35, 50, 70, 85, 105, 135, 200][game.dslr.focalIndex];
      game.dslr.fIndex = Number(params.get('fi') ?? 2);
    }
    ui.show('loading', false);
    if (params.has('title')) ui.loaded();
    if (params.has('ui')) {
      ui.hud(true);
      ui.setTime(time, ['afternoon', 'golden', 'blue', 'night']);
    }
  } else if (resume?.pose) {
    game.restore(resume);
  } else {
    ui.loaded();
  }

  // test hooks (used by the headless smoke test, harmless otherwise)
  if (params.has('test')) window.__game = { game, world, life, pipeline, camera, ui };

  let last = performance.now();
  let frames = 0;
  const shotFrames = SHOT ? Number(params.get('frames') || 3) : 0;
  const loop = () => {
    const now = performance.now();
    const dt = params.has('test') ? 1 / 30 : Math.min((now - last) / 1000, 0.1);
    last = now;
    if (SHOT) {
      game.player.apply(camera, { steady: true });
      game.dslr.update(1 / 30);
      if (params.has('raise')) ui.viewfinder(true, game.dslr.info());
    } else {
      game.update(dt);
      if (game.state === 'title') {
        game.player.yaw += dt * 0.004; // slow drift behind the title
        game.player.apply(camera, { steady: true });
      }
    }
    world.update(SHOT ? 1 / 30 : dt, camera);
    life.update(SHOT ? 1 / 30 : dt, camera, world.time.current);
    pipeline.world.exposure = world.time.exposure;
    pipeline.look.uniforms.get('uNight').value = world.time.night;
    pipeline.render(dt);
    game.postRender();
    if (!SHOT) game.updateAudio(dt);
    frames++;
    if (shotFrames && frames >= shotFrames) {
      window.__ready = true;
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function start(data) {
  boot(data).catch((e) => {
    console.error(e);
    window.__error = String(e && e.stack ? e.stack : e);
    ui.fatal(`载入失败：${e.message || e}。刷新页面再试一次。`);
  });
}

// When the page is republished while someone is playing, the host hands the
// snapshot to the new version so the walk continues where it was.
const hot = window.claude?.hot;
hot?.snapshot?.(snapshot);
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
