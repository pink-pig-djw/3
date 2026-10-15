// Zones: each has its own sky, light, fog, scenery and music. They unlock by
// distance and get flashier the further you run.
import * as THREE from 'three';

const raw = [
  {
    id: 'city', name: '晴空街区', en: 'SUNNY BLOCKS', future: false,
    sky: { top: '#2f7fe0', mid: '#79c0f6', horizon: '#d4effc', bottom: '#e6eef2', stars: 0, nebula: 0, aurora: 0, planet: 0, sunDir: [-0.35, 0.55, -1], sunColor: '#fff6d8', sunColor2: '#fff6d8', sunSize: 0.05, stripes: 0, glow: 0.5 },
    fog: { color: '#cfeaf8', near: 80, far: 170 },
    hemi: { sky: '#e4f3ff', ground: '#8d7d68', i: 1.9 }, sun: { color: '#fff1dc', i: 2.3 },
    night: 0, sway: 0.0016, particles: null,
  },
  {
    id: 'sunset', name: '夕阳海港', en: 'SUNSET HARBOR', future: false,
    sky: { top: '#40307a', mid: '#e0567a', horizon: '#ffb35c', bottom: '#ff9466', stars: 0.15, nebula: 0, aurora: 0, planet: 0, sunDir: [0.22, 0.07, -1], sunColor: '#fff0a0', sunColor2: '#ff8a3c', sunSize: 0.12, stripes: 0, glow: 1.5 },
    fog: { color: '#f5a274', near: 70, far: 165 },
    hemi: { sky: '#ffd0aa', ground: '#6b4a5a', i: 1.75 }, sun: { color: '#ffb47a', i: 2.2 },
    night: 0.35, sway: 0.002, particles: 'motes',
  },
  {
    id: 'neon', name: '霓虹夜城', en: 'NEON NIGHTS', future: false,
    sky: { top: '#04051a', mid: '#1a0f46', horizon: '#5c2a7c', bottom: '#2a1240', stars: 0.9, nebula: 0.15, aurora: 0, planet: 0, sunDir: [0.42, 0.42, -1], sunColor: '#eef3ff', sunColor2: '#c9d6ff', sunSize: 0.035, stripes: 0, glow: 0.35 },
    fog: { color: '#3a1d5c', near: 60, far: 160 },
    hemi: { sky: '#a8b4ff', ground: '#4a2a5a', i: 1.55 }, sun: { color: '#c4ccff', i: 1.3 },
    night: 1, sway: 0.0022, particles: 'rain',
  },
  {
    id: 'cyber', name: '赛博网格', en: 'CYBER GRID', future: true,
    sky: { top: '#090020', mid: '#3a0a5e', horizon: '#ff3d9a', bottom: '#14002e', stars: 0.6, nebula: 0.2, aurora: 0, planet: 0, sunDir: [0, 0.13, -1], sunColor: '#ffe14d', sunColor2: '#ff2d95', sunSize: 0.2, stripes: 1, glow: 1.0 },
    fog: { color: '#2c0a4c', near: 60, far: 165 },
    hemi: { sky: '#ffa6e6', ground: '#3a1060', i: 1.55 }, sun: { color: '#ff86d6', i: 1.4 },
    night: 1, sway: 0.0028, particles: 'data',
  },
  {
    id: 'galaxy', name: '星河轨道', en: 'GALAXY RAIL', future: true,
    sky: { top: '#02010a', mid: '#0b0830', horizon: '#20175a', bottom: '#05031a', stars: 1.5, nebula: 1, aurora: 0.9, planet: 1, sunDir: [0.6, 0.25, -1], sunColor: '#d6f0ff', sunColor2: '#9fd6ff', sunSize: 0.03, stripes: 0, glow: 0.5 },
    fog: { color: '#130d3a', near: 70, far: 178 },
    hemi: { sky: '#a8beff', ground: '#3a2a70', i: 1.65 }, sun: { color: '#d8e4ff', i: 1.5 },
    night: 1, sway: 0.0032, particles: 'stardust',
  },
];

const col = (h) => new THREE.Color(h);
export const THEMES = raw.map((t, index) => ({
  ...t,
  index,
  sky: {
    ...t.sky,
    top: col(t.sky.top), mid: col(t.sky.mid), horizon: col(t.sky.horizon), bottom: col(t.sky.bottom),
    sunColor: col(t.sky.sunColor), sunColor2: col(t.sky.sunColor2),
    sunDir: new THREE.Vector3(...t.sky.sunDir).normalize(),
  },
  fog: { ...t.fog, color: col(t.fog.color) },
  hemi: { ...t.hemi, sky: col(t.hemi.sky), ground: col(t.hemi.ground) },
  sun: { ...t.sun, color: col(t.sun.color) },
}));

export const ZONE_STARTS = [0, 550, 1300, 2150, 3100];
const LOOP_FROM = 4100;
const LOOP = [2, 3, 4];

// Zone index for a distance (metres from the start of the run).
export function themeAt(dist) {
  if (dist < LOOP_FROM) {
    let i = 0;
    for (let k = 0; k < ZONE_STARTS.length; k++) if (dist >= ZONE_STARTS[k]) i = k;
    return i;
  }
  return LOOP[Math.floor((dist - LOOP_FROM) / 1000) % LOOP.length];
}

// Zone of the 40 m scenery chunk containing depth z (z < 0 is ahead of the start).
export function zoneOfZ(z) {
  return themeAt(Math.floor(-z / 40) * 40);
}
