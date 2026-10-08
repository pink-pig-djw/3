import { MathUtils, Vector3 } from 'three';
import { DSLR } from './dslr.js';
import { Player } from './player.js';
import { Subjects } from './subjects.js';
import { FEEDBACK, HINTS, SUBJECTS } from './story.js';
import { TIMES, TIME_LABELS } from '../world/timeofday.js';
import { G } from '../world/shaderlib.js';

const SAVE_KEY = 'hiroshi.save.v1';

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return s && s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

/**
 * Game flow: title -> intro -> wandering with the camera. Photographs are
 * judged against Hiroshi's notes; time moves on when you sit on the bench.
 */
export class Game {
  constructor({ renderer, camera, world, pipeline, input, ui, audio, life, settings }) {
    Object.assign(this, { renderer, camera, world, pipeline, input, ui, audio, life, settings });
    this.player = new Player(world);
    this.dslr = new DSLR(world, camera, pipeline.dof);
    this.dslr.focusables = [...life.focusables, ...world.arch.objects.filter((o) => !o.isLight)];
    this.subjects = new Subjects(world, life, this.dslr);
    this.subjects.occluders = [...world.arch.objects.filter((o) => !o.isLight)];
    this.state = 'title';
    this.raisedToggle = false;
    this.pendingShot = false;
    this.save = loadSave() ?? this.freshSave();
    this.lastToast = 0;
    this.rest = null;
    this.saveTimer = 0;
    this.frame = { sx: 0.8, sy: 0.8 };

    this.player.onStep = (surface, run) => this.audio.step(surface, run);
    this.player.sensitivity = 0.0022 * settings.sens;

    input.on('unlock', () => {
      if (this.state === 'play') this.pause();
    });
    input.on('mode', (touch) => ui.setTouch(touch));
    input.onStick = (st) => ui.stick(st);
    ui.setTouch(input.touch);
    ui.on('pause', () => this.state === 'play' && this.pause());
    ui.on('closeAlbum', () => this.state === 'album' && (ui.closeAlbum(), this.resume()));
    ui.on('touch', (k) => this.touchButton(k));
    ui.on('start', () => this.newGame());
    ui.on('continue', () => this.continueGame());
    ui.on('resume', () => this.resume());
    ui.on('album', () => this.openAlbum());
    ui.on('pickTime', (t) => this.pickTime(t));
    ui.setSettings(settings, !!loadSave());
    ui.setCount(this.photoCount());
    this.layoutFrame();
    window.addEventListener('resize', () => this.layoutFrame());
  }

  freshSave() {
    return { v: 1, time: 'afternoon', unlocked: ['afternoon'], photos: {}, extras: [], pos: null, finished: false };
  }

