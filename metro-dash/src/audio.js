// Synthesised sound: every effect and the background beat are generated with
// WebAudio at runtime, so the game ships no audio files.
// Grooves per zone (MIDI note numbers). Chords change every two bars.
const ZONES = [
  { bpm: 98, swing: 1.14, roots: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    stabs: true, hook: { 0: 76, 3: 74, 6: 72, 8: 69, 11: 72, 14: 74 }, hookShift: [0, -4, 0, -2] },
  { bpm: 92, swing: 1.18, roots: [41, 40, 38, 36], chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 55, 59]],
    pad: true, stabs: true, hook: { 0: 72, 2: 74, 4: 76, 7: 79, 10: 76, 12: 74 }, hookShift: [0, -1, -3, -5] },
  { bpm: 108, swing: 1.08, roots: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    stabs: true, arp: true, hats16: true, hook: { 0: 81, 3: 79, 6: 76, 8: 74, 11: 76, 14: 79 }, hookShift: [0, -4, 0, -2] },
  { bpm: 118, swing: 1.0, roots: [38, 46, 41, 48], chords: [[62, 65, 69], [58, 62, 65], [57, 60, 65], [55, 60, 64]],
    sawBass: true, arp: true, arpUp: true, pad: true, hats16: true, hook: { 0: 74, 4: 77, 8: 81, 12: 79 }, hookShift: [0, -4, -1, -2] },
  { bpm: 124, swing: 1.0, roots: [40, 36, 43, 38], chords: [[64, 67, 71], [60, 64, 67], [62, 67, 71], [62, 66, 69]],
    sawBass: true, arp: true, arpUp: true, pad: true, shimmer: true, fourFloor: true, hats16: true,
    hook: { 0: 83, 3: 79, 6: 76, 8: 79, 11: 83, 14: 86 }, hookShift: [0, -4, -1, -2] },
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.step = 0;
    this.coinPitch = 0;
    this.coinTimer = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.28;
    this.musicBus.connect(this.master);
    // white noise buffer
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------- building blocks ----------
  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, bus = this.sfxBus, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hiss(dur, { vol = 0.3, freq = 2000, q = 1, type = 'bandpass', sweep = 0, delay = 0, bus = this.sfxBus, at } = {}) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ---------- effects ----------
  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.coinPitch = now - this.coinTimer < 0.35 ? Math.min(this.coinPitch + 1, 8) : 0;
    this.coinTimer = now;
    const base = 1320 * Math.pow(2, this.coinPitch / 24);
    this.tone(base, 0.08, { type: 'square', vol: 0.07 });
    this.tone(base * 1.5, 0.16, { type: 'triangle', vol: 0.12, delay: 0.05 });
  }

  jump() { this.tone(300, 0.18, { type: 'triangle', vol: 0.18, slide: 500 }); this.hiss(0.15, { vol: 0.08, freq: 1800, sweep: 1500 }); }
  roll() { this.hiss(0.28, { vol: 0.18, freq: 600, sweep: -350, q: 0.8 }); }
  land() { this.tone(120, 0.1, { type: 'sine', vol: 0.2, slide: -60 }); }
  lane() { this.hiss(0.1, { vol: 0.07, freq: 3200, sweep: -1800, q: 2 }); }
  bump() { this.tone(160, 0.15, { type: 'square', vol: 0.1, slide: -60 }); }
  stumble() { this.tone(220, 0.12, { type: 'square', vol: 0.14, slide: -120 }); this.tone(150, 0.2, { type: 'square', vol: 0.12, slide: -80, delay: 0.1 }); }
  crash() {
    this.hiss(0.6, { vol: 0.5, freq: 900, sweep: -800, q: 0.6, type: 'lowpass' });
    this.tone(90, 0.5, { type: 'sawtooth', vol: 0.3, slide: -50 });
    this.tone(60, 0.7, { type: 'sine', vol: 0.4, slide: -30 });
  }
  power() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.08, delay: i * 0.06 })); }
  board() { this.tone(400, 0.35, { type: 'sawtooth', vol: 0.08, slide: 900 }); this.hiss(0.4, { vol: 0.1, freq: 4000, q: 3 }); }
  boardBreak() { this.hiss(0.4, { vol: 0.35, freq: 2500, sweep: -2000, q: 1.5 }); this.tone(500, 0.3, { type: 'square', vol: 0.1, slide: -400 }); }
  click() { this.tone(880, 0.06, { type: 'triangle', vol: 0.12 }); }
  buy() { [784, 988, 1319].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.14, delay: i * 0.07 })); }
  whistle() { this.tone(2100, 0.5, { type: 'sine', vol: 0.12, slide: 120, attack: 0.02 }); this.tone(2300, 0.35, { type: 'sine', vol: 0.06, delay: 0.05 }); }
  train() { this.hiss(1.2, { vol: 0.12, freq: 300, sweep: 600, q: 0.7, type: 'lowpass' }); this.tone(330, 0.5, { type: 'square', vol: 0.05 }); this.tone(415, 0.5, { type: 'square', vol: 0.05, delay: 0.5 }); }

  jetLoop(on) {
    if (!this.ctx) return;
    if (on && !this.jetSrc) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      const g = this.ctx.createGain(); g.gain.value = 0.12;
      s.connect(f).connect(g).connect(this.sfxBus);
      s.start();
      this.jetSrc = s;
    } else if (!on && this.jetSrc) {
      this.jetSrc.stop();
      this.jetSrc = null;
    }
  }

  // ---------- music ----------
  // One groove per zone; each later zone is faster and adds layers.
  setZone(z) { this.pendingZone = z; if (!this.musicOn) this.zoneIdx = z; }

  zone() { // stinger when entering a new zone
    this.hiss(0.9, { vol: 0.25, freq: 400, sweep: 5000, q: 1.2 });
    [0, 4, 7, 12].forEach((n, i) => this.tone(523 * Math.pow(2, n / 12), 0.5, { type: 'triangle', vol: 0.1, delay: 0.25 + i * 0.05 }));
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.zoneIdx = this.pendingZone ?? this.zoneIdx ?? 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.2);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    clearInterval(this.timer);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
    setTimeout(() => { if (!this.musicOn && this.ctx) this.musicBus.gain.value = 0.28; }, 600);
  }

  schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      if (this.step % 16 === 0 && this.pendingZone !== undefined && this.pendingZone !== this.zoneIdx) {
        this.zoneIdx = this.pendingZone;
      }
      const z = ZONES[this.zoneIdx] || ZONES[0];
      const spb = 60 / z.bpm / 4; // 16th notes
      this.playStep(this.step, this.nextTime, z);
      this.nextTime += spb * (this.step % 2 ? 2 - z.swing : z.swing);
      this.step = (this.step + 1) % 128;
    }
  }

  playStep(s, t, z) {
    const beat = s % 16;
    const bar = Math.floor(s / 16);
    const ci = Math.floor(bar / 2) % 4;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const chord = z.chords[ci];
    // drums
    const kick = z.fourFloor ? beat % 4 === 0 : ([0, 7, 10].includes(beat) || (bar % 2 === 1 && beat === 14));
    if (kick) this.drum(t, 'kick');
    if (beat === 4 || beat === 12) this.drum(t, 'snare');
    if (z.hats16 || beat % 2 === 0 || beat === 15) this.drum(t, beat % 4 === 2 ? 'openhat' : 'hat');
    // bass
    if (z.sawBass) {
      if (beat % 2 === 0) this.note(midi(z.roots[ci] - 12 + (beat % 4 === 2 ? 12 : 0)), t, 0.16, 'sawtooth', 0.15, 700);
    } else {
      const bp = { 0: 0, 3: 0, 7: 12, 10: 0, 13: 7 };
      if (beat in bp) this.note(midi(z.roots[ci] - 12 + bp[beat]), t, 0.22, 'sawtooth', 0.16, 420);
    }
    // chord stabs
    if (z.stabs && (beat === 2 || beat === 6 || beat === 11)) for (const n of chord) this.note(midi(n), t, 0.12, 'square', 0.033, 1800);
    // pad
    if (z.pad && beat === 0 && bar % 2 === 0) for (const n of chord) this.note(midi(n), t, 60 / z.bpm * 8, 'sawtooth', 0.018, 900, 0.6);
    // arpeggio
    if (z.arp) {
      const seq = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = chord[seq[beat % 8]] + 12 + (beat >= 8 && z.arpUp ? 12 : 0);
      this.note(midi(n), t, 0.09, 'square', 0.03, 2600);
    }
    // shimmer
    if (z.shimmer && beat % 4 === 3 && Math.random() < 0.6) this.note(midi(chord[Math.floor(Math.random() * 3)] + 24), t, 0.4, 'sine', 0.035, 6000);
    // hook every other 8 bars
    if (z.hook && Math.floor(bar / 8) % 2 === 1 && beat in z.hook) {
      this.note(midi(z.hook[beat] + z.hookShift[ci]), t, 0.18, 'triangle', 0.07, 3000);
    }
  }

  note(freq, t, dur, type, vol, cutoff, attack = 0.01) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  drum(t, kind) {
    const bus = this.musicBus;
    if (kind === 'kick') {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(bus);
      o.start(t); o.stop(t + 0.32);
    } else if (kind === 'snare') {
      this.hiss(0.18, { vol: 0.45, freq: 1800, q: 0.7, bus, at: t });
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(220, t);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(bus);
      o.start(t); o.stop(t + 0.12);
    } else {
      this.hiss(kind === 'openhat' ? 0.14 : 0.04, { vol: 0.16, freq: 8000, q: 1, type: 'highpass', bus, at: t });
    }
  }
}
