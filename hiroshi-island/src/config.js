// phones and tablets: lighter defaults, but no blurry sub-pixel rendering on their small screens
const TOUCH = window.matchMedia?.('(pointer: coarse)').matches ?? false;

/** Quality presets. `?quality=low|medium|high` overrides the saved choice. */
export const QUALITY = {
  low: {
    name: 'low',
    pixelRatio: TOUCH ? 1 : 0.75,
    shadowMap: 2048,
    shadowExtent: 40,
    envSize: 64,
    refrScale: 0.5,
    ao: false,
    aoHalfRes: true,
    aoSamples: 8,
    grassNear: 0.35,
    grassFar: 0.3,
    treeDistance: 150,
    smallPlantDistance: 45,
    ssr: false,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1,
    shadowMap: 2048,
    shadowExtent: 45,
    envSize: 128,
    refrScale: 0.5,
    ao: true,
    aoHalfRes: true,
    aoSamples: 12,
    grassNear: 0.7,
    grassFar: 0.6,
    treeDistance: 220,
    smallPlantDistance: 70,
    ssr: true,
  },
  high: {
    name: 'high',
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    shadowMap: 4096,
    shadowExtent: 55,
    envSize: 128,
    refrScale: 1,
    ao: true,
    aoHalfRes: false,
    aoSamples: 16,
    grassNear: 1,
    grassFar: 1,
    treeDistance: 300,
    smallPlantDistance: 90,
    ssr: true,
  },
};

export function pickQuality() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && QUALITY[q]) return QUALITY[q];
  try {
    const saved = localStorage.getItem('hiroshi.quality');
    if (saved && QUALITY[saved]) return QUALITY[saved];
  } catch {
    /* storage may be unavailable */
  }
  return TOUCH ? QUALITY.low : QUALITY.medium;
}
