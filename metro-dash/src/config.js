// Tunables shared across the game. Units: metres and seconds.
export const LANE_W = 2.4;
export const laneX = (i) => (i - 1) * LANE_W;

export const TRAIN = { W: 2.1, H: 2.9, CAR: 12, GAP: 0.6, RAMP: 7.5 };
export const PLAYER = { H: 1.7, ROLL_H: 0.85, HW: 0.3, HD: 0.3 };
export const PHYS = {
  G: 40,
  JUMP: 12, // apex ~1.8 m
  JUMP_SNEAKERS: 16.8, // apex ~3.5 m, clears a train
  ROLL_T: 0.62,
  SLAM: -34,
  LANE_SPEED: 17,
  STEP_UP: 0.55, // how far below a roof you can still "land" on it
};
export const SPEED = { START: 13.5, MAX: 30, TAU: 130 };
export const JET_Y = 8.6;
export const HOVER_TIME = 30;
export const AHEAD = 175; // how far ahead the level is generated
export const BEHIND = 18; // how far behind things are kept

// Power-up durations: base + per upgrade level (0..5)
export const POWERUPS = {
  magnet: { name: '金币磁铁', base: 10, per: 2.5, color: '#ff4d5e' },
  jetpack: { name: '喷气背包', base: 7, per: 1.5, color: '#ffb02e' },
  sneakers: { name: '超级跑鞋', base: 10, per: 2.5, color: '#3ee07a' },
  x2: { name: '双倍积分', base: 10, per: 2.5, color: '#b56bff' },
};
export const UPGRADE_COST = [500, 1000, 2000, 4000, 8000];
export const BOARD_COST = 300;

// Outfits are separate VRM files of the same character (see assets/).
export const OUTFITS = [
  { id: 'hoodie', name: '粉色卫衣', cost: 0 },
  { id: 'denim', name: '牛仔短裤', cost: 2500 },
];
export const REVIVE_COST = 300;
