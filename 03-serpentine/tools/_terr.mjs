import * as THREE from '/home/user/wt/world/03-serpentine/node_modules/three/build/three.module.js';
import { createTrack } from '/home/user/wt/world/03-serpentine/src/game/track.js';
import { createRng } from '/home/user/wt/world/03-serpentine/src/engine/rng.js';
import { createTerrain } from '/home/user/wt/world/03-serpentine/src/assets/world/terrain.js';
import { TIMES } from '/home/user/wt/world/03-serpentine/src/assets/world/lighting.js';
const track = createTrack();
for (const tier of ['low','high']) {
const t = createTerrain({ track, tier, rng: createRng(1).fork('terrain'), material: new THREE.MeshBasicMaterial(), lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir } });
console.log(tier, t.stats);
}
const t = createTerrain({ track, tier:'medium', rng: createRng(1).fork('terrain'), material: new THREE.MeshBasicMaterial(), lights: { day: TIMES.day.sun.dir, night: TIMES.night.sun.dir } });
// check: band/terrain heights vs road at edge; sample heights
const p = {}; const v = new THREE.Vector3();
let worst = 0;
for (let s = 0; s < track.length; s += 7) for (const side of [1,-1]) { const e = track.edgeAt(s, side); track.pointAt(s, side*e*0.99, v); const h = t.heightAt(v.x, v.z); worst = Math.max(worst, Math.abs(h - v.y)); }
console.log('max |heightAt - surface| inside corridor', worst.toFixed(3));
for (const [x,z] of [[200,500],[150,-200],[600,600],[-400,400],[2000,2000],[300,1200]]) console.log(x,z,t.heightAt(x,z).toFixed(1), t.forestAt(x,z).toFixed(2));
{ let worst = 0, at = 0;
for (let s = 0; s < track.length; s += 3) { if (track.tunnels.some(q => s > q.s0 - 5 && s < q.s1 + 5) || track.bridges.some(q => s > q.s0 - 5 && s < q.s1 + 5)) continue;
 for (const side of [1,-1]) { const e = track.edgeAt(s, side); track.pointAt(s, side*e*0.99, v); const h = t.heightAt(v.x, v.z); if (Math.abs(h - v.y) > worst) { worst = Math.abs(h - v.y); at = s; } } }
console.log('open road: max |heightAt - surface| inside corridor', worst.toFixed(3), 'at s', at); }
