import { Vector3 } from 'three';

/**
 * Procedural soundscape (no audio files): the stream, wind in the leaves,
 * birds and cicadas by day, crickets at night, the wind chime, footsteps and
 * the camera shutter. Everything is synthesised with WebAudio.
 */
export class SoundScape {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.timeName = 'afternoon';
    this.nextBird = 0;
    this.nextCricket = 0;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // shared noise sources
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    const p = pink.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      b0 = 0.99765 * b0 + x * 0.099046;
      b1 = 0.963 * b1 + x * 0.2965164;
      b2 = 0.57 * b2 + x * 1.0526913;
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.18;
    }
    this.white = white;
    const loop = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.loopStart = Math.random();
      s.start(0, Math.random() * 2);
      return s;
    };

    // stream: two layers at the nearest point of the water, plus cascades
    this.streamPan = this.panner();
    const sGain = (this.streamGain = ctx.createGain());
    sGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    loop(pink).connect(lp).connect(sGain);
    const bab = ctx.createBiquadFilter();
    bab.type = 'bandpass';
    bab.frequency.value = 900;
    bab.Q.value = 2.5;
    this.babble = bab;
    const babG = ctx.createGain();
    babG.gain.value = 0.55;
    loop(white).connect(bab).connect(babG).connect(sGain);
    sGain.connect(this.streamPan).connect(this.master);

    this.cascadePan = this.panner();
    const cg = (this.cascadeGain = ctx.createGain());
    cg.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    loop(white).connect(hp).connect(cg).connect(this.cascadePan).connect(this.master);

    // wind + leaves
    const wg = (this.windGain = ctx.createGain());
    wg.gain.value = 0;
    const wl = ctx.createBiquadFilter();
    wl.type = 'lowpass';
    wl.frequency.value = 420;
    loop(pink).connect(wl).connect(wg).connect(this.master);
    const lg = (this.leafGain = ctx.createGain());
    lg.gain.value = 0;
    const lb = ctx.createBiquadFilter();
    lb.type = 'bandpass';
    lb.frequency.value = 3800;
    lb.Q.value = 0.6;
    loop(white).connect(lb).connect(lg).connect(this.master);

    // cicadas (summer afternoon): a pulsing high tone
    const cic = ctx.createOscillator();
    cic.type = 'sawtooth';
    cic.frequency.value = 4300;
    const cicF = ctx.createBiquadFilter();
    cicF.type = 'bandpass';
    cicF.frequency.value = 4600;
    cicF.Q.value = 3;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const cg2 = (this.cicadaGain = ctx.createGain());
    cg2.gain.value = 0;
    cic.connect(cicF).connect(am).connect(cg2).connect(this.master);
    cic.start();
    lfo.start();
  }

  panner() {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.rolloffFactor = 1.2;
    p.maxDistance = 200;
    return p;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  setPos(p, v) {
    const t = this.ctx.currentTime;
    p.positionX.setTargetAtTime(v.x, t, 0.05);
    p.positionY.setTargetAtTime(v.y, t, 0.05);
    p.positionZ.setTargetAtTime(v.z, t, 0.05);
  }

  /** Short filtered noise burst. */
  burst({ freq = 1000, q = 1, type = 'bandpass', dur = 0.12, gain = 0.3, at = 0, pos = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    if (pos) {
      const p = this.panner();
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    src.start(t, Math.random() * 2, dur + 0.05);
  }

  tone({ freq, dur = 0.3, gain = 0.1, at = 0, type = 'sine', sweep = 0, pos = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (pos) {
      const p = this.panner();
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shutter() {
    if (!this.ctx) return;
    this.burst({ freq: 2600, q: 1.2, dur: 0.05, gain: 0.5 });
    this.tone({ freq: 140, dur: 0.07, gain: 0.25, type: 'triangle', sweep: 0.6 });
    this.burst({ freq: 1800, q: 1.5, dur: 0.06, gain: 0.35, at: 0.075 });
  }

  step(surface, run) {
    if (!this.ctx) return;
    const g = run ? 0.22 : 0.15;
    if (surface === 'wood') {
      this.tone({ freq: 170 + Math.random() * 30, dur: 0.09, gain: g * 0.9, type: 'triangle', sweep: 0.7 });
      this.burst({ freq: 900, q: 2, dur: 0.05, gain: g * 0.4 });
    } else if (surface === 'water') {
      this.burst({ freq: 900 + Math.random() * 500, q: 0.8, dur: 0.32, gain: g * 1.3 });
      this.burst({ freq: 2400, q: 1, dur: 0.18, gain: g * 0.6, at: 0.04 });
    } else if (surface === 'stone') {
      this.burst({ freq: 2200, q: 2.5, dur: 0.05, gain: g * 0.7 });
    } else {
      this.burst({ freq: 1300 + Math.random() * 600, q: 0.6, dur: 0.16, gain: g * 0.55 });
      this.burst({ freq: 3800, q: 1.2, dur: 0.1, gain: g * 0.25, at: 0.02 });
    }
  }

  chime(pos) {
    if (!this.ctx) return;
    const base = 2100 + Math.random() * 60;
    [1, 2.76, 5.4].forEach((k, i) => this.tone({ freq: base * k, dur: 2.2 - i * 0.5, gain: 0.05 / (i + 1), pos }));
    this.burst({ freq: 6000, q: 3, dur: 0.03, gain: 0.03, pos });
  }

  bird(pos) {
    const f = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      this.tone({ freq: f * (1 + (Math.random() - 0.5) * 0.2), dur: 0.09 + Math.random() * 0.08, gain: 0.035, at: i * 0.14, sweep: 0.7 + Math.random() * 0.7, pos });
    }
  }

  cricket(pos) {
    for (let i = 0; i < 3; i++) this.tone({ freq: 4400, dur: 0.035, gain: 0.025, at: i * 0.05, pos });
  }

  /** listener follows the camera; ambience follows the world state. */
  update(dt, camera, world, timeName, wind, nearestStream, cascade) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const L = ctx.listener;
    const pos = camera.position;
    const fwd = camera.getWorldDirection(new Vector3());
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05);
      L.positionY.setTargetAtTime(pos.y, t, 0.05);
      L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    }
    if (nearestStream) {
      this.setPos(this.streamPan, nearestStream.pos);
      this.streamGain.gain.setTargetAtTime(0.55, t, 0.5);
      this.babble.frequency.setTargetAtTime(700 + Math.random() * 700, t, 0.08);
    }
    if (cascade) {
      this.setPos(this.cascadePan, cascade);
      this.cascadeGain.gain.setTargetAtTime(0.32, t, 0.5);
    }
    const day = timeName === 'afternoon' || timeName === 'golden';
    this.windGain.gain.setTargetAtTime(0.05 + wind * 0.25, t, 0.4);
    this.leafGain.gain.setTargetAtTime(wind * 0.05, t, 0.3);
    this.cicadaGain.gain.setTargetAtTime(timeName === 'afternoon' ? 0.012 * (0.6 + 0.4 * Math.sin(t * 0.2)) : 0, t, 1.5);

    const now = performance.now() / 1000;
    if (day && now > this.nextBird) {
      const a = Math.random() * Math.PI * 2;
      this.bird(new Vector3(pos.x + Math.cos(a) * 20, pos.y + 8, pos.z + Math.sin(a) * 20));
      this.nextBird = now + 2 + Math.random() * 7;
    }
    if (!day && now > this.nextCricket) {
      const a = Math.random() * Math.PI * 2;
      this.cricket(new Vector3(pos.x + Math.cos(a) * 6, pos.y - 1.4, pos.z + Math.sin(a) * 6));
      this.nextCricket = now + 0.25 + Math.random() * 0.9;
    }
  }
}