  persist() {
    try {
      this.save.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw, this.player.pitch];
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      // storage full or unavailable: drop the oldest extra photos and retry once
      if (this.save.extras.length) {
        this.save.extras.shift();
        try {
          localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
        } catch {
          /* give up silently */
        }
      }
    }
  }

  photoCount() {
    return SUBJECTS.filter((s) => this.save.photos[s.id]?.stars >= 2).length;
  }

  /** The 3:2 viewfinder rectangle, centred; photos are cropped to it. */
  layoutFrame() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let fh = H * 0.8;
    let fw = fh * 1.5;
    if (fw > W * 0.9) {
      fw = W * 0.9;
      fh = fw / 1.5;
    }
    // the frame sits 2% of the height above centre: NDC offset +0.04
    this.frame = { sx: fw / W, sy: fh / H, oy: 0.04, w: fw, h: fh };
    const f = document.querySelector('.vf-frame');
    if (f) Object.assign(f.style, { left: `${(W - fw) / 2}px`, top: `${(H - fh) / 2 - H * 0.02}px`, width: `${fw}px`, height: `${fh}px`, right: 'auto', bottom: 'auto' });
  }

  // ---------------------------------------------------------------- flow
  async newGame() {
    this.save = this.freshSave();
    this.persist();
    this.ui.setCount(0);
    this.audio.start();
    await this.ui.intro();
    this.enterWorld(this.world.startPose());
    this.world.time.set('afternoon', 0);
  }

  continueGame() {
    this.save = loadSave() ?? this.freshSave();
    this.audio.start();
    this.ui.show('title', false);
    const p = this.save.pos;
    const pose = p ? { position: new Vector3(p[0], p[1], p[2]), yaw: p[3], pitch: p[4] } : this.world.startPose();
    this.world.time.set(this.save.time, 0);
    this.enterWorld(pose);
  }

  enterWorld(pose) {
    this.player.place(pose);
    this.state = 'play';
    this.ui.hud(true);
    this.ui.setTime(this.save.time, this.save.unlocked);
    this.ui.setCount(this.photoCount());
    this.input.lock();
    setTimeout(() => this.ui.fadeKeys(), 22000);
    this.ui.toast(this.input.touch ? '点右下角的相机键举起相机。相册里写着要拍的东西。' : '右键举起相机。相册里写着要拍的东西。', 6000);
  }

  /** Back to where a live update of the page interrupted the walk, paused. */
  restore(snap) {
    const [x, y, z, yaw, pitch] = snap.pose;
    this.ui.show('title', false);
    this.world.time.set(snap.time ?? this.save.time, 0);
    this.player.place({ position: new Vector3(x, y, z), yaw, pitch });
    this.ui.hud(true);
    this.ui.setTime(this.world.time.current, this.save.unlocked);
    this.ui.setCount(this.photoCount());
    this.pause();
  }

  pause() {
    this.input.unlock();
    this.state = 'paused';
    this.ui.show('pause', true);
    this.ui.viewfinder(false);
  }

  resume() {
    this.audio.start();
    this.ui.show('pause', false);
    this.ui.closeAlbum();
    this.state = 'play';
    this.input.lock();
  }

  openAlbum() {
    if (this.state === 'title') return;
    this.ui.show('pause', false);
    this.state = 'album';
    this.input.unlock();
    this.ui.openAlbum(this.save);
  }

  pickTime(t) {
    if (!this.save.unlocked.includes(t) || this.world.time.transitioning) return;
    this.world.time.set(t, 4);
    this.save.time = t;
    this.ui.setTime(t, this.save.unlocked);
    this.persist();
  }

  // ------------------------------------------------------------- resting
  nearBench() {
    const b = this.world.arch.benchSeat;
    return Math.hypot(this.player.pos.x - b.x, this.player.pos.z - b.z) < 2.2;
  }

  startRest() {
    const cur = this.world.time.current;
    const next = TIMES[(TIMES.indexOf(cur) + 1) % TIMES.length];
    const D = this.world.layout.deck;
    const da = (D.yaw_deg * Math.PI) / 180;
    const seat = this.world.arch.benchSeat.clone();
    // the bench faces the stream (+local z of the deck)
    const look = Math.atan2(-Math.sin(da), -Math.cos(da));
    this.rest = { t: 0, next, seat, yaw: look, from: { pos: this.player.pos.clone(), yaw: this.player.yaw, pitch: this.player.pitch } };
    this.state = 'resting';
    this.ui.hint('');
    this.ui.viewfinder(false);
    this.raisedToggle = false;
    this.dslr.setRaised(false);
    if (next === 'afternoon') {
      // a new day: fade through black
      this.ui.fade(true);
      setTimeout(() => {
        this.world.time.set('afternoon', 0);
        this.ui.timecard('第二天 · 午后');
        this.ui.fade(false);
      }, 1500);
    } else {
      this.world.time.set(next, 9);
      setTimeout(() => this.ui.timecard(TIME_LABELS[next]), 2500);
    }
    if (!this.save.unlocked.includes(next)) this.save.unlocked.push(next);
    this.save.time = next;
    this.ui.setTime(next, this.save.unlocked);
    this.persist();
  }

  updateRest(dt) {
    const r = this.rest;
    r.t += dt;
    const k = MathUtils.smoothstep(r.t, 0, 1.6);
    const p = this.player;
    p.pos.lerpVectors(r.from.pos, r.seat.clone().add(new Vector3(0, -1.62 + 0.8, 0)), k);
    p.yaw = MathUtils.lerp(r.from.yaw, r.yaw, k);
    p.pitch = MathUtils.lerp(r.from.pitch, -0.05, k);
    if (r.t > 11.5 && !this.world.time.transitioning) {
      this.state = 'play';
      this.rest = null;
      this.ui.toast(`${TIME_LABELS[this.world.time.current]}。翻开相册看看这个时候该拍什么。`, 4500);
    }
  }

  // -------------------------------------------------------------- photos
  capture() {
    // called right after rendering, while the drawing buffer is valid
    const src = this.renderer.domElement;
    const W = src.width;
    const H = src.height;
    const fw = W * this.frame.sx;
    const fh = H * this.frame.sy;
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 480;
    const g = c.getContext('2d');
    g.drawImage(src, (W - fw) / 2, (H - fh) / 2 - H * 0.02, fw, fh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }

  async afterShot(img) {
    const timeName = this.world.time.current;
    const res = this.subjects.judge(this.camera, timeName, this.player, this.frame);
    const ui = this.ui;
    if (!res || res.stars <= 0) {
      ui.shotCard({ img, title: res ? SUBJECTS.find((s) => s.id === res.id).title : '', stars: 0, msg: res?.msg || FEEDBACK.none });
      this.save.extras.push({ img, note: res?.msg || '' });
      if (this.save.extras.length > 8) this.save.extras.shift();
      this.persist();
      return;
    }
    const subject = SUBJECTS.find((s) => s.id === res.id);
    const prev = this.save.photos[res.id];
    let msg = res.msg;
    const first = res.stars >= 2 && !(prev?.stars >= 2);
    if (!prev || res.stars > prev.stars || (res.stars === prev.stars && res.stars >= 2)) {
      if (prev && res.stars > prev.stars) msg = `${res.msg} ${FEEDBACK.better}`;
      this.save.photos[res.id] = { img, stars: res.stars };
    } else {
      this.save.extras.push({ img, note: res.msg });
      if (this.save.extras.length > 8) this.save.extras.shift();
    }
    ui.shotCard({ img, title: subject.title, stars: res.stars, msg });
    this.ui.setCount(this.photoCount());
    this.persist();
    if (first) {
      this.state = 'memory';
      await new Promise((r) => setTimeout(r, 1400));
      this.input.unlock();
      this.ui.viewfinder(false);
      await this.ui.memory(subject);
      if (this.photoCount() === SUBJECTS.length && !this.save.finished) {
        await this.ui.ending();
        this.save.finished = true;
        this.save.unlocked = [...TIMES];
        this.ui.setTime(this.world.time.current, this.save.unlocked);
        this.persist();
      }
      this.state = 'play';
      this.input.lock();
    }
  }

  // --------------------------------------------------------------- frame
  update(dt) {
    const { input, ui, dslr, player } = this;
    if (this.state === 'album') {
      if (input.hit('Tab') || input.hit('Escape')) {
        ui.closeAlbum();
        this.resume();
      }
      input.endFrame();
      return;
    }
    if (this.state === 'resting') {
      this.updateRest(dt);
      player.apply(this.camera, { steady: true });
      dslr.update(dt);
      input.endFrame();
      return;
    }
    if (this.state !== 'play') {
      if (this.state === 'paused' && input.hit('Tab')) this.openAlbum();
      dslr.update(dt);
      input.endFrame();
      return;
    }

    if (input.hit('Escape')) {
      // with pointer lock the browser usually swallows Esc and 'unlock' pauses instead
      this.pause();
      input.endFrame();
      return;
    }
    if (input.hit('Tab')) {
      this.openAlbum();
      input.endFrame();
      return;
    }
    // camera raise: hold right mouse, or toggle with F
    if (input.hit('KeyF')) this.raisedToggle = !this.raisedToggle;
    const raised = this.raisedToggle || input.buttons.has(2);
    dslr.setRaised(raised);
    if (raised) {
      if (input.wheel) {
        if (input.down('ShiftLeft') || input.down('ShiftRight')) dslr.manualFocus(input.wheel);
        else dslr.zoom(-input.wheel);
      }
      if (input.hit('KeyQ') || input.hit('BracketLeft')) dslr.aperture(-1);
      if (input.hit('KeyE') || input.hit('BracketRight')) dslr.aperture(1);
      if (input.hit('KeyR')) {
        dslr.toggleAF();
        ui.toast(dslr.manual ? '手动对焦：Shift + 滚轮' : '自动对焦', 1800);
      }
      if (input.clicked.has(0) && dslr.raiseT > 0.6) {
        this.pendingShot = true;
        this.audio.shutter();
        ui.flash();
      }
    }
    player.update(dt, input, { slow: raised ? 0.45 : 1 });
    player.apply(this.camera, { steady: raised });
    dslr.update(dt);
    ui.viewfinder(dslr.raiseT > 0.5, dslr.info());
    ui.touchState(raised);

    // interactions + hints
    if (!raised && this.nearBench()) {
      ui.hint(input.touch ? HINTS.restTouch : HINTS.rest);
      if (input.hit('KeyE')) this.startRest();
    } else ui.hint('');
    if (player.blockedMsg && performance.now() - this.lastToast > 4000) {
      ui.toast(player.blockedMsg, 2500);
      this.lastToast = performance.now();
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 10;
      this.persist();
    }
    input.endFrame();
  }

  /** On-screen buttons (touch screens) stand in for keys and clicks. */
  touchButton(k) {
    if (this.state !== 'play') return;
    const input = this.input;
    if (k === 'raise') input.tap('KeyF');
    else if (k === 'shutter') input.clicked.add(0);
    else if (k === 'zoomIn') input.wheel -= 1;
    else if (k === 'zoomOut') input.wheel += 1;
    else if (k === 'fDown') input.tap('KeyQ');
    else if (k === 'fUp' || k === 'act') input.tap('KeyE');
  }

  /** Called after the frame has been rendered. */
  postRender() {
    if (!this.pendingShot) return;
    this.pendingShot = false;
    const img = this.capture();
    this.afterShot(img);
  }

  /** Nearest point on the stream + the closest cascade (for audio). */
  soundSources() {
    const pts = this.world.stream.points;
    const p = this.camera.position;
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const d = (pts[i][0] - p.x) ** 2 + (pts[i][2] - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = pts[i];
      }
    }
    const casc = [
      [-2.4, 5.2, -6.0],
      [2.55, 4.7, 5.8],
      [6.3, 3.5, 57.8],
    ];
    let cb = null;
    let cd = Infinity;
    for (const c of casc) {
      const d = (c[0] - p.x) ** 2 + (c[2] - p.z) ** 2;
      if (d < cd) {
        cd = d;
        cb = c;
      }
    }
    return { stream: best ? { pos: new Vector3(best[0], best[1], best[2]) } : null, cascade: cb ? new Vector3(...cb) : null };
  }

  updateAudio(dt) {
    const s = this.soundSources();
    this.audio.update(dt, this.camera, this.world, this.world.time.current, G.uWind.value.z, s.stream, s.cascade);
    if (this.life.chime.ring && this.camera.position.distanceTo(this.life.furinPos) < 40) this.audio.chime(this.life.furinPos);
  }
}
