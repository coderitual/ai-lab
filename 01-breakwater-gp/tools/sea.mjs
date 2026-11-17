// The sea in numbers: what docs/spec.md quotes about it, measured from the source.
// Node only (no browser):   node tools/sea.mjs [--phone]
//
// It makes the same tables the game makes when it loads (engine/ocean.js from the settings in
// engine/waves.js) and reads them through sampleSurface(), the function the boats use.

const phone = process.argv.includes('--phone');
globalThis.matchMedia = () => ({ matches: phone });

const { makeOcean } = await import('../src/engine/ocean.js');
const W = await import('../src/engine/waves.js');
const { SEA, sea } = W;
const DEG = Math.PI / 180;
const f = (v, d = 2) => v.toFixed(d);

// ---- the tables
let t0 = performance.now();
const ocean = makeOcean({ height: SEA.height, peakLength: SEA.peakLength, sharpness: SEA.sharpness, tail: SEA.tail, dir: SEA.dir * DEG, seed: SEA.seed, cascades: SEA.cascades });
const buildMs = performance.now() - t0;
console.log(`sea for a ${phone ? 'phone' : 'desktop'}: asked for ${SEA.height} m significant height, most energy at ${SEA.peakLength} m, choppiness ${SEA.chop}`);
let kept = 0;
let card = 0;
ocean.cascades.forEach((c, i) => {
  const s = SEA.cascades[i];
  card += c.disp.length * 2 * 2; // two tables of half floats
  if (s.physics) kept += c.disp.byteLength;
  console.log(
    `  table ${i}: ${c.size} m tile, ${c.n} x ${c.n} points (${f(c.size / c.n)} m apart), ${c.period} s in ${c.frames} frames, waves of ${s.band[0]} to ${s.band[1]} m,` +
      ` significant height ${f(4 * Math.sqrt(c.variance))} m, ${s.physics ? 'ridden and drawn' : 'drawn only'}`,
  );
});
console.log(`  made in ${f(buildMs, 0)} ms here; ${f(kept / 1e6, 1)} MB kept for the physics, ${f(card / 1e6, 1)} MB on the graphics card`);

// ---- how much of the surface is folding over (Jacobian below 0), from the tables
{
  let folded = 0;
  let count = 0;
  const [a, b, c] = ocean.cascades;
  for (let s = 0; s < 200000; s++) {
    // (the tables are independent of one another, so any point of each will do)
    const ia = ((s * 7919) >>> 0) % (a.frames * a.n * a.n);
    const ib = ((s * 104729) >>> 0) % (b.frames * b.n * b.n);
    const ic = ((s * 1299709) >>> 0) % (c.frames * c.n * c.n);
    const squeeze = a.deriv[ia * 4 + 2] + b.deriv[ib * 4 + 2] + c.deriv[ic * 4 + 2];
    const fold = a.deriv[ia * 4 + 3] + b.deriv[ib * 4 + 3] + c.deriv[ic * 4 + 3];
    if (1 - SEA.chop * squeeze + SEA.chop * SEA.chop * fold < 0) folded++;
    count++;
  }
  console.log(`  ${f((100 * folded) / count, 1)}% of the open sea's surface is folded over at any moment (where the whitest foam is)`);
}

// ---- what a boat meets: floats at sixteen places for two minutes each, in the open and in the lee
const o = W.makeSurfaceSample();
function record(name, x0, z0) {
  const dt = 0.1;
  const n = 1280;
  const places = 16;
  const y = new Float64Array(n);
  const heights = [];
  const local = [];
  let lo = 1e9;
  let hi = -1e9;
  let slope = 0;
  let vy = 0;
  let shift = 0;
  let sqAll = 0;
  for (let p = 0; p < places; p++) {
    const x = x0 + p * 97.3;
    const z = z0 - p * 61.7;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      W.sampleSurface(x, z, p * 211 + i * dt, o);
      y[i] = o.y;
      sum += o.y;
      sq += o.y * o.y;
      lo = Math.min(lo, o.y);
      hi = Math.max(hi, o.y);
      slope = Math.max(slope, Math.hypot(o.nx, o.nz) / o.ny);
      vy = Math.max(vy, Math.abs(o.vy));
      shift = Math.max(shift, Math.hypot(o.px - x, o.pz - z));
    }
    const mean = sum / n;
    local.push(4 * Math.sqrt(sq / n - mean * mean));
    sqAll += sq / n - mean * mean;
    // waves, counted from each upward crossing of the mean level to the next
    let last = -1;
    let top = -1e9;
    let bottom = 1e9;
    for (let i = 1; i < n; i++) {
      top = Math.max(top, y[i]);
      bottom = Math.min(bottom, y[i]);
      if (y[i - 1] < mean && y[i] >= mean) {
        if (last >= 0) heights.push(top - bottom);
        last = i;
        top = -1e9;
        bottom = 1e9;
      }
    }
  }
  heights.sort((p, q) => q - p);
  local.sort((p, q) => p - q);
  const third = heights.slice(0, Math.max(1, Math.round(heights.length / 3)));
  const avg = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  console.log(
    `  ${name} (amplitude ${f(W.waveAmpField(x0, z0))}): significant height ${f(4 * Math.sqrt(sqAll / places))} m (from ${f(local[0])} to ${f(local[places - 1])} m, place to place);` +
      ` waves ${f(avg(heights))} m trough to crest on average, ${f(avg(third))} m for the highest third, ${f(heights[0])} m the biggest; one every ${f((places * n * dt) / heights.length, 1)} s;` +
      ` surface between ${f(lo)} and ${f(hi)} m; steepest slope ${f(slope)}, fastest rise ${f(vy)} m/s, water moved sideways up to ${f(shift)} m`,
  );
}
sea.islands = [];
console.log('floats at sixteen places, two minutes each:');
record('open sea', -sea.shelterDirX * 2600, -sea.shelterDirZ * 2600);
record('the lee  ', sea.shelterDirX * 2600, sea.shelterDirZ * 2600);

// ---- the same sea again: after the tables' common period, and one common tile further on
{
  const gcd = (a, b) => (b < 1e-9 ? a : gcd(b, a % b));
  const lcm = (a, b) => (a * b) / gcd(a, b);
  const phys = SEA.cascades.filter((c) => c.physics);
  const period = phys.map((c) => c.period).reduce(lcm);
  const tile = phys.map((c) => c.size).reduce(lcm);
  const x = -sea.shelterDirX * 900;
  const z = -sea.shelterDirZ * 900;
  let worstT = 0;
  let worstX = 0;
  for (let i = 0; i < 200; i++) {
    const a = W.waterHeight(x + i * 3.7, z - i * 2.3, 5 + i * 0.31);
    worstT = Math.max(worstT, Math.abs(a - W.waterHeight(x + i * 3.7, z - i * 2.3, 5 + i * 0.31 + period)));
    worstX = Math.max(worstX, Math.abs(a - W.waterHeight(x + i * 3.7 - tile, z - i * 2.3, 5 + i * 0.31)));
  }
  console.log(`what the boats ride repeats every ${period} s (difference ${worstT.toExponential(1)} m) and every ${tile} m (difference ${worstX.toExponential(1)} m)`);
}

// ---- cost of asking
{
  t0 = performance.now();
  const n = 200000;
  for (let i = 0; i < n; i++) W.sampleSurface(600 + (i % 977) * 0.9, 500 + (i % 613) * 1.1, i * 0.001, o);
  console.log(`sampleSurface: ${f(((performance.now() - t0) / n) * 1000)} microseconds a call here`);
}
