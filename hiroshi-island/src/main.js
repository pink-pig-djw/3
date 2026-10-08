import { PerspectiveCamera, Scene, SRGBColorSpace, NoToneMapping, PCFShadowMap, WebGLRenderer, Vector3 } from 'three';
import { Assets } from './core/assets.js';
import { Pipeline } from './core/pipeline.js';
import { pickQuality } from './config.js';
import { installFogChunks } from './world/shaderlib.js';
import { World } from './world/world.js';

installFogChunks();

const params = new URLSearchParams(location.search);
const quality = pickQuality();
const canvas = document.getElementById('view');
const renderer = new WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
  preserveDrawingBuffer: params.has('shot'),
});
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.setPixelRatio(quality.pixelRatio);

const scene = new Scene();
const camera = new PerspectiveCamera(60, 1, 0.1, 4000);

const assets = new Assets(renderer, (done, total) => {
  window.dispatchEvent(new CustomEvent('hiroshi:progress', { detail: { done, total } }));
});

const world = new World(renderer, scene, quality);
let pipeline = null;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (pipeline) {
    const s = renderer.getDrawingBufferSize(new Vector3());
    pipeline.setSize(w, h);
  }
}

async function boot() {
  await world.load(assets);
  world.water.userData.uniforms.uProj = { value: camera.projectionMatrix };
  pipeline = new Pipeline(renderer, scene, camera, world.water, quality);
  resize();
  window.addEventListener('resize', resize);

  const time = params.get('time') || 'afternoon';
  world.time.set(time, 0);

  const pose = world.startPose();
  camera.position.copy(pose.position).add(new Vector3(0, 1.62, 0));
  let yaw = pose.yaw;
  let pitch = pose.pitch;
  const camParam = params.get('cam');
  if (camParam) {
    const [x, y, z, yw, pt] = camParam.split(',').map(Number);
    camera.position.set(x, y, z);
    yaw = (yw * Math.PI) / 180;
    pitch = (pt * Math.PI) / 180;
  }
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, -yaw, 0);

  let last = performance.now();
  let frames = 0;
  const shotFrames = params.has('shot') ? Number(params.get('frames') || 3) : 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    world.update(dt, camera);
    pipeline.world.exposure = world.time.exposure;
    pipeline.render(dt);
    frames++;
    if (shotFrames && frames >= shotFrames) {
      window.__ready = true; // headless screenshots: stop rendering, keep the last frame
      return;
    }
    if (frames === 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  window.__error = String(e && e.stack ? e.stack : e);
});
