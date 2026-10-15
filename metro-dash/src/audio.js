// Synthesised sound: every effect and the background beat are generated with
// WebAudio at runtime, so the game ships no audio files.
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

  // ---------- music: a 2-bar-per-chord street beat in A minor, 98 BPM ----------
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
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
    const spb = 60 / 98 / 4; // 16th notes
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      // light swing on off-beats
      this.nextTime += spb * (this.step % 2 ? 0.86 : 1.14);
      this.step = (this.step + 1) % 128;
    }
  }

  playStep(s, t) {
    const bus = this.musicBus;
    const beat = s % 16;
    const bar = Math.floor(s / 16);
    // chords: Am F C G, two bars each
    const roots = [45, 41, 48, 43];
    const chordTones = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const ci = Math.floor(bar / 2) % 4;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const kick = [0, 7, 10].includes(beat) || (bar % 2 === 1 && beat === 14);
    const snare = beat === 4 || beat === 12;
    if (kick) this.drum(t, 'kick');
    if (snare) this.drum(t, 'snare');
    if (beat % 2 === 0 || beat === 15) this.drum(t, beat % 4 === 2 ? 'openhat' : 'hat');
    // bass line
    const bassPattern = { 0: 0, 3: 0, 7: 12, 10: 0, 13: 7 };
    if (beat in bassPattern) this.note(midi(roots[ci] - 12 + bassPattern[beat]), t, 0.22, 'sawtooth', 0.16, 420);
    // offbeat chord stabs
    if (beat === 2 || beat === 6 || beat === 11) {
      for (const n of chordTones[ci]) this.note(midi(n), t, 0.12, 'square', 0.035, 1800);
    }
    // little lead hook every other pass
    if (Math.floor(bar / 8) % 2 === 1) {
      const hook = { 0: 76, 3: 74, 6: 72, 8: 69, 11: 72, 14: 74 };
      if (beat in hook) this.note(midi(hook[beat] - (ci === 1 ? 4 : ci === 3 ? 2 : 0)), t, 0.18, 'triangle', 0.07, 3000);
    }
  }

  note(freq, t, dur, type, vol, cutoff) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
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
