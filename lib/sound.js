'use client';

let cachedController = null;

const SOUND_PRESETS = {
  cart: { freq: 660, gain: 0.25, decay: 0.18 },
  unlock: { freq: 880, gain: 0.26, decay: 0.25 },
  lock: { freq: 440, gain: 0.22, decay: 0.22 },
  bubble: { freq: 1020, gain: 0.18, decay: 0.16 },
};

class SoundController {
  constructor() {
    this.audioCtx = null;
    this.muted = false;
    this.listeners = new Set();
    this._hydrated = false;
    this.files = {};
    this.buffers = new Map();
    this.loading = new Map();

    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem('km_sound_muted');
        if (stored === '1') this.muted = true;
      } catch {}
      window.__KM_SOUND__ = this;
    }
  }

  getAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.audioCtx = new Ctx();
    }
    return this.audioCtx;
  }

  async ensureRunning() {
    const ctx = this.getAudioContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    return ctx;
  }

  isMuted() {
    return this.muted;
  }

  setMuted(next) {
    const value = !!next;
    if (value === this.muted) return;
    this.muted = value;
    try {
      window.localStorage.setItem('km_sound_muted', value ? '1' : '0');
    } catch {}
    this.listeners.forEach((fn) => {
      try { fn(this.muted); } catch {}
    });
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  subscribeMute(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setFiles(map) {
    this.files = { ...this.files, ...map };
    Object.keys(map).forEach((key) => {
      this.buffers.delete(key);
      this.loading.delete(key);
    });
  }

  async loadBuffer(type) {
    const url = this.files?.[type];
    if (!url) return null;

    if (this.buffers.has(type)) return this.buffers.get(type);
    if (this.loading.has(type)) return this.loading.get(type);

    const promise = (async () => {
      const ctx = await this.ensureRunning();
      if (!ctx) return null;
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`Failed to load sound ${type}: ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        this.buffers.set(type, audioBuffer);
        return audioBuffer;
      } catch (err) {
        console.warn('[sound] unable to load', type, err);
        return null;
      } finally {
        this.loading.delete(type);
      }
    })();

    this.loading.set(type, promise);
    return promise;
  }

  async play(type) {
    if (this.muted) return;
    const ctx = await this.ensureRunning();
    if (!ctx) return;

    const buffer = await this.loadBuffer(type);
    if (buffer) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1, ctx.currentTime);
      src.buffer = buffer;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }

    const preset = SOUND_PRESETS[type] || SOUND_PRESETS.cart;
    const now = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(preset.freq, now);

    gain.gain.setValueAtTime(preset.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + preset.decay);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + preset.decay + 0.05);
  }
}

export function getSoundController() {
  if (cachedController) return cachedController;
  if (typeof window === 'undefined') return null;
  cachedController = window.__KM_SOUND__ || new SoundController();
  return cachedController;
}

export function playSound(type) {
  const controller = getSoundController();
  controller?.play(type);
}

export function toggleMute() {
  const controller = getSoundController();
  controller?.toggleMute();
}

export function isMuted() {
  const controller = getSoundController();
  return controller?.isMuted?.() ?? false;
}

export function onMuteChange(listener) {
  const controller = getSoundController();
  if (!controller) return () => {};
  return controller.subscribeMute(listener);
}

export function configureSoundEffects(map) {
  const controller = getSoundController();
  controller?.setFiles(map || {});
}
