// All textures are painted at start-up on canvases, so the game ships no images.
import * as THREE from 'three';

const DISPLAY_FONT = '"Bungee", "Arial Black", Impact, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Small deterministic RNG so textures look the same every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- graffiti ----------
const TAGS = ['DASH', 'MD', 'ORANGE', 'RUN!', 'GO', 'ZOOM', 'HEY', 'LINE 3', 'YO', 'FLOW', 'SKRR', 'POP'];
const SPRAY = ['#ff7a1a', '#ff3d7f', '#2ee6d6', '#ffd23f', '#7b4dff', '#43e97b', '#ff4d4d', '#3da5ff'];

function graffiti(g, x, y, size, rand, text) {
  const fill = SPRAY[Math.floor(rand() * SPRAY.length)];
  let outline = SPRAY[Math.floor(rand() * SPRAY.length)];
  if (outline === fill) outline = '#1b1530';
  g.save();
  g.translate(x, y);
  g.rotate((rand() - 0.5) * 0.25);
  g.font = `900 ${size}px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // drop shadow / 3D offset
  g.fillStyle = '#1b1530';
  g.fillText(text, size * 0.06, size * 0.08);
  g.lineWidth = size * 0.22;
  g.strokeStyle = '#1b1530';
  g.strokeText(text, 0, 0);
  g.lineWidth = size * 0.12;
  g.strokeStyle = outline;
  g.strokeText(text, 0, 0);
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  // highlight
  g.globalAlpha = 0.35;
  g.fillStyle = '#ffffff';
  g.fillText(text, -size * 0.03, -size * 0.05);
  g.globalAlpha = 1;
  // drips
  const w = g.measureText(text).width;
  g.fillStyle = fill;
  for (let i = 0; i < 4; i++) {
    const dx = (rand() - 0.5) * w * 0.8;
    const len = size * (0.2 + rand() * 0.5);
    g.fillRect(dx, size * 0.3, size * 0.05, len);
    g.beginPath(); g.arc(dx + size * 0.025, size * 0.3 + len, size * 0.04, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// ---------- trains ----------
// Atlas layout (1024 x 512 canvas):
//   side  : 0..1024 x 0..256
//   front : 0..256 x 256..512
//   roof  : 256..512 x 256..512
//   dark  : 512..640 x 256..384
export const TRAIN_ATLAS = {
  W: 1024, H: 512,
  side: [0, 0, 1024, 256],
  front: [0, 256, 256, 256],
  roof: [256, 256, 256, 256],
  dark: [520, 264, 112, 112],
  light: [656, 264, 96, 96],
};

export const TRAIN_VARIANTS = [
  { body: '#d9dde4', stripe: '#ff7a1a', stripe2: '#1d2b55', door: '#c3c8d1' },
  { body: '#2f6fd6', stripe: '#ffffff', stripe2: '#ffd23f', door: '#2a62bd' },
  { body: '#1fa97c', stripe: '#ffe066', stripe2: '#0d4f3c', door: '#1b9670' },
  { body: '#e2463f', stripe: '#fff3d6', stripe2: '#7a1d1a', door: '#cf3d37' },
];

// Returns { map, glow }: glow lights the windows and lamps after dark.
export function makeTrainTexture(variant, seed) {
  const rand = rng(seed);
  const [c, g] = canvas(TRAIN_ATLAS.W, TRAIN_ATLAS.H);
  const [gc, gg] = canvas(TRAIN_ATLAS.W, TRAIN_ATLAS.H);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, TRAIN_ATLAS.W, TRAIN_ATLAS.H);
  gg.fillStyle = '#ffe2a6';
  const v = variant;
  // ---- side ----
  g.fillStyle = v.body; g.fillRect(0, 0, 1024, 256);
  // panel lines
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < 1024; x += 128) g.fillRect(x, 0, 2, 256);
  // roof edge
  const grad = g.createLinearGradient(0, 0, 0, 26);
  grad.addColorStop(0, '#f2f4f7'); grad.addColorStop(1, '#9aa1ad');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 26);
  // stripes
  g.fillStyle = v.stripe; g.fillRect(0, 150, 1024, 18);
  g.fillStyle = v.stripe2; g.fillRect(0, 170, 1024, 6);
  // windows
  const winY = 48, winH = 78;
  const doors = [200, 760];
  for (let x = 30; x < 1000; x += 118) {
    if (doors.some((d) => Math.abs(x + 45 - d) < 90)) continue;
    roundRect(g, x, winY, 92, winH, 10);
    const wg = g.createLinearGradient(x, winY, x + 92, winY + winH);
    wg.addColorStop(0, '#2b3f6b'); wg.addColorStop(0.55, '#13203d'); wg.addColorStop(1, '#22365f');
    g.fillStyle = wg; g.fill();
    gg.fillRect(x + 4, winY + 4, 84, winH - 8);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.moveTo(x + 10, winY + winH - 6); g.lineTo(x + 40, winY + 6); g.lineTo(x + 56, winY + 6); g.lineTo(x + 26, winY + winH - 6); g.fill();
  }
  // doors
  for (const d of doors) {
    g.fillStyle = v.door; g.fillRect(d - 70, 36, 140, 214);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(d - 1, 36, 2, 214);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3; g.strokeRect(d - 70, 36, 140, 214);
    for (const s of [-1, 1]) {
      roundRect(g, d + s * 35 - 22, 52, 44, 92, 8);
      g.fillStyle = '#17264a'; g.fill();
      gg.fillRect(d + s * 35 - 18, 56, 36, 84);
    }
    g.fillStyle = v.stripe; g.fillRect(d - 70, 150, 140, 18);
  }
  // skirt
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 226, 1024, 30);
  // graffiti on some cars
  if (rand() < 0.75) {
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const x = 320 + i * 260 + rand() * 80;
      graffiti(g, x, 200, 46 + rand() * 18, rand, TAGS[Math.floor(rand() * TAGS.length)]);
    }
  }
  // car number
  g.fillStyle = 'rgba(20,20,40,0.75)';
  g.font = `bold 22px ${DISPLAY_FONT}`;
  g.fillText(`${3000 + Math.floor(rand() * 900)}`, 40, 200);

  // ---- front ----
  const [fx, fy] = TRAIN_ATLAS.front;
  g.fillStyle = v.body; g.fillRect(fx, fy, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(fx, fy, 256, 14);
  // destination sign
  g.fillStyle = '#121212'; roundRect(g, fx + 48, fy + 18, 160, 30, 6); g.fill();
  g.fillStyle = '#ffae2b'; g.font = `bold 20px ${DISPLAY_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(['M3 LOOP', 'EXPRESS', 'LINE 7', 'DEPOT'][seed % 4], fx + 128, fy + 34);
  // windshield
  roundRect(g, fx + 18, fy + 56, 220, 96, 18);
  const fg = g.createLinearGradient(fx, fy + 56, fx + 256, fy + 152);
  fg.addColorStop(0, '#34507f'); fg.addColorStop(0.5, '#0f1a33'); fg.addColorStop(1, '#2a4370');
  g.fillStyle = fg; g.fill();
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.beginPath(); g.moveTo(fx + 40, fy + 145); g.lineTo(fx + 90, fy + 62); g.lineTo(fx + 120, fy + 62); g.lineTo(fx + 70, fy + 145); g.fill();
  // stripe + lights
  g.fillStyle = v.stripe; g.fillRect(fx, fy + 166, 256, 20);
  for (const s of [-1, 1]) {
    g.fillStyle = '#20232b'; g.beginPath(); g.arc(fx + 128 + s * 82, fy + 206, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff6c9'; g.beginPath(); g.arc(fx + 128 + s * 82, fy + 206, 15, 0, Math.PI * 2); g.fill();
    gg.beginPath(); gg.arc(fx + 128 + s * 82, fy + 206, 17, 0, Math.PI * 2); gg.fill();
  }
  g.fillStyle = '#2a2d36'; g.fillRect(fx, fy + 232, 256, 24);
  g.fillStyle = '#ffd23f';
  for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(fx + x, fy + 256); g.lineTo(fx + x + 16, fy + 232); g.lineTo(fx + x + 28, fy + 232); g.lineTo(fx + x + 12, fy + 256); g.fill(); }

  // ---- roof ----
  const [rx, ry] = TRAIN_ATLAS.roof;
  g.fillStyle = '#a7adb8'; g.fillRect(rx, ry, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 8; x < 256; x += 22) g.fillRect(rx + x, ry, 4, 256);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(rx, ry, 256, 10); g.fillRect(rx, ry + 246, 256, 10);

  // ---- dark & light swatches ----
  const [dx, dy, dw, dh] = TRAIN_ATLAS.dark;
  g.fillStyle = '#2b2d35'; g.fillRect(dx, dy, dw, dh);
  const [lx, ly, lw, lh] = TRAIN_ATLAS.light;
  g.fillStyle = '#fff9d6'; g.fillRect(lx, ly, lw, lh);
  gg.fillRect(fx + 48, fy + 18, 160, 30); // destination sign
  return { map: toTexture(c), glow: toTexture(gc) };
}

// ---------- track bed (one lane wide, tiles along z) ----------
export function makeTrackTexture() {
  const rand = rng(7);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d7468'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const s = 1 + rand() * 3.5;
    const l = 35 + rand() * 40;
    g.fillStyle = `hsl(${25 + rand() * 20}, ${8 + rand() * 12}%, ${l}%)`;
    g.fillRect(rand() * 256, rand() * 256, s, s);
  }
  // 4 sleepers per tile
  for (let k = 0; k < 4; k++) {
    const y = k * 64 + 20;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(14, y + 4, 232, 26);
    g.fillStyle = '#6b4a32'; g.fillRect(12, y, 232, 24);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(12, y, 232, 5);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 20; x < 240; x += 37) g.fillRect(x, y + 6, 18, 2);
  }
  return toTexture(c, { repeat: true });
}

