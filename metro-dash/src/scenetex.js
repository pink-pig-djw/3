// Canvas textures for the later zones (harbour, neon city, cyber grid, galaxy).
import * as THREE from 'three';

const DISPLAY = '"Bungee", "Arial Black", Impact, sans-serif';
const DISPLAY_CN = '"ZCOOL QingKe HuangYou", "PingFang SC", "Microsoft YaHei", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------- harbour ----------
export function makeCorrugatedTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = gr; g.fillRect(x, 0, 8, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4);
  return tex(c, true);
}

export function makeSeaTexture() {
  const rand = rng(5);
  const [c, g] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#5a4f9e'); gr.addColorStop(1, '#2e2f74');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const y = rand() * 256, x = rand() * 256, w = 6 + rand() * 30;
    g.fillStyle = rand() < 0.5 ? 'rgba(255,190,120,0.55)' : 'rgba(255,240,200,0.35)';
    g.fillRect(x, y, w, 1.5);
  }
  return tex(c, true);
}

// ---------- neon city ----------
const NEON = ['#ff3dbb', '#2ef2ff', '#ffe14d', '#7dff6b', '#b46bff', '#ff6a3d'];

export function makeNeonWallTextures() {
  // returns { map, glow } – a dark wall whose graffiti glows
  const rand = rng(41);
  const [c, g] = canvas(1024, 1024);
  const [gc, gg] = canvas(1024, 1024);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, 1024, 1024);
  const words = [['NEON', '七海'], ['DASH', 'ZZZ'], ['夜跑', 'GO!'], ['LOVE', 'METRO']];
  for (let p = 0; p < 4; p++) {
    const y0 = p * 256;
    g.fillStyle = '#26203a'; g.fillRect(0, y0, 1024, 256);
    for (let r = 0; r < 8; r++) {
      for (let k = 0; k < 16; k++) {
        g.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.04})`;
        g.fillRect(k * 64 + (r % 2) * 32, y0 + r * 32, 62, 30);
      }
    }
    for (const [i, w] of words[p].entries()) {
      const x = 260 + i * 500, y = y0 + 128;
      const color = NEON[Math.floor(rand() * NEON.length)];
      for (const [ctx, glow] of [[g, false], [gg, true]]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rand() - 0.5) * 0.2);
        ctx.font = `900 ${i ? 84 : 96}px ${/[一-鿿]/.test(w) ? DISPLAY_CN : DISPLAY}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 7; ctx.strokeStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = glow ? 26 : 12;
        ctx.strokeText(w, 0, 0);
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
        ctx.strokeText(w, 0, 0);
        ctx.restore();
      }
    }
    // capping strip
    g.fillStyle = '#121019'; g.fillRect(0, y0, 1024, 12);
  }
  return { map: tex(c), glow: tex(gc) };
}

export function makeNightWindowTextures() {
  const rand = rng(77);
  const [c, g] = canvas(256, 256);
  const [gc, gg] = canvas(256, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, 256, 256);
  const lit = ['#ffd98a', '#fff1c9', '#9be7ff', '#ff9ad6', '#c6ff9a'];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const on = rand() < 0.55;
      g.fillStyle = '#1b2033';
      g.fillRect(x * 64 + 12, y * 64 + 14, 40, 38);
      if (on) {
        gg.fillStyle = lit[Math.floor(rand() * lit.length)];
        gg.globalAlpha = 0.6 + rand() * 0.4;
        gg.fillRect(x * 64 + 12, y * 64 + 14, 40, 38);
        gg.globalAlpha = 1;
      }
    }
  }
  return { map: tex(c, true), glow: tex(gc, true) };
}

