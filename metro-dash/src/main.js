// 地铁疾跑 · METRO DASH — game bootstrap, state machine and run logic.
import * as THREE from 'three';
import hoodieVRM from '../assets/nanami-hoodie.vrm';
import denimVRM from '../assets/nanami-denim.vrm';
import guardVRM from '../assets/guard.vrm';
import {
  laneX, TRAIN, PLAYER, PHYS, SPEED, JET_Y, HOVER_TIME, AHEAD, BEHIND,
  POWERUPS, UPGRADE_COST, BOARD_COST, OUTFITS, REVIVE_COST,
} from './config.js';
import { curveUniforms } from './curve.js';
import { loadSave, writeSave } from './storage.js';
import { makeSkyTexture, makeBoardTexture } from './textures.js';
import { World } from './world.js';
import { Props } from './props.js';
import { Level } from './level.js';
import { Particles } from './fx.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { UI, $ } from './ui.js';
import {
  loadVRM, Character, attachToBone, makeGuardCap, makeHoverboard, makeJetpack, makeMagnet, makeSneakerGlow,
} from './characters.js';

const VRM_BYTES = { hoodie: hoodieVRM, denim: denimVRM };
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

class Game {
  constructor() {
    this.save = loadSave();
    this.ui = new UI(this);
    this.sound = new Sound();
    this.sound.muted = this.save.muted;

    const canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = this.maxRatio;
    this.renderer.setPixelRatio(this.ratio);

    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0xcfeaf8, 80, AHEAD - 5);
    this.scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x8d7d68, 1.9));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    sun.position.set(-5, 12, 6);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

    this.player = this.freshPlayer(0);
    this.state = 'loading';
    this.time = 0;
    this.camShake = 0;
    this.perf = { acc: 0, frames: 0 };

    window.addEventListener('resize', () => this.resize());
    this.resize();
    new Input(document.getElementById('app'), (a) => this.onInput(a));
    this.bindUI();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
  }

  freshPlayer(z) {
    return {
      lane: 1, prevLane: 1, x: 0, y: 0, z, vy: 0, grounded: true, airT: 0,
      rollT: 0, rollQueued: false, jumpT: 0, buffer: null, bufferT: 0,
      invuln: 0, stumbleCool: 0, wobble: 0,
      jet: 0, board: 0, magnet: 0, sneakers: 0, x2: 0,
    };
  }

  // ---------------------------------------------------------------- loading
  async load() {
    this.ui.setLoading(0.08, '七海正在系鞋带…');
    // graffiti and signs are painted with the web fonts, so give them a moment
    if (document.fonts) {
      await Promise.race([
        Promise.all([document.fonts.load('40px Bungee'), document.fonts.load('40px "ZCOOL QingKe HuangYou"', '地铁疾跑七海橙子站晚霞路涂鸦公园终点')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {});
    }
    this.world = new World(this.scene);
    this.props = new Props();
    this.level = new Level(this.scene, this.props);
    this.fx = new Particles(this.scene);
    this.ui.setLoading(0.2);
    await new Promise((r) => setTimeout(r, 30));
    this.outfits = {};
    this.char = await this.makeRunner(this.save.outfits.includes(this.save.outfit) ? this.save.outfit : 'hoodie');
    this.ui.setLoading(0.6, '巡站员正在戴帽子…');
    await new Promise((r) => setTimeout(r, 30));
    this.guard = new Character(await loadVRM(guardVRM));
    this.dressGuard(this.guard);
    this.scene.add(this.guard.root);
    this.guard.root.visible = false;
    this.ui.setLoading(0.85, '列车进站…');
    await new Promise((r) => setTimeout(r, 30));
    this.toMenu();
    this.renderer.compile(this.scene, this.camera);
    this.ui.setLoading(1, '出发！');
    this.ui.hideLoading();
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  async makeRunner(id) {
    if (this.outfits[id]) return this.outfits[id];
    const c = new Character(await loadVRM(VRM_BYTES[id]));
    const props = {};
    props.board = makeHoverboard(makeBoardTexture());
    props.board.position.y = -0.2;
    props.board.visible = false;
    c.root.add(props.board);
    props.jet = attachToBone(c, c.bone('upperChest') ? 'upperChest' : 'chest', makeJetpack(), [0, -0.02, -0.17]);
    props.magnet = attachToBone(c, 'rightHand', makeMagnet(1), [-0.09, -0.02, 0.03]);
    props.shoes = ['leftFoot', 'rightFoot'].map((b) => {
      const s = makeSneakerGlow();
      s.rotation.x = Math.PI / 2;
      return attachToBone(c, b, s, [0, -0.06, 0.03]);
    });
    c.props = props;
    this.outfits[id] = c;
    return c;
  }

  dressGuard(g) {
    const head = g.bone('head');
    if (head) {
      // sit the cap on top of the hair
      g.vrm.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.vrm.scene);
      const headY = head.getWorldPosition(new THREE.Vector3()).y;
      attachToBone(g, 'head', makeGuardCap(), [0, box.max.y - headY - 0.075, 0.0]);
    }
    // navy uniform: tint the blazer materials (colours are linear, so use a strong blue)
    const navy = new THREE.Color('#4a63b8');
    g.vrm.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (/Tops_01_CLOTH_0[12]/.test(m.name) && m.color) {
          m.color.multiply(navy);
          if (m.shadeColorFactor) m.shadeColorFactor.multiply(navy);
        }
      }
    });
  }

  // ---------------------------------------------------------------- UI wiring
  bindUI() {
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); this.sound.unlock(); this.sound.click(); fn(); });
    click('btn-play', () => this.startRun());
    click('btn-shop', () => { this.ui.renderShop(); this.ui.screen('shop'); });
    click('btn-help', () => this.ui.screen('help'));
    click('btn-sound', () => {
      this.save.muted = !this.save.muted;
      this.sound.setMuted(this.save.muted);
      writeSave(this.save);
      this.ui.menuStats();
    });
    click('shop-close', () => { this.ui.menuStats(); this.ui.screen('menu'); });
    click('help-close', () => this.ui.screen('menu'));
    click('btn-pause', () => this.pause());
    click('btn-resume', () => this.resume());
    click('btn-quit', () => this.toMenu());
    click('btn-retry', () => this.startRun());
    click('btn-home', () => this.toMenu());
    click('btn-revive', () => this.revive());
    $('btn-board').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.useBoard(); });
    $('shop-list').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      this.sound.unlock();
      this.shopAction(b.dataset);
    });
  }

  async shopAction(d) {
    const s = this.save;
    if (d.buy === 'board') {
      if (s.coins < BOARD_COST) return;
      s.coins -= BOARD_COST; s.boards++;
    } else if (d.buy) {
      const lv = s.levels[d.buy];
      const cost = UPGRADE_COST[lv];
      if (cost === undefined || s.coins < cost) return;
      s.coins -= cost; s.levels[d.buy] = lv + 1;
    } else if (d.outfit) {
      const o = OUTFITS.find((x) => x.id === d.outfit);
      if (!o || s.coins < o.cost) return;
      s.coins -= o.cost; s.outfits.push(o.id);
      await this.wear(o.id);
    } else if (d.wear) {
      await this.wear(d.wear);
    } else return;
    this.sound.buy();
    writeSave(s);
    this.ui.renderShop();
  }

  async wear(id) {
    this.save.outfit = id;
    const next = await this.makeRunner(id);
    if (next === this.char) return;
    this.scene.remove(this.char.root);
    this.char = next;
    this.scene.add(next.root);
    this.placeMenuCharacter();
  }

  // ---------------------------------------------------------------- states
  toMenu() {
    this.state = 'menu';
    this.sound.stopMusic();
    this.sound.jetLoop(false);
    this.player = this.freshPlayer(0);
    this.world.reset(0);
    this.world.update(0, AHEAD, BEHIND);
    this.level.reset(0);
    this.level.obstacles.forEach((o) => this.scene.remove(o.mesh));
    this.level.obstacles = [];
    this.level.coins = [];
    this.fx.clear();
    if (!this.char.root.parent) this.scene.add(this.char.root);
    this.placeMenuCharacter();
    this.guard.root.visible = false;
    curveUniforms.uCurveX.value = 0;
    this.ui.clearPowers();
    this.ui.danger(false);
    this.ui.menuStats();
    this.ui.screen('menu');
  }

  placeMenuCharacter() {
    const c = this.char;
    c.root.position.set(0, 0, 0);
    c.body.rotation.set(0, 0, 0);
    c.root.rotation.set(0, 0, 0);
    for (const k of ['board', 'jet', 'magnet']) if (c.props[k]) c.props[k].visible = false;
    c.props.shoes.forEach((s) => { s.visible = false; });
    c.play('dance', { fade: 0 });
    c.setFace('happy', 0.7);
    c.resetSprings();
  }

  startRun() {
    this.sound.unlock();
    const c = this.char;
    this.player = this.freshPlayer(0);
    this.world.reset(0);
    this.level.reset(0);
    this.fx.clear();
    this.score = 0;
    this.runCoins = 0;
    this.bankedCoins = 0;
    this.runTime = 0;
    this.distance = 0;
    this.speed = SPEED.START;
    this.revives = 0;
    this.guardDist = 2.2;
    this.guardChase = 2.6; // the guard is on screen while this runs
    this.strikeT = 0; // a second stumble while this runs gets you caught
    this.introT = 0;
    this.newBest = false;
    this.diff = 0;
    c.root.position.set(0, 0, 0);
    c.body.rotation.set(0, 0, 0);
    c.play('run', { fade: 0.25 });
    c.setFace(null);
    this.guard.root.visible = true;
    this.guard.root.position.set(0, 0, this.guardDist);
    this.guard.play('jog', { fade: 0 });
    this.guard.setFace('angry', 1);
    this.guard.resetSprings();
    this.ui.clearPowers();
    this.ui.screen('hud');
    this.ui.toast('快跑！', 'go');
    this.sound.whistle();
    this.sound.startMusic();
    this.state = 'play';
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.sound.stopMusic();
    this.sound.jetLoop(false);
    this.ui.screen('hud pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.last = performance.now();
    this.sound.startMusic();
    if (this.player.jet > 0) this.sound.jetLoop(true);
    this.ui.screen('hud');
  }

  die(reason) {
    if (this.state !== 'play') return;
    const p = this.player;
    this.state = 'dying';
    this.deathReason = reason;
    this.dieT = 0;
    p.jet = 0; p.board = 0;
    this.sound.jetLoop(false);
    this.sound.stopMusic();
    this.sound.crash();
    this.camShake = 0.6;
    this.char.vrm.scene.visible = true;
    this.char.props.board.visible = false;
    this.char.props.jet.visible = false;
    this.char.play('death', { loop: false, clamp: true, fade: 0.08 });
    this.char.setFace('surprised', 1);
    this.guard.root.visible = true;
    this.fx.emit(p.x, p.y + 1, p.z - 0.4, { n: 24, color: 0xffffff, speed: 5, life: 0.6, size: 0.7 });
    this.ui.danger(false);
  }

  showOver() {
    this.state = 'over';
    const s = this.save;
    const gained = this.runCoins - this.bankedCoins;
    s.coins += gained;
    this.bankedCoins = this.runCoins;
    s.runs++;
    if (this.score > s.best) { s.best = this.score; this.newBest = true; }
    writeSave(s);
    $('over-title').textContent = this.deathReason === 'caught' ? '被巡站员抓住了！' : '撞上了！';
    $('over-score').textContent = this.score.toLocaleString('en-US');
    $('over-best').hidden = !this.newBest;
    $('over-best-val').textContent = s.best.toLocaleString('en-US');
    $('over-coins').textContent = `+${this.runCoins.toLocaleString('en-US')}`;
    $('over-bank').textContent = s.coins.toLocaleString('en-US');
    const cost = REVIVE_COST * 2 ** this.revives;
    const rb = $('btn-revive');
    rb.innerHTML = `继续奔跑 <span class="cost"><i class="coin-ico"></i>${cost}</span>`;
    rb.disabled = s.coins < cost;
    this.ui.screen('hud over');
    this.char.setFace('sad', 1);
  }

  revive() {
    const cost = REVIVE_COST * 2 ** this.revives;
    if (this.state !== 'over' || this.save.coins < cost) return;
    this.save.coins -= cost;
    writeSave(this.save);
    this.revives++;
    const p = this.player;
    this.level.clearRange(p.z + 6, p.z - 60);
    p.y = this.level.groundAt(p.x, p.z);
    p.vy = 0; p.grounded = true; p.rollT = 0; p.invuln = 2.5; p.stumbleCool = 0;
    p.lane = Math.round(p.x / 2.4) + 1;
    this.guardChase = 0;
    this.strikeT = 0;
    this.char.play('run', { fade: 0.2 });
    this.char.setFace(null);
    this.guard.play('jog', { fade: 0.1 });
    this.ui.screen('hud');
    this.ui.toast('复活！', 'go');
    this.sound.power();
    this.sound.startMusic();
    this.state = 'play';
  }

  // ---------------------------------------------------------------- input
  onInput(a) {
    this.sound.unlock();
    if (this.state === 'menu') {
      if ((a === 'enter' || a === 'up') && $('shop').hidden && $('help').hidden) this.startRun();
      if (a === 'pause' && (!$('shop').hidden || !$('help').hidden)) { this.ui.menuStats(); this.ui.screen('menu'); }
      return;
    }
    if (this.state === 'paused') { if (a === 'pause' || a === 'enter') this.resume(); return; }
    if (this.state === 'over') { if (a === 'enter') this.startRun(); return; }
    if (this.state !== 'play') return;
    const p = this.player;
    if (a === 'pause') return this.pause();
    if (a === 'double') return this.useBoard();
    if (a === 'left' || a === 'right') {
      const nl = p.lane + (a === 'left' ? -1 : 1);
      if (nl < 0 || nl > 2) {
        p.wobble = 0.25;
        this.sound.bump();
        return;
      }
      p.prevLane = p.lane;
      p.lane = nl;
      this.sound.lane();
      return;
    }
    if (p.jet > 0) return;
    if (a === 'up') this.jump();
    if (a === 'down') this.roll();
  }

  jump() {
    const p = this.player;
    if (p.grounded || p.airT < 0.12) {
      const v = p.sneakers > 0 ? PHYS.JUMP_SNEAKERS : PHYS.JUMP;
      p.vy = v;
      p.grounded = false;
      p.airT = 1;
      p.rollT = 0;
      p.jumpT = 2 * v / PHYS.G;
      this.char.play('jump', { restart: true, loop: false, clamp: true, fade: 0.08, speed: 0.9 / (p.jumpT + 0.12) });
      this.sound.jump();
    } else {
      p.buffer = 'up';
      p.bufferT = 0.22;
    }
  }

  roll() {
    const p = this.player;
    if (p.grounded) {
      p.rollT = PHYS.ROLL_T;
      this.char.play('roll', { restart: true, loop: false, clamp: true, fade: 0.06, speed: 0.7 / PHYS.ROLL_T });
      this.sound.roll();
    } else {
      p.vy = Math.min(p.vy, PHYS.SLAM);
      p.rollQueued = true;
    }
  }

  useBoard() {
    const p = this.player;
    if (this.state !== 'play' || p.board > 0 || this.save.boards <= 0) return;
    this.save.boards--;
    writeSave(this.save);
    p.board = HOVER_TIME;
    this.sound.board();
    this.ui.toast('滑板启动！', 'board');
    this.fx.emit(p.x, p.y + 0.2, p.z, { n: 20, color: 0x5ff6ff, speed: 4, life: 0.5 });
  }

  activatePower(type) {
    const p = this.player;
    const lv = this.save.levels[type];
    const dur = POWERUPS[type].base + POWERUPS[type].per * lv;
    p[type === 'jetpack' ? 'jet' : type] = dur;
    this.powerDur = this.powerDur || {};
    this.powerDur[type] = dur;
    this.sound.power();
    this.ui.toast(POWERUPS[type].name, type);
    this.char.setFace('happy', 1);
    this.faceT = 1.2;
    if (type === 'jetpack') {
      p.rollT = 0;
      p.grounded = false;
      this.level.skyCoins(p.z, dur * this.speed + 30);
      this.sound.jetLoop(true);
    }
  }

  // ---------------------------------------------------------------- per-frame
  frame(t) {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.adaptResolution(dt);

    if (this.state === 'play') this.updatePlay(dt);
    else if (this.state === 'dying' || this.state === 'over') this.updateDeath(dt);
    else if (this.state === 'menu') this.updateMenu(dt);

    if (this.state !== 'paused') {
      this.char.update(dt);
      if (this.guard.root.visible) this.guard.update(dt);
      this.fx.update(dt);
    }
    this.level.renderCoins(this.time, this.player.z);
    this.renderer.render(this.scene, this.camera);
  }

  updateMenu(dt) {
    const c = this.char;
    const a = this.time * 0.25;
    this.camera.position.set(Math.sin(a) * 0.9 + 0.5, 1.3, -3.9 + Math.cos(a) * 0.25);
    this.camera.lookAt(0, 0.95, 0);
    this.world.update(0, AHEAD, BEHIND);
    c.root.position.set(0, 0, 0);
  }

  updatePlay(dt) {
    const p = this.player;
    const g = this;
    this.runTime += dt;
    this.introT = Math.min(1, this.introT + dt / 1.1);
    this.speed = SPEED.START + (SPEED.MAX - SPEED.START) * (1 - Math.exp(-this.runTime / SPEED.TAU));
    this.diff = Math.min(1, this.distance / 3000);

    const prevX = p.x, prevY = p.y, prevZ = p.z;
    p.z -= this.speed * dt;
    this.distance = -p.z;

    // timers
    for (const k of ['magnet', 'sneakers', 'x2', 'board', 'invuln', 'stumbleCool', 'wobble', 'bufferT']) p[k] = Math.max(0, p[k] - dt);
    this.guardChase = Math.max(0, this.guardChase - dt);
    this.strikeT = Math.max(0, this.strikeT - dt);
    if (this.faceT > 0) { this.faceT -= dt; if (this.faceT <= 0) this.char.setFace(null); }
    if (p.jet > 0) {
      p.jet -= dt;
      if (p.jet <= 0) { // landing: clear the stretch we come down into
        p.jet = 0;
        this.level.clearRange(p.z + 4, p.z - 50, false);
        this.level.coins = this.level.coins.filter((c) => c.y < JET_Y - 1);
        p.vy = 0;
        p.invuln = Math.max(p.invuln, 1.2);
        this.sound.jetLoop(false);
      }
    }

    // lateral movement
    const tx = laneX(p.lane);
    const step = PHYS.LANE_SPEED * dt;
    p.x = Math.abs(tx - p.x) <= step ? tx : p.x + Math.sign(tx - p.x) * step;

    // vertical movement
    let ground = this.level.groundAt(p.x, p.z);
    if (p.jet > 0) {
      p.y = damp(p.y, JET_Y, 3, dt);
      p.vy = 0;
      p.grounded = false;
    } else {
      if (p.grounded) {
        if (ground > p.y + 1e-3 && ground - p.y < PHYS.STEP_UP) p.y = ground; // walking up a ramp
        else if (ground < p.y - 0.05) { p.grounded = false; p.vy = 0; p.airT = 0; }
      }
      if (!p.grounded) {
        p.airT += dt;
        p.vy -= PHYS.G * dt;
        p.y += p.vy * dt;
        if (p.y <= ground) {
          p.y = ground;
          const hard = p.vy < -8;
          p.vy = 0;
          p.grounded = true;
          this.onLand(hard);
        }
      }
    }
    if (p.rollT > 0) p.rollT = Math.max(0, p.rollT - dt);
    if (p.bufferT > 0 && p.grounded && p.buffer === 'up') { p.bufferT = 0; this.jump(); }

    // obstacles
    if (p.jet <= 0) this.collide(prevX, prevY, prevZ, dt);
    if (this.state !== 'play') return;

    // collectables
    this.collect(dt);

    // level, scenery
    this.level.update(dt, g, this.time);
    this.world.update(p.z, AHEAD, BEHIND);
    curveUniforms.uCurveX.value = Math.sin(this.distance / 230) * 0.0016;

    // score
    const mult = p.x2 > 0 ? 2 : 1;
    this.scoreF = (this.scoreF || 0) + this.speed * dt * mult;
    this.score = Math.floor(this.scoreF);
    if (!this.newBest && this.save.best > 0 && this.score > this.save.best) {
      this.newBest = true;
      this.ui.toast('新纪录！', 'best');
    }
    this.ui.hud(this.score, this.runCoins, mult);
    const d = this.powerDur || {};
    this.ui.powers({
      magnet: p.magnet / (d.magnet || 1), jetpack: p.jet / (d.jetpack || 1),
      sneakers: p.sneakers / (d.sneakers || 1), x2: p.x2 / (d.x2 || 1), board: p.board / HOVER_TIME,
    });

    this.animateRunner(dt);
    this.updateGuard(dt);
    this.updateCamera(dt);
  }

  onLand(hard) {
    const p = this.player;
    if (hard) this.sound.land();
    this.fx.emit(p.x, p.y + 0.05, p.z, { n: hard ? 10 : 4, color: 0xd9cbb5, speed: 2.5, up: 0.4, life: 0.4, size: 0.45, gravity: 3 });
    if (p.rollQueued) {
      p.rollQueued = false;
      this.roll();
    }
  }

  collide(prevX, prevY, prevZ, dt) {
    const p = this.player;
    const h = p.rollT > 0 ? PLAYER.ROLL_H : PLAYER.H;
    const x0 = p.x - PLAYER.HW, x1 = p.x + PLAYER.HW;
    const zF = p.z + PLAYER.HD, zB = p.z - PLAYER.HD;
    for (const o of this.level.obstacles) {
      if (o.zB > zF + 1 || o.zF < zB - 1) continue;
      const hw = o.kind === 'train' || o.kind === 'ramp' ? TRAIN.W / 2 : 1.0;
      const ox0 = o.x - hw, ox1 = o.x + hw;
      if (x1 <= ox0 || x0 >= ox1 || zB >= o.zF || zF <= o.zB) continue;
      const wasX = prevX + PLAYER.HW > ox0 && prevX - PLAYER.HW < ox1;
      const mv = o.active ? o.u * dt : 0;
      const wasZ = prevZ - PLAYER.HD < o.zF - mv && prevZ + PLAYER.HD > o.zB - mv;
      if (o.kind === 'ramp') {
        // only the sides of a ramp can hurt
        const top = TRAIN.H * (o.zF - p.z) / (o.zF - o.zB);
        if (p.y < top - PHYS.STEP_UP && !wasX) this.stumble(prevX);
        continue;
      }
      if (p.y + h <= o.y0 || p.y >= o.y1 - 1e-3) continue;
      if (p.invuln > 0) continue;
      if (!wasZ && wasX) {
        if (o.kind === 'train' && p.y >= o.y1 - PHYS.STEP_UP) { // close enough: hop onto the roof
          p.y = o.y1; p.vy = 0; p.grounded = true;
          continue;
        }
        this.crash(o);
        return;
      }
      if (prevY >= o.y1 - 0.02) { // came down on top of it
        p.y = o.y1; p.vy = 0; p.grounded = true;
        continue;
      }
      this.stumble(prevX);
      return;
    }
  }

  stumble(prevX) {
    const p = this.player;
    if (p.invuln > 0 || p.stumbleCool > 0) return;
    const back = p.prevLane;
    p.lane = back;
    p.x = prevX;
    p.stumbleCool = 0.7;
    p.wobble = 0.5;
    this.camShake = 0.25;
    this.char.setFace('surprised', 1);
    this.faceT = 0.8;
    if (this.strikeT > 0) { this.die('caught'); return; }
    this.strikeT = 6;
    this.guardChase = 6;
    this.sound.stumble();
    this.ui.toast('小心！', 'warn');
  }

  crash(o) {
    const p = this.player;
    if (p.board > 0) {
      p.board = 0;
      p.invuln = 1.5;
      this.sound.boardBreak();
      this.camShake = 0.35;
      this.fx.emit(p.x, p.y + 0.4, p.z, { n: 30, color: 0x5ff6ff, speed: 6, life: 0.7, size: 0.6 });
      if (o.kind === 'train') { p.y = o.y1; p.vy = 4; p.grounded = false; } // bounce up onto the roof
      else { this.scene.remove(o.mesh); this.level.obstacles.splice(this.level.obstacles.indexOf(o), 1); }
      this.ui.toast('滑板碎了！', 'warn');
      return;
    }
    this.die('crash');
  }

  collect(dt) {
    const p = this.player;
    const cy = p.y + 0.9;
    let got = 0;
    for (const c of this.level.coins) {
      if (c.z > p.z + 3 || c.z < p.z - 20) continue;
      if (p.magnet > 0 && !c.magnet && c.z > p.z - 18 && Math.abs(c.y - cy) < 7) c.magnet = true;
      if (c.magnet) {
        const k = Math.min(1, dt * 12);
        c.x += (p.x - c.x) * k;
        c.y += (cy - c.y) * k;
        c.z += (p.z - c.z) * k + this.speed * dt * -0.2;
      }
      if (Math.abs(c.z - p.z) < 0.9 && Math.abs(c.x - p.x) < 0.9 && c.y > p.y - 0.4 && c.y < p.y + PLAYER.H + 0.6) {
        c.taken = true;
        got++;
        this.fx.emit(c.x, c.y, c.z - 0.3, { n: 4, color: 0xffd23f, speed: 2, life: 0.35, size: 0.4, gravity: 0, vz: -this.speed * 0.6 });
      }
    }
    if (got) { this.runCoins += got; this.sound.coin(); }
    for (const pw of this.level.powerups) {
      if (pw.taken) continue;
      if (Math.abs(pw.z - p.z) < 1.2 && Math.abs(pw.x - p.x) < 1.1 && Math.abs(pw.y - cy) < 1.6) {
        pw.taken = true;
        this.fx.emit(pw.x, pw.y, pw.z, { n: 26, color: { magnet: 0xff4d5e, jetpack: 0xffb02e, sneakers: 0x3ee07a, x2: 0xb56bff }[pw.type], speed: 5, life: 0.6, size: 0.6, gravity: 0 });
        this.activatePower(pw.type);
      }
    }
  }

  animateRunner(dt) {
    const p = this.player;
    const c = this.char;
    const pr = c.props;
    let anim;
    if (p.jet > 0) anim = 'idle';
    else if (p.rollT > 0) anim = 'roll';
    else if (!p.grounded) anim = c.currentName === 'jump' && c.current.time < c.current.getClip().duration * 0.8 ? 'jump' : 'fall';
    else if (p.board > 0) anim = 'idle';
    else anim = 'run';
    if (anim === 'run') c.play('run', { fade: 0.12, speed: 0.8 + this.speed / 45 });
    else if (anim === 'fall' || anim === 'idle') c.play(anim, { fade: 0.2 });

    const tx = laneX(p.lane);
    const lean = (tx - p.x) / 2.4;
    const boardYaw = p.board > 0 && p.grounded && p.rollT <= 0 ? 0.85 : 0;
    c.body.rotation.z = damp(c.body.rotation.z, -lean * 0.3 + Math.sin(this.time * 40) * p.wobble * 0.25, 14, dt);
    c.body.rotation.y = damp(c.body.rotation.y, -lean * 0.45 + boardYaw, 10, dt);
    c.body.rotation.x = damp(c.body.rotation.x, p.jet > 0 ? -0.35 : 0, 6, dt);
    const hover = p.board > 0 ? 0.22 + Math.sin(this.time * 6) * 0.03 : 0;
    c.root.position.set(p.x, p.y + hover, p.z);
    // invulnerability blink
    c.vrm.scene.visible = p.invuln <= 0 || Math.floor(this.time * 16) % 2 === 0;

    pr.board.visible = p.board > 0;
    pr.board.rotation.y = -c.body.rotation.y;
    pr.jet.visible = p.jet > 0 || (p.jet === 0 && false);
    pr.magnet.visible = p.magnet > 0;
    pr.shoes.forEach((s) => { s.visible = p.sneakers > 0; });
    if (p.jet > 0) {
      for (const s of [-0.13, 0.13]) this.fx.emit(p.x + s, p.y + 0.85, p.z + 0.3, { n: 2, color: Math.random() < 0.5 ? 0xffb02e : 0xff5a1f, speed: 0.6, up: -2.5, life: 0.35, size: 0.55, gravity: -2, vz: 3 });
    }
    if (p.board > 0 && p.grounded && Math.random() < 0.5) {
      this.fx.emit(p.x, p.y + 0.05, p.z + 0.5, { n: 1, color: 0x5ff6ff, speed: 0.8, up: 0.3, life: 0.35, size: 0.35, gravity: 0, vz: 4 });
    }
  }

  updateGuard(dt) {
    const p = this.player;
    const g = this.guard;
    const chasing = this.guardChase > 0 && p.jet <= 0;
    const target = chasing ? 2.4 : 24;
    this.guardDist = damp(this.guardDist, target, chasing ? 2.2 : 0.5, dt);
    g.root.visible = this.guardDist < 16;
    this.ui.danger(this.strikeT > 0 && p.jet <= 0);
    if (!g.root.visible) return;
    const gz = p.z + this.guardDist;
    const gx = damp(g.root.position.x, p.x + (p.lane === 2 ? -0.55 : 0.55), 5, dt);
    g.root.position.set(gx, this.level.groundAt(gx, gz), gz);
    g.play('jog', { fade: 0.2, speed: 0.75 + this.speed / 40 });
  }

  updateDeath(dt) {
    const p = this.player;
    const g = this.guard;
    this.dieT += dt;
    this.guardDist = damp(this.guardDist, 1.6, 2.5, dt);
    const gz = p.z + this.guardDist;
    g.root.visible = true;
    g.root.position.set(damp(g.root.position.x, p.x + 0.5, 4, dt), this.level.groundAt(p.x, gz), gz);
    if (this.guardDist < 2.2) g.play('shake', { fade: 0.3 });
    else g.play('jog', { fade: 0.2 });
    this.char.root.position.set(p.x, p.y, p.z);
    this.char.body.rotation.y = damp(this.char.body.rotation.y, 0, 6, dt);
    if (this.state === 'dying' && this.dieT > 1.6) this.showOver();
    // swing the camera round to face the scene
    const k = smooth(Math.min(1, this.dieT / 1.4));
    const back = new THREE.Vector3(p.x * 0.7, p.y + 3, p.z + 6.4);
    const side = new THREE.Vector3(p.x + 3.2, p.y + 2.2, p.z - 3.4);
    this.camera.position.lerpVectors(back, side, k);
    this.applyShake(dt);
    this.camera.lookAt(p.x + 0.3, p.y + 0.8, p.z + 0.6);
  }

  updateCamera(dt) {
    const p = this.player;
    const portrait = this.camera.aspect < 1;
    const dist = portrait ? 7.0 : 6.4;
    const hy = p.jet > 0 ? p.y + 2.6 : Math.max(0, p.y) * 0.72 + 3.55;
    if (this.camY === undefined) this.camY = hy;
    this.camY = damp(this.camY, hy, 6, dt);
    this.camX = damp(this.camX || 0, p.x * (portrait ? 0.86 : 0.72), 9, dt);
    const follow = new THREE.Vector3(this.camX, this.camY, p.z + dist);
    if (this.introT < 1) {
      const k = smooth(this.introT);
      const start = new THREE.Vector3(0.5, 1.3, p.z - 3.9);
      this.camera.position.lerpVectors(start, follow, k);
    } else {
      this.camera.position.copy(follow);
    }
    this.applyShake(dt);
    this.camera.lookAt(this.camX * 1.05, (p.jet > 0 ? p.y : Math.max(0, p.y) * 0.75) + 0.9, p.z - 8);
  }

  applyShake(dt) {
    if (this.camShake <= 0) return;
    this.camShake = Math.max(0, this.camShake - dt);
    const s = this.camShake * 0.6;
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 74 : w / h < 1.2 ? 66 : 58;
    this.camera.updateProjectionMatrix();
  }

  adaptResolution(dt) {
    if (this.state !== 'play') return;
    const pf = this.perf;
    pf.acc += dt; pf.frames++;
    if (pf.acc < 2) return;
    const avg = pf.acc / pf.frames;
    pf.acc = 0; pf.frames = 0;
    if (avg > 1 / 45 && this.ratio > 1) {
      this.ratio = Math.max(1, this.ratio - 0.25);
      this.renderer.setPixelRatio(this.ratio);
      this.resize();
    }
  }
}

const game = new Game();
window.__metroDash = game; // handy for debugging from the console
const boot = () => game.load().catch((e) => {
  console.error(e);
  $('load-text').textContent = `加载失败：${e.message}`;
});
if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
else boot();