export function makeConcreteTexture() {
  const rand = rng(11);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + rand() * 0.06})`;
    g.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 256, 3); g.fillRect(0, 128, 256, 3); g.fillRect(0, 0, 3, 256);
  // yellow safety line along one edge
  g.fillStyle = '#f4c430'; g.fillRect(226, 0, 18, 256);
  return toTexture(c, { repeat: true });
}

// Four graffiti wall panels stacked vertically (1024 x 1024).
export function makeWallTexture() {
  const rand = rng(23);
  const [c, g] = canvas(1024, 1024);
  const bases = ['#c9c0b3', '#b7aea2', '#cfc6b8', '#bdb4a7'];
  const words = [['METRO', 'DASH'], ['七海', 'RUN'], ['LINE 3', 'GO GO'], ['ZOOM', 'HEY!']];
  for (let p = 0; p < 4; p++) {
    const y0 = p * 256;
    g.fillStyle = bases[p]; g.fillRect(0, y0, 1024, 256);
    // concrete blocks
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < 1024; x += 128) g.fillRect(x, y0, 3, 256);
    g.fillRect(0, y0 + 128, 1024, 3);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.07})`;
      g.fillRect(rand() * 1024, y0 + rand() * 256, 3, 3);
    }
    // colour splashes
    for (let i = 0; i < 3; i++) {
      g.fillStyle = SPRAY[Math.floor(rand() * SPRAY.length)];
      g.globalAlpha = 0.55;
      g.beginPath();
      g.ellipse(rand() * 1024, y0 + 80 + rand() * 120, 60 + rand() * 90, 30 + rand() * 40, rand(), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    graffiti(g, 270, y0 + 125, 92, rand, words[p][0]);
    graffiti(g, 760, y0 + 135, 80, rand, words[p][1]);
    // grime at the bottom
    const gg = g.createLinearGradient(0, y0 + 190, 0, y0 + 256);
    gg.addColorStop(0, 'rgba(40,30,20,0)'); gg.addColorStop(1, 'rgba(40,30,20,0.45)');
    g.fillStyle = gg; g.fillRect(0, y0 + 190, 1024, 66);
    // capping
    g.fillStyle = '#8e877c'; g.fillRect(0, y0, 1024, 12);
  }
  return toTexture(c);
}