// Atlas of 8 neon signs (each 256 x 128), transparent background.
export const SIGN_COUNT = 8;
export function makeSignAtlas() {
  const [c, g] = canvas(512, 512);
  const signs = [
    ['拉面', '#ff3dbb', 'cn'], ['KARAOKE', '#2ef2ff', 'en'], ['24H', '#ffe14d', 'en'], ['电玩城', '#7dff6b', 'cn'],
    ['HOTEL', '#b46bff', 'en'], ['咖啡', '#ff6a3d', 'cn'], ['♥ 七海', '#ff3dbb', 'cn'], ['BAR', '#2ef2ff', 'en'],
  ];
  signs.forEach(([text, color, kind], i) => {
    const x = (i % 2) * 256, y = Math.floor(i / 2) * 128;
    g.save();
    g.beginPath(); g.rect(x, y, 256, 128); g.clip();
    g.fillStyle = 'rgba(12,8,24,0.92)';
    g.fillRect(x + 8, y + 10, 240, 108);
    g.lineWidth = 5; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 16;
    g.strokeRect(x + 14, y + 16, 228, 96);
    g.font = `900 ${kind === 'cn' ? 66 : 52}px ${kind === 'cn' ? DISPLAY_CN : DISPLAY}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.shadowBlur = 22;
    g.fillText(text, x + 128, y + 66);
    g.shadowBlur = 0; g.fillStyle = color; g.globalAlpha = 0.5;
    g.fillText(text, x + 128, y + 66);
    g.restore();
  });
  return tex(c);
}

// ---------- cyber ----------
export function makeGridTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#0a0418'; g.fillRect(0, 0, 256, 256);
  const line = (x, y, w, h, color, blur) => { g.shadowColor = color; g.shadowBlur = blur; g.fillStyle = color; g.fillRect(x, y, w, h); };
  for (let i = 0; i <= 4; i++) {
    const strong = i % 4 === 0;
    const color = strong ? '#ff3dbb' : '#36e6ff';
    line(i * 64 - 1.5, 0, 3, 256, color, 10);
    line(0, i * 64 - 1.5, 256, 3, color, 10);
  }
  return tex(c, true);
}

export function makeEdgeTexture(color) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#0c0820'; g.fillRect(0, 0, 128, 128);
  g.shadowColor = color; g.shadowBlur = 12;
  g.strokeStyle = color; g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  g.lineWidth = 2; g.globalAlpha = 0.35;
  g.beginPath(); g.moveTo(5, 64); g.lineTo(123, 64); g.stroke();
  return tex(c);
}

export function makeDeckTextures() {
  // dark tiles with glowing seams, one lane wide; {map, glow}
  const [c, g] = canvas(256, 256);
  const [gc, gg] = canvas(256, 256);
  g.fillStyle = '#1a1830'; g.fillRect(0, 0, 256, 256);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 4; k++) {
    const y = k * 64;
    g.fillStyle = '#24223f'; g.fillRect(16, y + 6, 224, 52);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(16, y + 6, 224, 6);
    gg.fillStyle = '#36e6ff'; gg.fillRect(16, y + 60, 224, 3);
  }
  gg.fillStyle = '#ff3dbb';
  gg.fillRect(2, 0, 4, 256); gg.fillRect(250, 0, 4, 256);
  return { map: tex(c, true), glow: tex(gc, true) };
}

export function makeChevronTexture(color) {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#120c26'; g.fillRect(0, 0, 128, 256);
  g.shadowColor = color; g.shadowBlur = 10; g.fillStyle = color;
  for (let y = 0; y < 256; y += 64) {
    g.beginPath();
    g.moveTo(20, y + 50); g.lineTo(64, y + 14); g.lineTo(108, y + 50); g.lineTo(108, y + 64); g.lineTo(64, y + 28); g.lineTo(20, y + 64);
    g.closePath(); g.fill();
  }
  g.fillRect(0, 0, 6, 256); g.fillRect(122, 0, 6, 256);
  return tex(c, true);
}

export function makeFutureStripeTexture(a, b) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#0c0820'; g.fillRect(0, 0, 256, 64);
  for (let i = -1; i < 9; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.beginPath(); g.moveTo(i * 32, 64); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 26, 0); g.lineTo(i * 32 + 10, 64); g.fill();
  }
  g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 60);
  return tex(c);
}

// ---------- galaxy ----------
export function makeWarpTexture() {
  const rand = rng(9);
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#000000'; g.fillRect(0, 0, 256, 512);
  const cols = ['#5ff6ff', '#b46bff', '#ff3dbb', '#ffffff', '#7dff6b'];
  for (let i = 0; i < 140; i++) {
    const x = rand() * 256, y = rand() * 512, len = 20 + rand() * 120;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    const col = cols[Math.floor(rand() * cols.length)];
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, col);
    g.fillStyle = gr; g.fillRect(x, y, 1.5 + rand() * 2, len);
  }
  return tex(c, true);
}

// ---------- futuristic trains ----------
// Same atlas layout as the classic trains (see TRAIN_ATLAS in textures.js).
export const FUTURE_VARIANTS = [
  { body: '#f2f5fb', body2: '#c9d2e4', glow: '#2ef2ff', glass: '#141b33' },
  { body: '#1b1830', body2: '#0d0c1a', glow: '#ff3dbb', glass: '#06060f' },
  { body: '#e9e4ff', body2: '#b6a8f0', glow: '#7dff6b', glass: '#16123a' },
];

export function makeFutureTrainTextures(v, seed) {
  const [c, g] = canvas(1024, 512);
  const [gc, gg] = canvas(1024, 512);
  gg.fillStyle = '#000'; gg.fillRect(0, 0, 1024, 512);
  // side
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, v.body); gr.addColorStop(1, v.body2);
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = v.glass; g.fillRect(0, 54, 1024, 70);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let x = 0; x < 1024; x += 160) { g.beginPath(); g.moveTo(x, 124); g.lineTo(x + 50, 54); g.lineTo(x + 80, 54); g.lineTo(x + 30, 124); g.fill(); }
  for (const x of [220, 780]) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(x - 60, 40, 120, 200); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 226, 1024, 30);
  g.fillStyle = v.glow; g.fillRect(0, 150, 1024, 10);
  gg.fillStyle = v.glow; gg.fillRect(0, 148, 1024, 14);
  gg.fillStyle = 'rgba(180,220,255,0.18)'; gg.fillRect(0, 54, 1024, 70);
  g.font = `bold 26px ${DISPLAY}`; g.fillStyle = v.glow;
  g.fillText(`MD-X${seed % 10}`, 40, 205);
  // front
  const fx = 0, fy = 256;
  g.fillStyle = v.body; g.fillRect(fx, fy, 256, 256);
  g.fillStyle = v.glass;
  g.beginPath(); g.moveTo(fx + 10, fy + 40); g.lineTo(fx + 246, fy + 40); g.lineTo(fx + 220, fy + 150); g.lineTo(fx + 36, fy + 150); g.closePath(); g.fill();
  for (const [ctx, col] of [[g, v.glow], [gg, v.glow]]) {
    ctx.strokeStyle = col; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(fx + 30, fy + 190); ctx.lineTo(fx + 128, fy + 220); ctx.lineTo(fx + 226, fy + 190); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(fx + 30, fy + 170, 40, 10); ctx.fillRect(fx + 186, fy + 170, 40, 10);
  }
  // roof
  g.fillStyle = v.body2; g.fillRect(256, 256, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 256; y < 512; y += 32) g.fillRect(256, y, 256, 3);
  g.fillStyle = v.glow; g.fillRect(256 + 124, 256, 8, 256);
  gg.fillStyle = v.glow; gg.fillRect(256 + 122, 256, 12, 256);
  // dark + light swatches (same spots as the classic atlas)
  g.fillStyle = '#1a1a26'; g.fillRect(520, 264, 112, 112);
  g.fillStyle = '#fff9d6'; g.fillRect(656, 264, 96, 96);
  return { map: tex(c), glow: tex(gc) };
}

export function makeGateSign(stage, name, en, color) {
  const [c, g] = canvas(1024, 192);
  g.fillStyle = '#120c26'; g.fillRect(0, 0, 1024, 192);
  g.shadowColor = color; g.shadowBlur = 24;
  g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(10, 10, 1004, 172);
  g.textBaseline = 'middle';
  g.font = `900 46px ${DISPLAY}`; g.fillStyle = color; g.textAlign = 'left';
  g.fillText(`STAGE ${stage}`, 44, 96);
  g.font = `900 96px ${DISPLAY_CN}`; g.fillStyle = '#ffffff'; g.textAlign = 'center';
  g.fillText(name, 560, 92);
  g.font = `900 34px ${DISPLAY}`; g.fillStyle = color; g.textAlign = 'right';
  g.fillText(en, 990, 150);
  return tex(c);
}
