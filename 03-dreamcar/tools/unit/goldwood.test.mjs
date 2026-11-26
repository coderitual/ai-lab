// The golden wood (src/assets/world/goldwood.js) is a stretch of the Track and what stands beside it: it moves no
// ground and puts nothing inside a solid edge.
//
//   node tools/unit/goldwood.test.mjs        (or: node tools/unit.mjs goldwood)
//
// 1. It is the stretch GOLDWOOD says, clear of the tunnel's meadow (approach.js) and of every structure.
// 2. Its rows begin where trees may (2 m behind the solid edge) and its numbers are sane: shares add up, the
//    rows stand one behind the other, every tree's foliage begins at the ground.

import { LAYOUT } from '../../src/game/trackLayout.js';
import { createTrack } from '../../src/game/track.js';
import { GOLDWOOD, goldwoodOf } from '../../src/assets/world/goldwood.js';
import { APPROACH } from '../../src/assets/world/approach.js';

let failures = 0;
function test(name, fn) {
  const before = failures;
  let said = '';
  try {
    said = fn() ?? '';
  } catch (error) {
    failures++;
    console.log(`      threw: ${error.stack ?? error}`);
  }
  console.log(`${failures === before ? '  ok  ' : 'FAILED'}  ${name}${said ? `: ${said}` : ''}`);
}
const fail = (text) => {
  failures++;
  console.log(`      ${text}`);
};

const track = createTrack(LAYOUT);

test('the golden wood is a stretch of the esses and ends before the tunnel\'s meadow opens', () => {
  const wood = goldwoodOf(track);
  if (!wood) {
    fail('no golden wood on the Track');
    return '';
  }
  const a = track.wrap(wood.s0 + GOLDWOOD.from);
  const b = track.wrap(wood.s0 + GOLDWOOD.to + GOLDWOOD.ease);
  const face = track.tunnels[0].s0;
  if (track.delta(b, face) < APPROACH.open) fail(`it ends ${track.delta(b, face).toFixed(0)} m before the tunnel's face, inside the meadow (${APPROACH.open} m)`);
  if (wood.stretch(a + 40) !== 1 || wood.stretch(track.wrap(b + 1)) !== 0 || wood.stretch(0) !== 0) fail('its stretch is not what GOLDWOOD says');
  // no bridge, no tunnel in it
  for (let s = a; s < b; s += 5) {
    if ([...track.tunnels, ...track.bridges].some((r) => track.delta(r.s0, s) > 0 && track.delta(r.s1, s) < 0)) fail(`a structure at s = ${s.toFixed(0)}`);
  }
  return `s = ${a.toFixed(0)} to ${b.toFixed(0)} m, ${track.delta(b, face).toFixed(0)} m before the tunnel's face`;
});


test('its rows stand one behind the other and its shares add up', () => {
  const G = GOLDWOOD;
  let last = -1;
  for (const row of G.rows) {
    if (row.off[0] < 0) fail('a row begins inside the strip that stays free behind the barrier');
    if (row.off[0] <= last) fail('two rows overlap');
    last = row.off[1];
    if (row.height[0] * (1 - G.sink) < 4) fail('a row lower than 4 m over the ground');
    if (row.low <= 0 || row.low > 1) fail('a row with no trees on the low tier');
  }
  if (last + 2 > G.clear) fail(`the last row (${last} m) stands beyond where the lap's trees give way (${G.clear} m)`);
  const broad = G.mix.lime + G.mix.birch + G.mix.hornbeam;
  if (broad >= 1 || G.conifers[1] > 0.25) fail('the shares do not leave room for maples, or conifers are more than accents');
  if (G.sink < 0.15 || G.wide < 1.2) fail('trunks would show: the trees are not sunk and widened');
  return `${G.rows.length} rows from ${G.rows[0].off[0] + 2} to ${last + 2} m beyond the solid edge, ${Math.round((1 - broad) * 100)} % maple, ${Math.round(G.gold * 100)} % turned`;
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
