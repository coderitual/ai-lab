// Generated sound: the air of a wood, water against a bank, and the small
// sounds the swan makes in the water. Nothing is recorded: it is filtered
// noise and a few short tones made with the Web Audio API.
//
// It is off until someone turns it on, and the audio context is only created
// then (browsers allow sound to start from a tap, not before).
//
//   bed      brown-ish noise through a low filter: air moving in trees;
//            a thin band higher up that swells and fades: leaves
//   lapping  a narrow band of noise that rises and falls every few seconds
//   plink    each drop that lands (ctx.events 'drop'): a short tone falling
//            in pitch, higher for small drops
//   bloop    the bill going into and coming out of the water

/**
 * @param {object} ctx the shared context (see World.js)
 * @returns {{ enabled: boolean, setEnabled: (on: boolean) => void, update: (dt: number, time: number) => void, dispose: () => void }}
 */
export function createAmbience(ctx) {
  const rng = ctx.rng.fork('ambience');
  let audio = null; // AudioContext
  let master = null;
  let leaves = null;
  let lap = null;
  let noise = null; // AudioBuffer shared by every noise source
  let enabled = false;
  let voices = 0; // plinks sounding right now
  let phase = 0;
  const offs = [];

  function build() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    audio = new Ctor();
    master = audio.createGain();
    master.gain.value = 0;
    master.connect(audio.destination);

    // four seconds of noise, made once; long enough that the ear does not catch the loop
    const length = audio.sampleRate * 4;
    noise = audio.createBuffer(1, length, audio.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // white noise leaked through an integrator: more low than high, as wind is
      last = (last + 0.04 * (rng.float() * 2 - 1)) / 1.04;
      data[i] = last * 6;
    }
    // (make the ends meet, so the loop does not click)
    for (let i = 0; i < 2000; i++) {
      const k = i / 2000;
      data[length - 2000 + i] = data[length - 2000 + i] * (1 - k) + data[i] * k;
    }

    const loop = (filterType, frequency, q, gain) => {
      const src = audio.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = audio.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const g = audio.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(master);
      src.start(0, rng.range(0, 3.5));
      return g;
    };
    loop('lowpass', 420, 0.3, 0.5); // air
    leaves = loop('bandpass', 3200, 0.8, 0.0);
    lap = loop('bandpass', 620, 3.5, 0.0);
    return true;
  }

  /** A short tone that falls in pitch: a drop meeting the water. */
  function plink(size) {
    if (!enabled || !audio || voices >= 10) return;
    voices++;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    // small drops are higher; a little spread so that a shower is not one note
    const f = (2600 - 130000 * size) * rng.range(0.85, 1.2);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.max(500, f), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(260, f * 0.5), now + 0.07);
    const level = Math.min(0.11, 4 * size + 0.012);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, now + 0.14);
    osc.connect(g).connect(master);
    osc.start(now);
    osc.stop(now + 0.16);
    osc.onended = () => {
      voices--;
      g.disconnect();
    };
  }

  /** A soft low burst: the bill and the water. */
  function bloop(level) {
    if (!enabled || !audio) return;
    const now = audio.currentTime;
    const src = audio.createBufferSource();
    src.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.18);
    filter.Q.value = 2.2;
    const g = audio.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.3);
    src.connect(filter).connect(g).connect(master);
    src.start(now, rng.range(0, 3));
    src.stop(now + 0.32);
    src.onended = () => g.disconnect();
  }

  /**
   * Have the context running exactly when there is something to hear and
   * the page is showing. Anything but 'running' is resumed, not only
   * 'suspended': Safari has a third state, 'interrupted' (a call, Siri, the
   * lock screen, another app), which nothing but resume() ends. A resume the
   * browser refuses (iOS may want a touch first) is tried again on the next
   * press, below.
   */
  function wake() {
    if (!audio || audio.state === 'closed') return;
    let settle = null;
    if (enabled && !document.hidden) {
      if (audio.state !== 'running') settle = audio.resume();
    } else if (document.hidden && audio.state === 'running') {
      // (switched off with the page showing, it is suspended after its fade-out: setEnabled)
      settle = audio.suspend();
    }
    if (settle && settle.catch) settle.catch(() => {});
  }
  // a hidden page should be silent at once, and not go on computing noise
  document.addEventListener('visibilitychange', wake);
  offs.push(() => document.removeEventListener('visibilitychange', wake));
  // (capture: the controls stop their presses from reaching anything behind them)
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
  offs.push(() => window.removeEventListener('pointerdown', wake, { capture: true }));

  offs.push(ctx.events.on('drop', (e) => plink(e.size)));
  offs.push(ctx.events.on('billEnter', () => bloop(0.5)));
  offs.push(ctx.events.on('billExit', () => bloop(0.3)));

  return {
    get enabled() {
      return enabled;
    },
    /** Turn the sound on or off. Must first be called from a tap or a key for the browser to allow it. */
    setEnabled(on) {
      if (on && !audio && !build()) return;
      enabled = !!on && !!audio;
      if (!audio) return;
      wake();
      const now = audio.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(enabled ? 0.55 : 0, now, enabled ? 0.6 : 0.12);
      // nothing to hear, nothing to compute
      if (!enabled) setTimeout(() => !enabled && audio && audio.state === 'running' && audio.suspend(), 700);
    },
    update(dt) {
      if (!enabled || !audio) return;
      // slow, unequal swells: the leaves every twenty seconds or so, the water every five
      phase += dt;
      const now = audio.currentTime;
      const gust = 0.5 + 0.5 * Math.sin(phase * 0.31) * Math.sin(phase * 0.113 + 1);
      leaves.gain.setTargetAtTime(0.035 * gust * gust, now, 0.5);
      const wash = Math.max(0, Math.sin(phase * 1.26) * 0.6 + Math.sin(phase * 0.47 + 2) * 0.4);
      lap.gain.setTargetAtTime(0.06 * wash, now, 0.25);
    },
    dispose() {
      for (const off of offs) off();
      enabled = false;
      if (audio) audio.close();
      audio = null;
    },
  };
}