export function makeBuildingTexture() {
  const rand = rng(31);
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = rand() < 0.25;
      g.fillStyle = lit ? '#fff1b8' : (rand() < 0.5 ? '#5b6f96' : '#4a5c80');
      g.fillRect(x * 64 + 12, y * 64 + 14, 40, 38);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x * 64 + 12, y * 64 + 14, 40, 5);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x * 64 + 8, y * 64 + 54, 48, 5);
    }
  }
  return toTexture(c, { repeat: true });
}

export function makeStripeTexture(a, b, n = 6) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = a; g.fillRect(0, 0, 256, 64);
  g.fillStyle = b;
  const w = 256 / n;
  for (let i = -1; i < n + 1; i++) {
    g.beginPath();
    g.moveTo(i * w, 64); g.lineTo(i * w + w * 0.5, 0); g.lineTo(i * w + w, 0); g.lineTo(i * w + w * 0.5, 64);
    g.fill();
  }
  return toTexture(c);
}

export function makeRampTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#5b5f69'; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y, 128, 3);
  }
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, 14, 256); g.fillRect(114, 0, 14, 256);
  g.fillStyle = '#1b1530';
  for (let y = 0; y < 256; y += 32) { g.fillRect(0, y, 14, 14); g.fillRect(114, y + 16, 14, 14); }
  return toTexture(c, { repeat: true });
}

export function makeCoinTexture() {
  const [c, g] = canvas(128, 128);
  const rg = g.createRadialGradient(54, 50, 6, 64, 64, 64);
  rg.addColorStop(0, '#fff6a8'); rg.addColorStop(0.55, '#ffcb2e'); rg.addColorStop(1, '#e89a00');
  g.fillStyle = rg; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c97f00'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
  // star
  g.fillStyle = '#ffe56b'; g.strokeStyle = '#c97f00'; g.lineWidth = 4;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 14 : 32;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath(); g.fill(); g.stroke();
  return toTexture(c);
}

export function makeSkyTexture() {
  const [c, g] = canvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3f8fe8');
  gr.addColorStop(0.45, '#7cc3f7');
  gr.addColorStop(0.62, '#cdeefe');
  gr.addColorStop(1, '#ffe7c4');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = toTexture(c);
  t.anisotropy = 1;
  return t;
}

export function makeGlowTexture() {
  const [c, g] = canvas(64, 64);
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function makeLabelTexture(text, fg, bg) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = fg; g.font = `900 58px ${DISPLAY_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  return toTexture(c);
}

export function makeBoardTexture(seed = 3) {
  const rand = rng(seed);
  const [c, g] = canvas(256, 64);
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#ff7a1a'); gr.addColorStop(0.5, '#ff3d7f'); gr.addColorStop(1, '#7b4dff');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
  graffiti(g, 128, 34, 34, rand, 'DASH');
  return toTexture(c);
}

export function makeToonGradient() {
  const data = new Uint8Array([90, 170, 235, 255]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
