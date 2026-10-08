import { CHAPTER, CONTROLS, ENDING, ENDING_AFTER, INTRO, SUBJECTS, SUBTITLE, TITLE } from '../game/story.js';
import { TIMES, TIME_LABELS } from '../world/timeofday.js';

const $ = (sel, root = document) => root.querySelector(sel);

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const STAR = '★';

/** All of the HTML overlay. Pure DOM, no framework. */
export class UI {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = '';
    this.handlers = {};
    this.build();
  }

  on(name, fn) {
    (this.handlers[name] ??= []).push(fn);
  }

  emit(name, ...args) {
    (this.handlers[name] ?? []).forEach((fn) => fn(...args));
  }

  build() {
    const r = this.root;
    r.append(
      el(`<div class="loading" id="loading">
        <div class="loading-title">${TITLE}</div>
        <div class="bar"><i></i></div>
        <div class="loading-note">正在把小岛搬进浏览器……</div>
      </div>`),
    );
    r.append(
      el(`<div class="title hidden" id="title">
        <div class="title-inner">
          <div class="title-kicker">Hiroshi's Island</div>
          <h1>${TITLE}</h1>
          <p class="subtitle">${SUBTITLE}</p>
          <div class="title-buttons">
            <button class="btn primary" data-act="start">开始</button>
            <button class="btn" data-act="continue" hidden>继续</button>
          </div>
          <div class="settings">
            <label>画质
              <select data-set="quality">
                <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
            </label>
            <label>鼠标灵敏度 <input type="range" min="0.4" max="2" step="0.05" data-set="sens"></label>
            <label>音量 <input type="range" min="0" max="1" step="0.05" data-set="volume"></label>
          </div>
          <div class="controls">${CONTROLS.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>
          <div class="credit">Blender 程序化建模 · Three.js 实时渲染</div>
        </div>
      </div>`),
    );
    r.append(el(`<div class="intro hidden" id="intro"><p></p><div class="intro-skip">点击继续</div></div>`));
    r.append(
      el(`<div class="hud hidden" id="hud">
        <div class="hud-left"><div class="hud-chapter">${CHAPTER}</div><div class="hud-place">${TITLE}</div></div>
        <div class="hud-right">
          <div class="pills">${TIMES.map((t) => `<button class="pill" data-time="${t}"><i class="dot ${t}"></i>${TIME_LABELS[t]}</button>`).join('')}</div>
          <button class="album-btn" data-act="album">相册 <b id="album-count">0</b>/${SUBJECTS.length}</button>
        </div>
        <div class="hint" id="hint"></div>
        <div class="toast" id="toast"></div>
        <div class="keys" id="keys">右键 举起相机 · 左键 快门 · Tab 相册 · E 互动</div>
      </div>`),
    );
    r.append(
      el(`<div class="viewfinder hidden" id="vf">
        <div class="vf-frame"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
          <div class="thirds"><i></i><i></i><i></i><i></i></div>
          <div class="af" id="af"></div>
        </div>
        <div class="vf-info">
          <span id="vf-focal">35mm</span><span id="vf-f">f/2.8</span><span id="vf-focus">∞</span><span id="vf-dof"></span><span id="vf-mode">AF</span>
        </div>
      </div>`),
    );
    r.append(el(`<div class="flash" id="flash"></div>`));
    r.append(
      el(`<div class="shot-card hidden" id="shot">
        <img alt="" />
        <div class="shot-text"><div class="shot-title"></div><div class="shot-stars"></div><div class="shot-msg"></div></div>
      </div>`),
    );
    r.append(el(`<div class="memory hidden" id="memory"><div class="memory-title"></div><p></p><div class="memory-skip">点击继续</div></div>`));
    r.append(
      el(`<div class="album hidden" id="album">
        <div class="book">
          <div class="page left"><h2>浩的相册</h2><div class="index" id="album-index"></div><div class="extras-title">其他照片</div><div class="extras" id="album-extras"></div></div>
          <div class="page right" id="album-detail"></div>
        </div>
        <div class="album-close">Tab / Esc 合上相册</div>
      </div>`),
    );
    r.append(
      el(`<div class="pause hidden" id="pause">
        <div class="pause-inner"><h2>暂停</h2>
          <button class="btn primary" data-act="resume">回到岛上</button>
          <button class="btn" data-act="album">打开相册</button>
          <div class="controls">${CONTROLS.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('')}</div>
        </div>
      </div>`),
    );
    r.append(el(`<div class="timecard hidden" id="timecard"></div>`));
    r.append(el(`<div class="ending hidden" id="ending"><div class="ending-lines"></div><div class="ending-after"></div></div>`));
    r.append(el(`<div class="fade" id="fade"></div>`));

    r.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this.emit(act);
      const time = e.target.closest('[data-time]')?.dataset.time;
      if (time) this.emit('pickTime', time);
      const entry = e.target.closest('[data-entry]')?.dataset.entry;
      if (entry) this.showEntry(entry);
    });
    r.addEventListener('input', (e) => {
      const k = e.target.dataset.set;
      if (k) this.emit('setting', k, e.target.value);
    });
  }

  show(id, on = true) {
    $(`#${id}`, this.root).classList.toggle('hidden', !on);
  }

  isOpen(id) {
    return !$(`#${id}`, this.root).classList.contains('hidden');
  }

  progress(done, total) {
    const p = total ? done / total : 0;
    $('#loading .bar i', this.root).style.width = `${Math.round(p * 100)}%`;
  }

  loaded() {
    this.show('loading', false);
    this.show('title', true);
  }

  setSettings({ quality, sens, volume }, hasSave) {
    $('[data-set="quality"]', this.root).value = quality;
    $('[data-set="sens"]', this.root).value = sens;
    $('[data-set="volume"]', this.root).value = volume;
    $('[data-act="continue"]', this.root).hidden = !hasSave;
    $('[data-act="start"]', this.root).textContent = hasSave ? '重新开始' : '开始';
  }

  async intro() {
    this.show('title', false);
    const box = $('#intro', this.root);
    const p = $('p', box);
    this.show('intro', true);
    for (const line of INTRO) {
      p.classList.remove('in');
      p.textContent = line;
      void p.offsetWidth;
      p.classList.add('in');
      await this.waitClickOrTime(box, 7000);
    }
    this.show('intro', false);
  }

  waitClickOrTime(node, ms) {
    return new Promise((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        node.removeEventListener('click', fin);
        window.removeEventListener('keydown', key);
        res();
      };
      const key = (e) => (e.code === 'Space' || e.code === 'Enter') && fin();
      node.addEventListener('click', fin);
      window.addEventListener('keydown', key);
      setTimeout(fin, ms);
    });
  }

  hud(on) {
    this.show('hud', on);
  }

  setTime(name, unlocked) {
    this.root.querySelectorAll('.pill').forEach((b) => {
      const t = b.dataset.time;
      b.classList.toggle('active', t === name);
      b.classList.toggle('locked', !unlocked.includes(t));
    });
  }

  setCount(n) {
    $('#album-count', this.root).textContent = n;
  }

  hint(text) {
    const h = $('#hint', this.root);
    if (h.textContent !== (text || '')) h.textContent = text || '';
    h.classList.toggle('on', !!text);
  }

  toast(text, ms = 3500) {
    const t = $('#toast', this.root);
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this._toast);
    this._toast = setTimeout(() => t.classList.remove('on'), ms);
  }

  fadeKeys() {
    $('#keys', this.root).classList.add('faded');
  }

  viewfinder(on, info) {
    this.show('vf', on);
    if (!on || !info) return;
    $('#vf-focal', this.root).textContent = `${info.focal}mm`;
    $('#vf-f', this.root).textContent = `f/${info.fstop}`;
    $('#vf-focus', this.root).textContent = info.focus > 300 ? '∞' : `${info.focus < 10 ? info.focus.toFixed(1) : Math.round(info.focus)} m`;
    const far = Number.isFinite(info.far) ? (info.far > 99 ? Math.round(info.far) : info.far.toFixed(1)) : '∞';
    $('#vf-dof', this.root).textContent = `景深 ${info.near.toFixed(1)}–${far} m`;
    $('#vf-mode', this.root).textContent = info.manual ? 'MF' : 'AF';
    $('#af', this.root).classList.toggle('locked', info.locked);
  }

  flash() {
    const f = $('#flash', this.root);
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  shotCard({ img, title, stars, msg }) {
    const c = $('#shot', this.root);
    $('img', c).src = img;
    $('.shot-title', c).textContent = title || '';
    $('.shot-stars', c).textContent = stars ? STAR.repeat(stars) + '☆'.repeat(3 - stars) : '';
    $('.shot-msg', c).textContent = msg || '';
    c.classList.remove('hidden');
    c.classList.remove('in');
    void c.offsetWidth;
    c.classList.add('in');
    clearTimeout(this._shot);
    this._shot = setTimeout(() => c.classList.remove('in'), 5200);
  }

  async memory(subject) {
    const m = $('#memory', this.root);
    $('.memory-title', m).textContent = `「${subject.title}」`;
    $('p', m).textContent = subject.memory;
    this.show('memory', true);
    m.classList.remove('in');
    void m.offsetWidth;
    m.classList.add('in');
    await this.waitClickOrTime(m, 16000);
    this.show('memory', false);
  }

  timecard(text) {
    const t = $('#timecard', this.root);
    t.textContent = text;
    this.show('timecard', true);
    t.classList.remove('in');
    void t.offsetWidth;
    t.classList.add('in');
    clearTimeout(this._tc);
    this._tc = setTimeout(() => this.show('timecard', false), 4200);
  }

  fade(on) {
    $('#fade', this.root).classList.toggle('on', on);
  }

  // ------------------------------------------------------------ album
  openAlbum(state) {
    this.albumState = state;
    const idx = $('#album-index', this.root);
    idx.innerHTML = '';
    for (const t of TIMES) {
      const group = el(`<div class="idx-group"><div class="idx-time"><i class="dot ${t}"></i>${TIME_LABELS[t]}</div></div>`);
      for (const s of SUBJECTS.filter((x) => x.time === t)) {
        const got = state.photos[s.id];
        group.append(
          el(`<button class="idx-entry ${got ? 'done' : ''}" data-entry="${s.id}">
            <span class="thumb">${got ? `<img src="${got.img}" alt="">` : ''}</span>
            <span class="idx-title">${s.title}</span>
            <span class="idx-stars">${got ? STAR.repeat(got.stars) : ''}</span>
          </button>`),
        );
      }
      idx.append(group);
    }
    const ex = $('#album-extras', this.root);
    ex.innerHTML = state.extras.length
      ? state.extras.map((p, i) => `<button class="extra" data-entry="extra:${i}"><img src="${p.img}" alt=""></button>`).join('')
      : '<span class="muted">还没有。</span>';
    this.showEntry(this.lastEntry || SUBJECTS[0].id);
    this.show('album', true);
  }

  showEntry(id) {
    const state = this.albumState;
    if (!state) return;
    this.lastEntry = id;
    const d = $('#album-detail', this.root);
    if (id.startsWith('extra:')) {
      const p = state.extras[Number(id.slice(6))];
      d.innerHTML = `<div class="photo"><img src="${p.img}" alt=""></div><div class="note">${p.note || ''}</div>`;
      return;
    }
    const s = SUBJECTS.find((x) => x.id === id);
    const got = state.photos[id];
    d.innerHTML = `
      <div class="photo ${got ? '' : 'empty'}">${got ? `<img src="${got.img}" alt="">` : '<span>照片泡过水，已经看不清了</span>'}</div>
      <div class="caption">${s.caption}</div>
      <div class="sign">— 浩 · ${TIME_LABELS[s.time]}</div>
      ${got ? `<div class="memory-text">${s.memory}</div>` : ''}`;
  }

  closeAlbum() {
    this.show('album', false);
  }

  async ending() {
    const e = $('#ending', this.root);
    const lines = $('.ending-lines', e);
    lines.innerHTML = '';
    $('.ending-after', e).textContent = '';
    this.show('ending', true);
    for (const l of ENDING) {
      const p = el(`<p>${l}</p>`);
      lines.append(p);
      void p.offsetWidth;
      p.classList.add('in');
      await new Promise((r) => setTimeout(r, 3600));
    }
    $('.ending-after', e).textContent = ENDING_AFTER;
    await this.waitClickOrTime(e, 20000);
    this.show('ending', false);
  }
}
