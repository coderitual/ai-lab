// Shared by capture.cjs and soundtest.cjs: record the game's sound without
// speakers and without real time.
//
// Under software WebGL a frame takes far longer to draw than to play, so the
// sound cannot be recorded as it is heard. Instead the page is handed an
// OfflineAudioContext whose clock is the game clock. The game's audio code runs
// unchanged and schedules every change at the game time it happens; the whole
// timeline is rendered in one go at the end.

const fs = require('fs');

const SAMPLE_RATE = 48000;

// Runs in the page before the game: the audio context the game will be given.
const shim = (seconds) => `(() => {
  const cap = (window.__audioCapture = { ctx: null, t0: null, seconds: ${seconds} });
  function CaptureContext() {
    const real = new OfflineAudioContext(2, Math.ceil(cap.seconds * ${SAMPLE_RATE}), ${SAMPLE_RATE});
    cap.ctx = real;
    return new Proxy(real, {
      get(target, prop) {
        // the game clock stands in for the audio clock; nothing sounds before the capture starts
        if (prop === 'currentTime') {
          const game = window.__bw && window.__bw.game;
          return cap.t0 === null || !game ? 0 : Math.max(0, game.engine.simTime - cap.t0);
        }
        if (prop === 'state') return cap.t0 === null ? 'suspended' : 'running';
        if (prop === 'resume') return () => Promise.resolve();
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  window.AudioContext = CaptureContext;
  window.webkitAudioContext = CaptureContext;
})()`;

// Runs in the page at the end: render the timeline, hand back 16-bit stereo PCM.
const RENDER = `(async () => {
  const cap = window.__audioCapture;
  if (!cap.ctx) return null;
  const buf = await cap.ctx.startRendering();
  const n = buf.length;
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const pcm = new Int16Array(n * 2);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    pcm[2 * i] = Math.round(Math.max(-1, Math.min(1, L[i])) * 32767);
    pcm[2 * i + 1] = Math.round(Math.max(-1, Math.min(1, R[i])) * 32767);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { frames: n, peak, data: btoa(bin) };
})()`;

/** Before the page loads: give it the capturing audio context, `seconds` long. */
async function install(context, seconds) {
  await context.addInitScript(shim(seconds));
}

/**
 * Once the game is up: open its audio (what the Start tap does for a person)
 * and start the tape. Sound heard at time t belongs to the game state at t.
 */
async function start(page) {
  await page.evaluate(`(() => {
    const g = window.__bw.game;
    g.audio.unlock();
    window.__audioCapture.t0 = g.engine.simTime;
  })()`);
}

/**
 * Render what was scheduled.
 * @returns {Promise<{ rate: number, seconds: number, peak: number, pcm: Buffer, left: Float32Array, right: Float32Array }>}
 *   `peak` is the largest sample before clamping (above 1 would have clipped)
 */
async function render(page) {
  const r = await page.evaluate(RENDER);
  if (!r) throw new Error('the game never opened its audio');
  const pcm = Buffer.from(r.data, 'base64');
  const ints = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const left = new Float32Array(r.frames);
  const right = new Float32Array(r.frames);
  for (let i = 0; i < r.frames; i++) {
    left[i] = ints[2 * i] / 32768;
    right[i] = ints[2 * i + 1] / 32768;
  }
  return { rate: SAMPLE_RATE, seconds: r.frames / SAMPLE_RATE, peak: r.peak, pcm, left, right };
}

function writeWav(file, pcm, rate = SAMPLE_RATE, channels = 2) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

module.exports = { SAMPLE_RATE, install, start, render, writeWav };
