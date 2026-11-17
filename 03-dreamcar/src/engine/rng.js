// Seeded random numbers. Everything that scatters, jitters or chooses in the
// assets and in the run draws from here (never Math.random), so that a given
// seed always builds the same world and the same sequence of events: pictures
// and tests are repeatable.

/** Turns a string into a 32-bit number (FNV-1a), for naming sub-streams. */
function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @typedef {object} Rng
 * @property {() => number} next uniform in [0, 1)
 * @property {(lo: number, hi: number) => number} range uniform in [lo, hi)
 * @property {(n: number) => number} int integer in [0, n)
 * @property {() => number} sign -1 or +1
 * @property {() => number} gauss normal distribution, mean 0, deviation 1
 * @property {<T>(list: T[]) => T} pick one element of a list
 * @property {(name: string) => Rng} fork an independent stream named `name`
 * @property {number} seed the seed this stream was made from
 */

/**
 * A mulberry32 generator with a few conveniences.
 *
 * `fork(name)` gives a stream that depends only on this stream's seed and the
 * name, not on how many numbers have been drawn so far. Each part of the
 * world takes its own fork, so adding one more tree to the forest does not
 * move the guide posts.
 *
 * @param {number} [seed]
 * @returns {Rng}
 */
export function createRng(seed = 1) {
  const start = seed >>> 0;
  let a = start;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: start,
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss: () => {
      // Box-Muller; the "1 -" keeps the logarithm away from zero
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick: (list) => list[Math.floor(next() * list.length)],
    fork: (name) => createRng((Math.imul(start ^ 0x9e3779b9, 0x85ebca6b) ^ hashString(String(name))) >>> 0),
  };
}
