// DOM overlay: HUD, menus, shop and dialogs.
import { POWERUPS, UPGRADE_COST, BOARD_COST, OUTFITS } from './config.js';

export const $ = (id) => document.getElementById(id);

const ICONS = {
  magnet: '<svg viewBox="0 0 24 24"><path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0z" fill="#ff4d5e"/><path d="M5 4h4v3H5zM15 4h4v3h-4z" fill="#e9eef6"/></svg>',
  jetpack: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="6" height="12" rx="3" fill="#ffb02e"/><rect x="13" y="4" width="6" height="12" rx="3" fill="#ffb02e"/><path d="M6 17h4l-2 5zM14 17h4l-2 5z" fill="#ff5a1f"/></svg>',
  sneakers: '<svg viewBox="0 0 24 24"><path d="M3 15c0-3 1-6 3-6l3 2 4-1c2 1 3 3 7 3 1 0 1 2 0 2H3z" fill="#3ee07a"/><rect x="3" y="16" width="18" height="3" rx="1.5" fill="#fff"/><path d="M8 19v3M12 19v3M16 19v3" stroke="#fff" stroke-width="1.5"/></svg>',
  x2: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#9b4dff"/><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="900" fill="#fff" font-family="Bungee, Arial Black, sans-serif">×2</text></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="2" y="9" width="20" height="6" rx="3" fill="#ff6fae"/><rect x="6" y="10.5" width="12" height="3" rx="1.5" fill="#ffd23f"/><circle cx="6" cy="17.5" r="1.6" fill="#5ff6ff"/><circle cx="18" cy="17.5" r="1.6" fill="#5ff6ff"/></svg>',
  outfit: '<svg viewBox="0 0 24 24"><path d="M8 3l4 2 4-2 5 4-3 3-1-1v12H7V9l-1 1-3-3z" fill="#ff8fc8"/></svg>',
};

export class UI {
  constructor(game) {
    this.g = game;
    this.lastScore = -1;
    this.lastCoins = -1;
    this.powerEls = {};
    this.toastTimer = 0;
  }

  show(id, on = true) { $(id).hidden = !on; }

  screen(name) {
    for (const id of ['menu', 'hud', 'shop', 'help', 'pause', 'over']) this.show(id, false);
    if (name) for (const id of name.split(' ')) this.show(id, true);
  }

  setLoading(frac, text) {
    $('load-bar').style.transform = `scaleX(${frac})`;
    if (text) $('load-text').textContent = text;
  }

  hideLoading() {
    $('loading').classList.add('done');
    setTimeout(() => { $('loading').hidden = true; }, 500);
  }

  menuStats() {
    const s = this.g.save;
    $('best').textContent = s.best.toLocaleString('en-US');
    $('bank').textContent = s.coins.toLocaleString('en-US');
    $('btn-sound').textContent = s.muted ? '声音：关' : '声音：开';
    $('btn-sound').setAttribute('aria-pressed', String(!s.muted));
  }

  hud(score, coins, mult) {
    if (score !== this.lastScore) { $('score').textContent = score.toLocaleString('en-US'); this.lastScore = score; }
    if (coins !== this.lastCoins) { $('coins').textContent = coins.toLocaleString('en-US'); this.lastCoins = coins; }
    const m = $('mult');
    const txt = `×${mult}`;
    if (m.textContent !== txt) { m.textContent = txt; m.classList.toggle('hot', mult > 1); }
    $('board-count').textContent = this.g.save.boards;
    $('btn-board').classList.toggle('empty', this.g.save.boards <= 0);
    $('btn-board').classList.toggle('on', this.g.player.board > 0);
  }

  powers(active) {
    const box = $('powers');
    for (const [k, frac] of Object.entries(active)) {
      let el = this.powerEls[k];
      if (frac <= 0) {
        if (el) { el.remove(); delete this.powerEls[k]; }
        continue;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'power';
        el.innerHTML = `${ICONS[k]}<span class="pbar"><i></i></span>`;
        box.appendChild(el);
        this.powerEls[k] = el;
      }
      el.querySelector('i').style.transform = `scaleX(${frac})`;
      el.classList.toggle('ending', frac < 0.2);
    }
  }

  clearPowers() {
    for (const el of Object.values(this.powerEls)) el.remove();
    this.powerEls = {};
  }

  toast(text, kind = '') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.className = 'toast'; }, 1400);
  }

  danger(on) { $('danger').classList.toggle('on', on); }

  renderShop() {
    const s = this.g.save;
    $('shop-bank').textContent = s.coins.toLocaleString('en-US');
    const rows = [];
    rows.push(`
      <li class="item">
        <span class="item-ico">${ICONS.board}</span>
        <span class="item-body"><b>悬浮滑板</b><small>双击屏幕启用，${30} 秒内撞车不会出局。已有 ${s.boards} 块</small></span>
        <button class="buy" data-buy="board" ${s.coins < BOARD_COST ? 'disabled' : ''}><i class="coin-ico"></i>${BOARD_COST}</button>
      </li>`);
    for (const [k, p] of Object.entries(POWERUPS)) {
      const lv = s.levels[k];
      const max = lv >= UPGRADE_COST.length;
      const cost = UPGRADE_COST[lv];
      const pips = Array.from({ length: UPGRADE_COST.length }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      const dur = p.base + p.per * lv;
      rows.push(`
        <li class="item">
          <span class="item-ico">${ICONS[k]}</span>
          <span class="item-body"><b>${p.name}</b><small>持续 ${dur.toFixed(1)} 秒</small><span class="pips" aria-label="等级 ${lv}/${UPGRADE_COST.length}">${pips}</span></span>
          ${max ? '<span class="maxed">已满级</span>' : `<button class="buy" data-buy="${k}" ${s.coins < cost ? 'disabled' : ''}><i class="coin-ico"></i>${cost}</button>`}
        </li>`);
    }
    for (const o of OUTFITS) {
      const owned = s.outfits.includes(o.id);
      const worn = s.outfit === o.id;
      let action;
      if (worn) action = '<span class="maxed">穿着中</span>';
      else if (owned) action = `<button class="buy wear" data-wear="${o.id}">换上</button>`;
      else action = `<button class="buy" data-outfit="${o.id}" ${s.coins < o.cost ? 'disabled' : ''}><i class="coin-ico"></i>${o.cost}</button>`;
      rows.push(`
        <li class="item">
          <span class="item-ico">${ICONS.outfit}</span>
          <span class="item-body"><b>七海 · ${o.name}</b><small>${o.id === 'hoodie' ? '初始服装' : '换一身清爽的街头装扮'}</small></span>
          ${action}
        </li>`);
    }
    $('shop-list').innerHTML = rows.join('');
  }
}
