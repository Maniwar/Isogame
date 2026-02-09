/**
 * Procedural sound effects using Web Audio API.
 * No external audio files needed — all sounds synthesized at runtime.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private initialized = false;

  /** Must be called from a user gesture (click/tap) to unlock audio */
  init() {
    if (this.initialized) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.4;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch {
      console.warn("[Sound] Web Audio API not available");
    }
  }

  private ensure() {
    if (!this.initialized) this.init();
    if (this.ctx?.state === "suspended") this.ctx.resume();
    return this.ctx && this.masterGain;
  }

  // ---------------------------------------------------------------------------
  // Combat sounds
  // ---------------------------------------------------------------------------

  /** Gunshot — sharp noise burst + low thump */
  gunshot() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Noise burst (the crack)
    const noiseDur = 0.08;
    const noiseBuffer = this.createNoise(noiseDur);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 1000;

    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(this.masterGain!);
    noiseSrc.start(now);
    noiseSrc.stop(now + noiseDur);

    // Low thump
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(oscGain).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** Melee slash — quick filtered noise sweep */
  slash() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const dur = 0.12;
    const buffer = this.createNoise(dur);
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + dur);
    filter.Q.value = 2;

    src.connect(filter).connect(gain).connect(this.masterGain!);
    src.start(now);
    src.stop(now + dur);
  }

  /** Flesh impact — wet thud */
  impact(severity: number) {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const vol = Math.min(0.7, 0.2 + severity * 0.05);
    const dur = 0.1 + severity * 0.02;

    // Thud
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80 + severity * 5, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + dur);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vol, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(oscGain).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + dur);

    // Wet noise component
    const noiseBuf = this.createNoise(dur * 0.7);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.7);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600 + severity * 40;

    noiseSrc.connect(lp).connect(noiseGain).connect(this.masterGain!);
    noiseSrc.start(now);
    noiseSrc.stop(now + dur * 0.7);
  }

  /** Miss — quiet whoosh */
  miss() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const dur = 0.15;
    const buf = this.createNoise(dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2000, now);
    bp.frequency.linearRampToValueAtTime(500, now + dur);
    bp.Q.value = 1;

    src.connect(bp).connect(gain).connect(this.masterGain!);
    src.start(now);
    src.stop(now + dur);
  }

  /** Death sound — low rumble + crunch */
  death() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Deep rumble
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(oscGain).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.5);

    // Crunch noise
    const nBuf = this.createNoise(0.2);
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.5, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(800, now);
    lp.frequency.exponentialRampToValueAtTime(100, now + 0.25);

    nSrc.connect(lp).connect(nGain).connect(this.masterGain!);
    nSrc.start(now);
    nSrc.stop(now + 0.25);

    // Second thud (body hitting ground)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(50, now + 0.2);
    osc2.frequency.exponentialRampToValueAtTime(20, now + 0.5);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.001, now);
    osc2Gain.gain.setValueAtTime(0.3, now + 0.2);
    osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc2.connect(osc2Gain).connect(this.masterGain!);
    osc2.start(now);
    osc2.stop(now + 0.5);
  }

  /** Critical hit — metallic ring + heavy impact */
  critical() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Ring
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;

    const ring = ctx.createGain();
    ring.gain.setValueAtTime(0.3, now);
    ring.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(ring).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.3);

    // Heavy impact after tiny delay
    setTimeout(() => this.impact(15), 30);
  }

  /** UI click — tiny blip */
  uiClick() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 660;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain).connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** Combat start — ominous tone */
  combatStart() {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 110 * (1 + i * 0.5);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;

      osc.connect(lp).connect(gain).connect(this.masterGain!);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private createNoise(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
