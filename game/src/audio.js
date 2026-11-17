// audio.js — every sound is synthesized with WebAudio. No audio files, no network.
// The context is created on the first user gesture (browsers require it).
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // One shared white-noise buffer for gunshots and impacts.
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (_e) {
      return false;
    }
  }

  _noise(dur, filterFreq, gainVal, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
  }

  _tone(freq0, freq1, dur, type, gainVal, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun'. `far` = distant, quieter.
  shoot(kind, far = false) {
    if (!this.ctx) return;
    const v = far ? 0.10 : 0.5;
    switch (kind) {
      case 'sniper':
        this._noise(0.28, 900, v); this._tone(220, 40, 0.22, 'sawtooth', v * 0.5);
        break;
      case 'shotgun':
        this._noise(0.32, 700, v); this._tone(140, 35, 0.25, 'square', v * 0.4);
        break;
      case 'smg':
        this._noise(0.09, 2400, v * 0.8);
        break;
      case 'rifle':
        this._noise(0.14, 1600, v); this._tone(180, 60, 0.1, 'sawtooth', v * 0.35);
        break;
      default: // pistol
        this._noise(0.11, 2000, v * 0.9); this._tone(200, 70, 0.08, 'square', v * 0.3);
    }
  }

  hit() { this._tone(1200, 900, 0.06, 'sine', 0.25); }
  kill() { this._tone(880, 1320, 0.12, 'sine', 0.3); this._tone(1320, 1760, 0.1, 'sine', 0.2, 0.07); }
  hurt() { this._tone(160, 60, 0.18, 'sawtooth', 0.35); this._noise(0.12, 500, 0.25); }
  reload() { this._tone(500, 700, 0.06, 'square', 0.15); this._tone(700, 500, 0.06, 'square', 0.15, 0.18); }
  dryFire() { this._tone(900, 700, 0.04, 'square', 0.12); }
  buy() { this._tone(660, 990, 0.09, 'sine', 0.25); this._tone(990, 1320, 0.09, 'sine', 0.2, 0.08); }
  denied() { this._tone(220, 180, 0.12, 'square', 0.2); }
  footstep() { this._noise(0.05, 400, 0.06); }
  roundWin() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, f, 0.16, 'triangle', 0.28, i * 0.11));
  }
  roundLose() {
    [392, 330, 262, 196].forEach((f, i) => this._tone(f, f * 0.94, 0.2, 'triangle', 0.25, i * 0.13));
  }
  matchWin() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone(f, f, 0.22, 'triangle', 0.3, i * 0.12));
  }
  click() { this._tone(800, 800, 0.04, 'sine', 0.18); }
}
