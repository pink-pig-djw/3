// Per-device save data. Storage can be unavailable (private mode, previews),
// so every access is guarded and the game works with defaults.
const KEY = 'metro-dash-save-v1';
const DEFAULTS = {
  best: 0,
  coins: 0,
  boards: 3,
  levels: { magnet: 0, jetpack: 0, sneakers: 0, x2: 0 },
  outfits: ['hoodie'],
  outfit: 'hoodie',
  muted: false,
  runs: 0,
};

export function loadSave() {
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) { data = {}; }
  return { ...DEFAULTS, ...data, levels: { ...DEFAULTS.levels, ...(data.levels || {}) } };
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
}
