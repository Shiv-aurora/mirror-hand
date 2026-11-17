/**
 * All sound is synthesised in the browser with the Web Audio API, so the app
 * ships no audio files. Everything is quiet and slow on purpose.
 */
export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (the Enter button). */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return;
    }
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.context.destination);
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  /** A soft bell. `semitones` is relative to A3 (220 Hz). */
  bell(semitones: number, volume = 0.5, length = 2.4): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.muted) {
      return;
    }
    const now = ctx.currentTime;
    const frequency = 220 * Math.pow(2, semitones / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + length);
    gain.connect(this.master);
    const partials = [1, 2.01, 3.02];
    const levels = [1, 0.32, 0.1];
    for (let i = 0; i < partials.length; i++) {
      const osc = ctx.createOscillator();
      const level = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency * partials[i];
      level.gain.value = levels[i];
      osc.connect(level);
      level.connect(gain);
      osc.start(now);
      osc.stop(now + length + 0.05);
    }
  }

  /** A few bells spread over time. */
  chord(semitones: readonly number[], volume = 0.35, spread = 0.09): void {
    const ctx = this.context;
    if (!ctx) {
      return;
    }
    semitones.forEach((note, index) => {
      window.setTimeout(() => this.bell(note, volume), index * spread * 1000);
    });
  }

  /** A short soft tick for hover and dwell feedback. */
  tick(volume = 0.15): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.muted) {
      return;
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** A very quiet two-note pad that runs under the whole session. */
  startDrone(): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.drone) {
      return;
    }
    const now = ctx.currentTime;
    this.drone = ctx.createGain();
    this.drone.gain.setValueAtTime(0, now);
    this.drone.gain.linearRampToValueAtTime(0.05, now + 6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    this.drone.connect(filter);
    filter.connect(this.master);
    for (const frequency of [110, 164.81, 220.7]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.05 + Math.random() * 0.06;
      depth.gain.value = 0.6;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      osc.connect(this.drone);
      osc.start(now);
      lfo.start(now);
    }
  }
}

/** One shared instance: the Enter button unlocks it, the session plays it. */
export const sound = new Sound();

/** A pentatonic scale in semitones above A3: calm, and never dissonant. */
export const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22] as const;
