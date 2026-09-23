/**
 * Procedural Windows 98 Sound Synthesizer
 * Uses native WebAudio API with zero external audio dependencies.
 */

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Button click / window focus sound
   */
  playClick() {
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  }

  /**
   * Error / Warning Ding
   */
  playDing() {
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  /**
   * Standard Information Chord
   */
  playChord() {
    const ctx = this.getContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.03);

      gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + idx * 0.03);
      osc.stop(ctx.currentTime + 0.6);
    });
  }

  /**
   * Retro Windows 98 Boot Arpeggio
   */
  playStartup() {
    const ctx = this.getContext();
    if (!ctx) return;

    // Gb, Db, Eb, Ab, Db harmonic sequence
    const chords = [
      { freqs: [370.0, 554.37], time: 0, dur: 0.4 },
      { freqs: [277.18, 415.30, 622.25], time: 0.3, dur: 0.5 },
      { freqs: [311.13, 466.16, 739.99], time: 0.7, dur: 0.6 },
      { freqs: [415.30, 622.25, 830.61], time: 1.2, dur: 0.8 },
      { freqs: [277.18, 554.37, 830.61, 1108.73], time: 1.8, dur: 1.4 }
    ];

    chords.forEach(({ freqs, time, dur }) => {
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + time);

        gain.gain.setValueAtTime(0.08, ctx.currentTime + time);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + time);
        osc.stop(ctx.currentTime + time + dur);
      });
    });
  }
}

export const sound = new SoundSynthesizer();
export default sound;
