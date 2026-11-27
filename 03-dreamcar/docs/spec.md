# Dreamcar: spec

What the build does, in numbers. [design.md](design.md) says what it is meant
to be; this page says what it is. Every number here comes from the source or
from a tool run in this repository (`node tools/trackmap.mjs out.svg`,
`node tools/handling.mjs`, `node tools/unit.mjs`), and the place each one
lives is named, so that it can be checked. A number here that no longer
matches the source is a bug: change the source first, run the tool, then
change this page.

Measured on 2026-11-17 at the head of the rework.

## The circuit

Defined once: the pieces in `src/game/trackLayout.js`, turned into the
`Track` by `src/game/track.js`. Everything else (the physics, the world, the
cameras, the HUD's map, the sound) asks the Track.

| | |
| --- | --- |
| length | 5136.1 m on the map, driven clockwise; sampled every 1.000 m (5136 samples) |
| start | the line at the world's origin, driven towards +X along z = 0; the lake on the left (z < 0), the land on the right |
| paved width | 12 m (`HALF_WIDTH` 6) |
| strip beyond each edge | 1.2 m (`SHOULDER`) in the pavement's banked plane: a kerb where the Track puts one, a paved margin elsewhere |
| verge to the barrier | 1.5 m (tunnel walls, parapets) to 9.95 m (run-off); grass, wandering inside each side's range (`SIDES`), moving at most 0.12 m per metre |
| height | 0 to 108.2 m above the line, top at s = 3111 m; the lake 1.8 m under the line |
| gradient | -8.0 to +6.0 per cent |
| tightest radius | 55 m (the carousel); 11 bends |
| banking | by rule 9° x tanh(250 m / R), or the piece's own; at most 10° (the sky road) |
| crest | vertical radius 453 m at s = 3132 m; the compression 1116 m at s = 3333 m; everywhere else at least 1207 m |
| closest approach of two stretches | 85.6 m apart (63.2 m between barriers, 22.9 m of height): the climb and the crest beside the carousel |

### Sections

`s` in metres from the line. The straight runs through the line. Speeds are
the autopilot's at full pace (pace 1.0) on a flying lap, from the TRACK lane's
run of `tools/handling.mjs`.

| id | name | s | pieces | km/h |
| --- | --- | --- | --- | --- |
| `straight` | Lakeside straight | 4686 to 250 (700 m) | finish 340 m, pitIn 110 m, the line, grid 40 m, gridRun 210 m; level | 225 to 279 |
| `sweep` | Shore bend | 250 to 657 | right R 220 through 80°, banked 9°; 100 m straight climbing to 5 % | 196 to 225 |
| `esses` | Forest esses | 657 to 1409 | right R 260 55° (bank 8°), left R 330 40° (7°), right R 240 65° (9°); 4 to 5.5 % | 204 to 240 |
| `tunnel` | The tunnel | 1409 to 2006 | a meadow with low walls at the edge for 70 m (no cutting: "The approach to the tunnel" below); the box 1479 to 1828 (349 m, right R 1000 through 20°); cutting 178 m (`cutting`: 5 m deep; its first 110 m between retaining walls with acoustic screens) | 216 to 255 |
| `viaduct` | The sky road | 2006 to 2582 (576 m) | on piers: left R 300 through 110°, banked 10°, ground 42 m under the middle | 229 to 257 |
| `carousel` | The carousel | 2582 to 2915 | 150 m climb at 6 %, then right R 55 through 190°, banked 8° | 90 to 229 |
| `crest` | The crest | 2915 to 3115 | 200 m straight over the top | 108 to 161 |
| `plunge` | The plunge | 3115 to 3394 | right R 400 through 40°, banked 5°, 8 % down into the compression | 161 to 215 |
| `ledge` | The ledge | 3394 to 3778 | left R 300 50° (bank 7°; low walls both sides, the valley open inside, a wooded bank outside), right R 350 20° (6°, rock on the inside) | 216 to 257 |
| `gully` | Gully bridge | 3778 to 4115 (337 m) | straight on piers, ground 26 m under the middle, 8 % down | 257 to 282 |
| `sweepback` | The long right | 4115 to 4686 | 100 m straight, then right R 300 through 90°, banked 9° | 234 to 283 |

Joints between pieces ease the curvature (and the banking) over 45 to 140 m
(`ease` per piece). The straight is straight and level for 621 m, 407 m of it
before the line.

### What stands beside it

All of it is Track data (`track.kerbs`, `tyreWalls`, `boards`,
`distanceBoards`, `marshals`, `gantry`, `lamps`), printed by
`tools/trackmap.mjs`.

| | |
| --- | --- |
| barriers | steel rail by default; a low concrete wall the whole length of the straight on the lake side, and on the land side along the pits (the 110 m before the line and the 40 m after it); a rail on the rest of the land side, with open mown paddock behind it on the 340 m run-up to the line and the maples close behind it on the 210 m after the grid (`paddock`, `grove`); cut rock at the cuttings, the carousel and the ledge; the walkways' kerb faces in the tunnel and parapets on the bridges, 1.5 m beyond the pavement |
| structures | the tunnel's box 349 m, a 1 m walkway 0.22 m high behind each kerb face, walls 17 m apart, flat ceiling 6.4 m over the road (`TUNNEL`; tunnel.js); a sign gantry 185 m before it; at its entrance a headwall 10 m high and 40 m long with a hood 2.6 m deep (entrance.js), low walls 0.8 m high on the solid edges for 68 m before it; two bridges on piers, 913 m in all: `viaduct` 2006 to 2582 (drop 42 m), `gully` 3778 to 4115 (drop 26 m) |
| kerbs | 15 runs, 3855 m in all, 1.2 m wide, flush at the road and rising 4 cm to the outside with a 0.9 m saw-tooth, ramped over 4 m at each end (`KERB`); on the inside of every bend under 800 m radius and the outside of the exits of those under 500 m; surface `KERB`, grip 0.9 |
| tyre walls | 8 runs, on the outside of the fast bends |
| trackside boards | 11 runs, both walls of the straight included |
| distance boards | 300 m and 200 m (on the sky road's parapet) and 100 m before the carousel |
| marshal posts | 12 |
| start gantry | across the road 8 m beyond the line, feet about 11.5 m left and 12.4 m right of the centre line |
| street lamps | 23, 9 m high, every 30.4 m on alternating sides along the whole straight |
| floodlights | 69, 12 m high, every 55 m round the rest of the lap (`lapLamps`): on the inside of bends tighter than 1500 m, alternating elsewhere; none in the tunnel or within 25 m of its portals, none on `ledge1` (frame D3's place); 2.5 m behind the edge where it is a rail (47 of them; a lamp due at a rock face goes to the other side if a rail is there), at the edge in rock cuttings (4) and at parapets (18) |
| tunnel lamps | 29 rows of two, every 12 m, 0.6 m in from the kerb faces and 0.3 m under the ceiling; gain 2.4 over the first 60 m, easing to 1 by 130 m, 1.4 over the last 36 m (`tunnelLamps`); fittings drawn along both haunches at 95 places each (two bars every 2 m over the first 60 m, one every 3 m to 130 m and over the last 36 m, every 6 m between: 250 bars) |
| sector lines | s = 1881.8 m (37 %, just out of the tunnel) and 3420.0 m (67 %, the start of the ledge); the third is the line |
| grid | 12 boxes behind the line (`track.grid`) |

The start area, the pit building, the stands, the town and the woods are
scenery beyond the barriers; design.md describes them.

**The lakeside** (`LAKESIDE` in `src/assets/world/lakeside.js`; design.md):
scenery too, beyond the edges of s = 2588 to 2758 m (6 to 176 m after the sky
road, easing in and out over 24 m).

| | |
| --- | --- |
| the tarn | 4.8 ha, an ellipse 300 by 224 m turned 15 degrees left of the road with bays, its middle 203 m along and 153 m left of the frame's origin (s = 2642 m), so that it begins 60 m past the end of the sky road; its surface 78.0 m above the line, 6.5 m under the road at s = 2582 and 13 m under it at s = 2732; up to 5 m deep; it mirrors the sky at 1.25 with ripples of 0.55, and its wooded shore within 18 to 70 m of its far banks |
| its bench | the rim 1.0 m over the water on the road's side and at its southern end, 6 to 14 m on the far sides, full height 55 m from the shore, falling to the valley in a straight ramp from 45 to 300 m from it (to 115 m at its southern end); the bank from the road begins 1 m beyond the solid edge and is all bench by 28 m (beside the deck: by 128 m) |
| the right-hand bank | the cut 1.3 to 2.6 m high (it was 9 m), then 0.13 rise per metre, giving way to the Track's hillside between 17 and 46 m beyond the edge |
| the pass | from 3 degrees (beyond 480 m: 12 degrees right) to 64 (gone by 82) degrees left of the road, 300 (full by 650) to 4300 (gone by 5000) m out: no ground over the eye's height less 4 m plus 3 % of the distance; a hill 44 m more straight ahead, 300 to 1000 m out, and a wooded headland 40 m more 9 to 21 degrees left, 430 to 1000 m out (raised where the land was lower); a range across it 3.3 km out, 430 m from foot to crest, 170 to 510 m over the pass's floor before the far land's 100 m lattice samples it, snow in streaks on all but its feet |
| trees | the lap's own cleared on the water, between the road and the shore and for 46 m on the right; planted: a stand three rows deep on the right-hand bank 6.5 to 24 m beyond the edge, a trunk every 4 to 7 m, 13 to 21 m tall, sunk 3.2 m, 1.3 times as wide, toned [0.44, 0.5, 0.52] (birch 20 to 35 % of each row); three bushy birch saplings behind the rail and groups of two or three more every 16 to 28 m, 3 to 7 m tall, in the stand's tone; a wood on the bench from 5 m back from the tarn's shore (55 % conifers); a wood on the hill ahead and the headland (80 % conifers); a wood on the spur 15 to 85 m beyond the right edge from 70 to 345 m after the sky road, 9 to 15 m tall, none standing more than 9 m over the returning leg within 70 m of it; no tree of the bank within 75 m of that leg if its top would stand more than 1.5 m over its road |
| ground cover | per tier (low / medium / high): long grass (the approach meadow's cards, `cover-meadow`, tinted [1.3, 1.02, 0.6]) 5 / 24 / 32 a metre of road on the lake's side, half in the band at the rail and half down the bank to 34 m, and 0.45 of that on the land's; none of the lap's own tufts on the stretch; flower patches 0 / 2.6 / 3.2 per metre drawn to 0 / 34 / 44 m, bushes 0 / 1.1 / 1.5 per metre, groups of outcrops 2.4 / 3.4 / 4 per 10 m; the meadow's paint in the ground's material over a box 270 by 72 m on the lake's side |
| the fence | posts every 2.6 m (low: 5.2 m), 1.05 to 1.25 m high, 2.2 m behind the cut's lip; three wires (low: one); a wooden post 1.2 to 1.3 m high behind the left-hand rail every 3.9 m (low: 7.8 m); one draw call |

**The golden wood** (`GOLDWOOD` in `src/assets/world/goldwood.js`; design.md):
scenery beyond the edges of s = 635 to 1257 m (22 m before the forest esses
begin to 600 m into them, easing in and out over 26 m; it ends 196 m before
the tunnel's face, where the approach's meadow opens). It moves no ground.

| | |
| --- | --- |
| trees | the lap's own cleared for 38 m beyond both solid edges; planted: five rows a side at 2.2 to 3.6, 5.6 to 8.4, 10.5 to 14.5, 17 to 23 and 26 to 35 m beyond the edge, a trunk every 3.4 to 8 m, grown 7.5 to 10.5, 10 to 14, 13 to 17, 15 to 20 and 17 to 22 m tall with 24 % of that under the ground and 1.38 times as wide, keeping their full form 1.05, 0.75, 0.5, 0.4 and 0.35 times the tier's distance; 34 % lime, 22 % birch, 19 % hornbeam, 25 % maple, 86 % of them turned, toned [0.33, 0.15, 0.2] (the maples [0.42, 0.42, 0.75], the birches [0.33, 0.125, 0.16]) over their own autumn colours: a deep orange gold, not the lap's lemon yellow; the rows behind the first darker by [0.95, 0.92, 0.95], [0.86, 0.8, 0.86], [0.8, 0.72, 0.8] and [0.76, 0.66, 0.76]; from the fourth row back 14 % are spruce or fir instead, 5 m taller, toned [0.5, 0.6, 0.7]; young birch, lime and maple in ones to threes every 3.2 to 5.6 m at the barrier, 2.2 to 3.6 m over the ground, a third of each under it, the birches among them toned [0.27, 0.1, 0.14] |
| the hillsides above | from 38 to 300 m beyond both edges, on a 5 m lattice (95 % planted, half as many on low): a tree wherever the ground stands more than 70 m over the lake or is steeper than 0.85 (to 2.6) and none stands within 3 m; half spruce and fir 13 to 20 m tall, half turned broadleaves 10 to 17 m tall toned [0.72, 0.62, 0.72] over the stand's tone |
| the sun's side | where the day's sun stands on a side (everywhere on the left of the stretch), no crown above the ray that reaches the road's centre line 0.5 m up: about 4 m at the barrier and 12 m at 30 m behind it on level ground; never under 3.4 m; no cap where the ground itself comes within 1.2 m of the ray; a crown the rule keeps low is toned [0.78, 0.62, 0.8] more |
| the ground | `aVerge.w` 0.4 to 0.49 on the band; the verge's grass [0.066, 0.036, 0.016], leaves [0.21, 0.085, 0.012], [0.2, 0.048, 0.009] and [0.08, 0.032, 0.01] (linear albedo), a drift 1.3 m wide along the paved margin; litter on the wood's floor to 12 m beyond the edge, gone by 26 m |
| ground cover | per tier (low / medium / high): long grass (`cover-meadow` cards tinted [0.3, 0.11, 0.045], 0.35 to 0.6 m tall) 0.4 / 1.9 / 2.6 a metre of road and side, seven in ten of them in the last metre and a half before the barrier and the first behind it; none of the lap's dark tufts; the lap's bushes tinted [4.2, 1.9, 0.6] |

**The arm of the lake** (`ARM` in `src/assets/world/arm.js`; design.md):
scenery beyond the left edge from the gully bridge to the start of the
straight, measured from s = 4115 m (the bridge's end) in a frame u along the
road's heading there and v to its left.

| | |
| --- | --- |
| the water | the lake's own level (1.8 m under the line) and the lake's own sheet; three lobes: the head 190 by 136 m, its middle 166 m along and 153 m left; the arm 520 by 156 m at 381 m along, 163 m left; the turn towards the lake 380 by 530 m at 731 m along, 8 m left, which joins the lake beside the straight; about 20 ha well inside the shore; up to 6 m deep |
| the ground | only ever lowered, on the left of the road beside s = 3785 to 4945 m (eased over 60 m), from 1.5 m beyond the solid edge (all of it from 52 m), within 240 m of the shore (all of it within 140 m): no higher than a beach of 0.11 per metre for 7 m and a bank of 0.36 per metre on the far shores, 0.1 per metre on the land between the water and the road (90 to 690 m along, up to 150 m left), with knolls of 3 m; 74 ha lowered round the water, by 105 m at most (the hill that closed the valley south of the long right) |
| the valley beyond | seen from the bridge (150 m before its end), between 20 degrees right (all of it from 10) and 54 degrees left (all of it to 40) of the road and from 900 m (all of it from 1400) to 5300 m (all of it to 4500), the land keeps 22 % of what it stood over 14 m |
| its spurs | four, each [root: degrees left of the road, metres out; tip: the same; crest at the root, m; half width at the root, m]: [46.6, 1240; 7.9, 1090; 175; 360] (down to the arm's shore), [-14, 2100; 2, 1350; 250; 400], [45, 2350; 5, 2450; 330; 470], [-16, 3250; 9, 2950; 380; 520]; crests fall to 6 % at the tip, 0.78 to 1.18 times that along the way; forest mask up to 1.7 (dark wood) |
| its range | across the valley 4050 m out (wandering by 170 m), 430 m from foot to crest, crests 230 to 590 m over the floor before the 100 m lattice samples them, between 26 degrees right (all of it from 12) and 60 left (all of it to 46); bare, snow on the upper part of each peak (from 30 % of its height, all of it by 92 %, at most 0.9) |
| fine ground | within 110 m of the shore (gone by 200 m) the terrain draws the arm's own heights: inside the grid's rectangle by not easing onto the far land there, beyond it on a patch of 14 m cells (low: 28 m), `terrain-arm`, one draw call; the lattice under it sunk 60 m |
| the open bank | on the left beside s = 4095 to 4495 m (eased over 30 m), to 330 m beyond the edge: no wood (the Track's `lowDown` and `lowRun` woods are cleared there); its grass painted per pixel between [0.032, 0.046, 0.022] and [0.105, 0.1, 0.036] from 9 m (all of it from 22 m) beyond the road's centre line on the water's side, 40 m before the bridge's end to 720 m after it and up to 190 m left of the frame's axis; pale stones from 6 m above the shore line to 3 m below it |
| trees | the lap's own cleared in the water, on its beach and on the open bank; planted: nine groups of four to seven birch saplings (a hornbeam in five) on the bank, 2.6 to 5.2 m over the ground, three tenths of each under it, 1.1 to 2 times as wide, toned [0.44, 0.5, 0.52]; a wood on the far shores from 5 m back from the water to 260 m (lattice 6.2 m, 85 % planted, six in ten conifers, toned [0.3, 0.4, 0.44]; the lap's own trees that stand there take the tone and none has turned), only where the forest draws trees at all (within 250 m of the course's bounds) and no nearer than 165 m to the road; on the right of the road from 200 m before the bridge's end to 330 m after it, spruce and fir 13 to 22 m tall on a 6.4 m lattice from 34 to 230 m beyond the edge, up to 175 m over the lake, toned [0.4, 0.5, 0.58] |
| ground cover | long grass (`cover-meadow`, tinted [1.15, 1.0, 0.7]) 3.5 / 16.8 / 22.4 a metre of road (low / medium / high) on the left of the open bank's stretch, 55 % of it within 1.6 m before and 3.8 m behind the barrier, the rest down the bank to 44 m; none of the lap's dark tufts there |
| the fence | posts every 2.6 m (low: 5.2 m) 3.2 m beyond the left solid edge from the bridge's end to 168 m after it, three wires (low: one); in the lakeside fence's one mesh |

## The car

### Dimensions

Defined once in `src/assets/car/spec.js`; read by the meshes, the physics, the
cameras and the lamps.

| | |
| --- | --- |
| length / body width / with mirrors / height | 4.793 / 1.820 / 2.033 / 1.438 m |
| wheelbase | 2.865 m |
| track front / rear | 1.590 / 1.579 m |
| overhang front / rear | 0.835 / 1.093 m |
| ground clearance | 0.13 m (sills at 0.19 m) |
| tyres | 225/40 R19 front, 255/35 R19 rear |
| mass | 1700 kg with a driver and half a tank, 53 % on the front axle, centre of mass 0.54 m up |

### The machine

`src/game/vehicle/params.js`: engine 640 N·m from 2500 to 4500 rpm, 365 kW
at 6300 rpm, idle 750, limiter 7000 rpm; a nine-speed automatic (ratios 5.35
to 0.60, final drive 3.07) with a torque converter and a mild limited-slip
differential; rear-wheel drive; drag area Cd·A 0.55 m², downforce Cl·A
0.7 m²; top speed held at 285 km/h by a limiter; steering lock 0.58 rad at
the road wheels; tyre friction 1.5 along and 1.52 across; ride frequency 1.3
/ 1.5 Hz front / rear, damping ratio 0.45.

### What it does

From `node tools/handling.mjs` (runs in about 6 s). The targets the rework
set (in brackets in the tool's output) are met.

| | |
| --- | --- |
| 0 to 100 km/h | 3.67 s |
| 0 to 200 km/h | 11.7 s |
| standing 400 m | 11.62 s at 200 km/h |
| up-shifts at full throttle | 50, 84, 122, 167 km/h (2nd to 5th) |
| top speed | 283.9 km/h in 8th (limited); 324.8 km/h without the limiter |
| 100 to 0 km/h | 27.7 m in 2.12 s (mean 1.42 g); locked, without ABS, 32.5 m |
| 200 to 0 km/h | 105.6 m in 3.98 s |
| steady cornering, 50 m circle | 1.26 g at 90 km/h; understeer 0.92° per g; roll 3.47° per g |
| key held through a long bend | 1.26 g at 110, 1.27 g at 140, 1.29 g at 200 km/h |
| step steer, 2° at 100 km/h | 0.62 g; yaw rate 90 % in 0.12 s, overshoot 0 % |
| tyres squeal from | 85 % of the most grip at 60 km/h, 89 % at 110 km/h |
| full key lock for 3 s, throttle held | 1.3° of slip at 150, 0.9° at 200, 1.5° at 250, 1.7° at 280 km/h: never spins |
| full throttle in 2nd at 0.65 g | assists on: 2.8° of slip; assists off: spins |
| rail touched at 10° / 100 km/h, 5° / 200, 8° / 250 | keeps 93 %, 96 %, 94 % of the speed, along the rail in 0.02 to 0.10 s |
| rail hit at 45°, 80 km/h | keeps 56 % |
| ride | 1.30 / 1.51 Hz, damping 0.47 (bump 0.35, rebound 0.58) |
| key steering lock | 33.2° at 20, 20.4° at 40, 7.2° at 100, 6.7° at 200 km/h |
| a key held at 80 km/h | 90 % of the yaw rate in 0.22 s, under 10 % 0.26 s after release |

Laps of the real road (flying laps, Node, no drawing):

| driver | lap | notes |
| --- | --- | --- |
| autopilot, pace 1.0 | 85.0 s (218 km/h mean) | 0 impacts, stability control 4.3 s a lap |
| autopilot, pace 0.9 (`?ap`) | 93.1 s | 0 impacts |
| autopilot, pace 0.7 | 117.4 s | 0 impacts |
| one thumb (full throttle unless braking) | 84.5 s | 0 impacts |
| pad (analog) | 85.0 s | 0 impacts |
| keys | 85.0 s | 0 impacts, stability control 6.8 s a lap |
| ham-fisted keys (flat out, full keys, slow hands) | 85.4 s | 0 impacts, body 0.14 m beyond the pavement at worst |

The one-thumb pad (`tools/unit/drift.test.mjs`, the scripted person of
`manoeuvres.humanDriver` with its thumb on the pad, through Input's
`padControls`: across and down together, 900 px/s, wavering 3 px, 0.15 s
late): a tidy lap 86.3 s against the scripted keys' 86.3 s (autopilot 85.0
s), 0 impacts, 9.2 s of braking a lap, 7.8 s of it while turning at 0.3 g or
more (trailing the brake in); the carousel sideways at Sport, thrown in with
the handbrake by the steering thumb's red arc: 3.4 s beyond 12° at 15° mean,
38° at most, no touches (by the HANDBRAKE button: the same 3.4 s, 33° at
most; both cost 1.4 s on the lap); at the default level the gesture kicks it
to 22° and the help catches it (+0.6 s). A clumsy thumb (600 px/s, 8 px of
waver, 0.2 s late) at the default level: 88.1 s, no impacts, no spin, the
body 1.46 m beyond the pavement at worst.

### Assists

Always on: ABS (`assists.abs`), traction control (`tc`) and stability control
(`esc`) in `src/game/vehicle/params.js`. Their lamps on the HUD light while
they work. With stability control the steady-state grip is the same (1.26 g
against 1.25 g without); what it changes is that power oversteer and a full
key lock at speed do not spin the car.

## The rules

`src/game/Race.js`, numbers in `RULES` (`src/game/config.js`).

- **Laps:** 3 (`?laps=` changes it).
- **The start:** one race clock, negative before go. 1.2 s of the camera's
  dive, then the five lamps light one every 0.7 s, then a hold drawn from
  `rng.fork('start')` between 0.5 and 1.5 s, then all out: go, clock 0. The
  cars are held until go. The gantry's green lamps light for 4 s after.
- **Sectors:** three per lap (two sector lines and the line). Only the next
  line is armed; it is taken only by a forward step of less than 30 m, so
  reversing over it or a put-back never takes one. The crossing is
  interpolated inside the 1/120 s step: lap times are whole milliseconds.
- **Gaps:** at each line the gap to the best lap (the first lap against the
  best lap from the grid, later ones against the best flying lap), shown for
  3 s; the lap's banner for 4 s; the live gap uses the best lap's time every
  10 m.
- **Medals** (flying laps, the same at every time of day): gold 1:27.600,
  silver 1:33.000, bronze 1:44.000. Gold is about 3 % slower than the
  autopilot at full pace, silver about its pace 0.9, bronze about 0.8.
- **The board:** the five best laps on this device, per time of day, with the
  best three-lap total, the best standing and the best flying lap; dropped if
  it was set on a road of another length. Laps with a put-back count for the
  run, not for the board.
- **The ghost** (solo only): the best lap's car, recorded at 10 Hz on the
  lap's own clock, two recordings per time of day (from the grid, flying).
  G shows and hides it.
- **Put back:** offered after 3 s stuck, 1.5 s on the roof or 4 s driving the
  wrong way (the warning shows after 1.2 s); on the roof for 4 s the car is
  put back unasked; at most 4.7 m from the centre line (`resetLat`).
- **Split screen:** two cars from the first two grid boxes; the run ends 30 s
  after the first car finishes. The autopilot (`?ap`) drives them 2.2 m
  either side of its line.
- **After the flag** the autopilot takes the car home at pace 0.6.
- **Attract lap:** with nobody at the controls for 25 s on the title, the
  autopilot drives a lap behind the menu.

## Controls

| | keyboard (solo) | split screen | gamepad (standard mapping) | touch |
| --- | --- | --- | --- | --- |
| drive / brake | W / S or ↑ / ↓ | W / S and ↑ / ↓ | right / left trigger | Steering Pad (default): the thumb's offset down from the pad's centre (where the thumb landed, fixed until it lifts): at or above the centre full power (Throttle auto, the default: with no thumb on the pad the car drives on too), the first 25 % of 56 px down lifts the throttle, the rest brakes, fully at 56 px; Throttle manual: up is the throttle (full at 56 px), the centre coasts, down brakes. Slider and Arrows: the pedals. Throttle auto: the car drives by itself and lifts while BRAKE or DRIFT is held; manual: only while GAS is held (88 px, in the corner). BRAKE: 80 px, in the corner on auto, left of GAS on manual (where that would shorten the slider below 70 px, as on an upright phone, BRAKE stands up and to the left of GAS, clear of it). Braking held at a standstill reverses |
| steer | A D or ← → | A D and ← → | left stick | Pad (default): a round pad (radius 0.21 × the view's shorter side, 50 to 80 px: 160 px across on a phone) that appears under the thumb. At rest it is a faint ghost (30 % opacity) at its home place, on the side of the holding hand (Hand: Right, the default, or Left; it decides only where the ghost and the HANDBRAKE button sit, both hands work everywhere): its centre radius + 25 px (scaled with the pad) from that side and 150 px above the bottom on an upright phone (0.176 × the view's height, 150 at most, the radius + 22 at least). A thumb landing anywhere in the view (in a split screen, in the half) that is not a HUD button or the HANDBRAKE button puts the pad's centre exactly at that point (an 80 ms scale-in); the centre stays there, fixed, until that thumb lifts (no trailing, no rebasing), so the first input is always zero; the steering is the offset across from the centre over 70 px, linear, clamped to full lock, no dead step. Room at the edges: the travel needed is 70 px (scaled) to the left and to the right edge of the safe area and 74 px (the handbrake's red) to its bottom edge; with less room than that the pad is still drawn at the thumb and that direction's travel is compressed to the room there is, but never under 60 % of the normal; with less room than 60 % of it the centre is nudged inward by what is missing (the disc is also drawn inside the safe area where it can) and the input is held at zero until the thumb has moved 6 px from where it landed. Let go, the knob springs back, the live pad stays 0.4 s and fades (0.2 s) while the ghost returns at the home place; the next touch places it afresh. Tilt: the device rolled like a wheel, ±30° from how it was held at the start (or at Recentre on the pause sheet) is full lock, upright or on its side (deviceorientation, asked for in the option's click and on the first touch; refused or absent, the pad steers and the options say so); the pad still brakes. Slider: a fixed track at the bottom left; the steering is the thumb's distance from its centre over the half travel (56 + 0.05 × the view's width px, 48 to 92 px). Arrows: two 76 px buttons, held as the A and D keys are. For the pad, tilt and the slider the curve and smoothing are the hands' (`HANDS.thumb`: power 1.15 standing, 1.45 at 216 km/h and above; a critically damped follow, two lags of 22 ms standing to 50 ms at speed). A second finger is the handbrake (below); it never takes the pad |
| handbrake | Space | Space, right Shift | A or RB | Pad: pulled on down past 74 px (scaled) into the red arc at the pad's foot, let go above 62 px; a second finger anywhere else in the view (not on a HUD button) while the pad's thumb is down, for as long as it is held (power lifts as for the button); and the round HANDBRAKE button (68 px) in the other bottom corner (above the pad where the view is too narrow), held, which stays as the visible target and works with or without a thumb on the pad. Slider and arrows: DRIFT (68 px), above the corner pedal (beside the pedals on a view lower than 330 px or narrower than 300 px), held. A short buzz (`navigator.vibrate(8)`, where there is one: not on iOS) when it is pulled and when a wheel strikes a kerb |
| camera | C | C, `.` | Y | button |
| look back | B (held) | B, `,` | X | |
| put back | R | R, `/` | B | button |
| high beam | H | H | | button |
| ghost | G | | | |
| time of day | N | N | Back / View | title |
| mute | M | M | | options |
| pause | P, Esc | P, Esc | Start | button |
| start, menus | Enter, Tab | | A, d-pad | tap |

Each driver reads whichever of their devices was used last. The touch
controls are drawn from `layoutOf` (the pad's home place, the ghost's; a placed pad stands where `controlsOf(i).placed` says) (`TOUCH` and `layoutOf` in
`src/engine/Input.js`; the HUD draws them from the same layout, so a finger
finds what it sees): 18 px from the edges inside the safe area (the notch and
the home bar), 12 px apart; the pad's knob 60 px (scaled with the pad), the
slider's 52 px, resting on that bottom margin. Each control keeps the finger that took it until that finger
lifts (sliding off a pedal keeps it; pulled past the pad's rim the knob stops
at the rim, or clicks into the red arc while the handbrake is pulled; let go,
it springs back to the centre in 0.16 s); a cancelled pointer, the window losing
focus, a hidden tab or a turned device lets every control go. With the slider, arrows or pedals a touch
anywhere else does nothing to the car; with the pad a touch anywhere places it. The HUD's own buttons (camera, lights, reset, pause) keep working and never place it. On
a view too narrow for the steering and the pedals side by side (half of an
upright phone) the pedals stand above the steering, in one column. On a tablet in split
screen each half of the screen is one driver's, with its own controls laid
out for the half (the pad shrinks to 50 px in a half of a phone). Every
control is drawn pressed in the same frame as the touch (Input's
onTouchChange), with a glow; 4 s into a run (`HUD.controlsDimAfter`) the
controls step back to 45 % opacity while no finger is on any of them. On the
first run on a touch screen the controls are outlined and the steering named
(the pad: STEER · BRAKE · DRIFT; the slider: STEER; the pedals carry their
words always) for the first 3 s of the race clock, then never again
(`dreamcar.zones.v1`); the first-run hint for the pad reads "Touch anywhere, slide to steer,
pull back to brake, pull to the red to drift". Every button can be reached by Tab and Enter, or a
pad's d-pad and A; the pedals and arrows are at least 64 px, the four small
buttons 44 px.

## Cameras

`src/game/Cameras.js`, numbers in `CAMERA` (`src/game/config.js`).

| | |
| --- | --- |
| in a slide | the camera keeps nearer the way the car is going (from 0.6 to 0.9 of the angle between heading and travel as `vehicle.drift` rises, taken up at 4 /s, let go at 1.5 /s), so the car is seen yawed and the road ahead stays in view; the lens opens up to 4° |
| chase (default) | 5.4 m behind the car's origin, dropping back 1.5 m more as the speed signal rises from 70 to 270 km/h (time constant 0.6 s); lens 58° to 72° top to bottom on 16:9; horizon 37 % and the car's middle 60 % of the way down; at least 22° of sky above the horizon on every shape of screen; rolls with 40 % of the banking; swings round at 3.4 /s; shake from 200 km/h, on kerbs and the verge, and on impacts |
| narrower than 4:3 | keeps 4:3's width of view, backs off up to 1.25x, horizon at 30 % |
| far chase | 9.5 m (+1.8), 54° to 66° |
| bonnet | on the bonnet, 62° to 74° |
| bumper | over the front plate, 66° to 78° |
| title | a three-quarter view 8.6 m out and 0.85 m up through a 34° lens, swinging 0.22 rad over 36 s; the view beside the brightest part of the sky; exposure raised by `SHOWCASE` (day +0.3, dusk +0.9, night +0.6 stops) |
| start | a dive from 16 m up, 34 m behind and 9 m to the side onto the car's tail, ending as the last lamp lights; shutter cut to 0.25; on the grid the chase camera sits 0.5 m lower looking 4° up, easing out over 1.6 s after go |
| results | an orbit 6.4 to 7.2 m out, 40° lens, framed clear of the panel |
| staging | `__dreamcar.photo({...})` or `?photo=`: see tools.md |

Motion blur: the shutter is 0.12 of a sixtieth of a second standing still and
0.9 at 70 m/s (252 km/h) and above; the streak is clamped per tier at 4, 7.5
or 9 % of the view's width (1.45 times that in the picture's corners); the
cars are held sharp.

## The HUD

`src/game/Hud.js`, `hud.css`, words in `text.js`. Per view, sized from one
unit per view:

- top left: lap n / N, the lap clock with the live gap, the best lap;
- top middle, for 3 s at each line: the gap, large (green ahead, amber
  behind);
- top right: the next time to beat (split screen: the place and the gap);
- bottom right: the speed in large figures (km/h or mph), a rev arc, the
  gear, the ABS / TC / ESC lamps (touch screens: see below);
- bottom left: a small map (can be hidden; touch screens: see below);
- just above the speed, only while the car slides 12° or more: the slide's angle and its running score (`vehicle.slide`; `Hud.setDrift`), fading out a second after the slide ends; the best slide of the run is on the results;
- beside the speed (on the cluster's open side: left of it, or right of it where the cluster is anchored at the left, as with the pad in the right hand, a low view and a tall one; absolute, so no layout moves for it): the pedal gauge (`Hud.setGauge`), for every device and in both halves of a split: two slim vertical bars, 1 unit wide and 7 tall (8 x 56 px at 8 px a unit, scaled with the HUD), the brake at the left (amber, red above 60 %) and the throttle at the right (green), both filling upward with what the car got (`vehicle.throttle` and `vehicle.brake`, after the pad's mapping, the auto throttle, the lift, the traction control and the limiter, so traction control shows as a flicker downward), eased in the fixed step by a 40 ms lag (`Game.update`; the picture only reads it), ticks at 50 % and 100 %, and a small dot between them that lights red while the handbrake is on; each bar is a `role="meter"` with an aria-label and `aria-valuenow` in per cent; no words;
- touch screens, the pad: the bottom corners are the thumbs' (the pad on the holding hand's side, the HANDBRAKE button on the other) and nothing else stands there. The speed above the HANDBRAKE button at 0.86 of its size (the slide readout above it), the map above the pad, both mirrored for the left hand; a narrow half of a split screen has no map; on an upright view the pad's top stays below 75 % of the height, under the car's tail (133 px up on a 393x852 phone rather than 150); a view lower than 330 px (a stacked half) or narrower than 300 px (half an upright phone): the speed at the top, as for the pedals. Placed by `--sticktop`, `--stickside`, `--handtop`, `--handside` from the layout (`Hud.setControls`);
- touch screens, the slider and the arrows: the steering left, the pedals right, and nothing else in those corners. A wide view: the speed just left of the pedals (110 px from the right on auto; on manual 108 px from the right and 110 px up, above BRAKE and left of DRIFT), the map 112 px up, above the steering; a narrow wide view (a side-by-side half on a phone): the speed 206 px up, above the pedals; a view lower than 330 px (a stacked half): the speed at the top beside the lap; an upright view: the speed 112 px up at the left, drawn at 0.86 of its size, the map above it; a view narrower than 300 px (half an upright phone): the speed under the lap, no map, DRIFT beside BRAKE;
- touch screens: four small buttons together (camera, high beam, put back,
  pause);
- the best-laps board on the title, the pause sheet and the results only.

DOM writes: 45.8 a second at 1280x720 solo while running (HUD lane's
measurement; `stats().hudWrites`).

## Options

On the title and the pause sheet: quality (auto, low, medium, high; applied
by reloading the page), sound on or off, time of day, driving help (Full,
Sport, Off: `ASSISTS` in config.js, applied at once to every car and to every
car made later), Steering (Pad, Slider, Arrows or Tilt; under it what the
choice does, or why tilt is not steering), Resting hand (Right or Left: where the pad's ghost and the HANDBRAKE button sit; with the pad
or tilt) and Throttle (auto or manual), shown on touch screens; Recentre tilt
on the pause sheet while tilt steers; units (km/h, mph), the map shown or hidden, the readout shown or hidden (off
until asked for; `?stats` shows it without the option). The readout is one
line of small type (9 px, less on a narrow screen so that it fits) at the
page's bottom edge, inside the home bar's strip on a phone, written three
times a second:

    medium 804×1748@2 ×0.85 msaa4 58/41fps off:probe,blur,detail apple gpu

the tier; the canvas in device pixels and its pixel ratio; the render scale;
how edges are smoothed (`msaa4`, `msaa2`, or `fxaa` where the scene has no
samples); the mean frame rate of the last 3 s and its slowest frame as a
rate; the ladder's rungs given up (`all on`: none; `testing`: the governor's
trial; `cap30` before it: the frame rate the browser holds, once found);
what the browser calls the GPU (`ldr` before it: the 8-bit fallback). A
screenshot with it on says what the phone was drawing.

## URL parameters

Read once by `src/engine/params.js`.

| | |
| --- | --- |
| `?time=day\|dusk\|night` | the time of day to open on (default: the first in `TIMES`, the day) |
| `?mode=split` | two players |
| `?laps=N` | laps per run |
| `?cam=chase\|far\|bonnet\|bumper` | the camera |
| `?q=low\|medium\|high` | the quality tier (wins over the stored choice) |
| `?dpr=` | the device pixel ratio (and no governor) |
| `?scale=` | the render scale: the share of the canvas's size the scene is drawn at (and no governor) |
| `?shed=N` | N rungs of the tier's ladder shed (and no governor) |
| `?upscale=0`, `?sharp=0..1` | the plain stretch instead of the sharpening upscale; its strength in place of the scale's own |
| `?maxdpr=`, `?floor=` | the pixel ratio's cap and the render scale's floor in place of the tier's, the governor left on (to try on a phone: `?maxdpr=3&floor=0.5&stats`) |
| `?mobile=1\|0` | take the device for a phone, or for a desk (the tiers' numbers for phones) |
| `?stats` | the performance readout (`?stats=0`: off whatever the option says) |
| `?plate=`, `?plate2=` | the number plates (capitals, digits, spaces, hyphens; 9 at most) |
| `?paint=` | the first car's paint: silver (default), graphite (the second car's), blue, red, white, black |
| `?wet=0..1` | the road's wetness instead of the time of day's |
| `?mute` | no sound |
| `?ui=0` | no HUD |
| `?auto` | start a run at once |
| `?ap` | the autopilot drives (pace 0.9) |
| `?manual` | the loop does not run: frames come from the page handle |
| `?t=N` | with `?manual`: run N seconds before the first frame |
| `?seed=N` | the run's random numbers |
| `?photo=back,right,up,yaw,pitch,fov[,hud]` | the staging camera |
| `?photo=d1`, `d3`, `d4`, `r1`, `r2`, `r3`, `r4` | named places of it (`PHOTOS` in config.js): the camera of a reference frame (d1 the run-up to the line by day, d3 the ledge's first bend by day, d4 the grid at golden hour, r1 the approach to the tunnel by day, r2 the lakeside after the sky road by day, r3 the golden wood in the esses by day, r4 the arm of the lake from the gully bridge by day) with its own moment of the autopilot's run and time of day, unless `?t=` or `?time=` give them |
| `?nodraw` | no drawing (tests) |
| `?post=0`, `?shadows=0`, `?probe=0`, `?fx=0` | leave out the frame's passes, the sun's shadows, the car's reflection probe, the effects |
| `?ldr` | the 8-bit fallback of the frame |
| `?debug=scene\|depth\|velocity\|bloom\|probe\|ao` | one buffer instead of the picture |
| `?ev=`, `?shutter=`, `?ao=`, `?bloom=`, `?contrast=`, ... | grade overrides (docs/engine.md, "Debugging") |

## Times of day

`TIMES` in `src/assets/world/lighting.js`, in order: day, dusk, night. The sun
and the moon are placed against the start straight's heading by
`placeLights`.

| | day | dusk (golden hour) | night |
| --- | --- | --- | --- |
| sun / moon | 3° right of the straight's heading, 16° up; intensity 7.5 | 125° left (over the lake, behind the driver's left shoulder), 2° up; colour [1, 0.56, 0.24], 2.8 | the moon 8° left, 17° up; 0.12 |
| exposure (tunnel) | 0.68 (5.6) | 4.2 (6) | 22 (5) |
| sky's light on the scene: environment / fill | 0.6 / 0.13 | 0.6 / 0.014 | 1 / 0.013 |
| sky at the zenith (radiance) | [0.22, 0.38, 0.78] | [0.02, 0.034, 0.068] | [0.0007, 0.0014, 0.0038] |
| wetness | 0 | 0 | 0.8 |
| street lamps and floodlights / tunnel / windows / cones in the air / the tunnel's entrance and exit zones | 0 / 1 / 0 / 0 / 1 | 1 / 1 / 0.7 / 0 / 0.5 | 1 / 1 / 1 / 1 / 0 |
| car lamps | running lights | low beam | low beam |
| clouds cover | 0.45 | 0.45 | 0.3 |
| bloom / glare / ghosts | 0.05 / 0.015 / 0.00015 | 0.09 / 0.03 / 0.0002 | 0.15 / 0 / 0 |
| contrast / saturation | 1.14 / 1.18 | 1.2 / 1.16 | 1.12 / 0.94 |

N, or the title's choice, fades to black and back (0.25 s each way) to switch.

## The picture

One render call per view into a multisampled half-float target, then the
passes of `src/engine/FramePipeline.js`; docs/engine.md lists them pass by
pass with their sizes. In short:

| | low | medium | high |
| --- | --- | --- | --- |
| pixel ratio cap | 1.5 | 2 | 2 |
| render scale floor (`TIERS.scaleFloor`) | 0.6 | 0.72 | 0.72 |
| drawn pixels per CSS point at the floor, on a 3x phone | 0.9 | 1.44 | 1.44 |
| the ladder, shed in this order before any resolution (`LADDER`) | probe, blur, detail | probe, blur, detail, ao, msaa | as medium |
| scene MSAA | none (FXAA on the finished picture) | 4 | 4 |
| motion blur | inside the last pass, 6 taps, streak ≤ 4 % | own pass, 12 taps, ≤ 7.5 % | 18 taps, ≤ 9 % |
| bloom levels | 4 | 5 | 6 |
| lens (flare source, ghosts, glare, star) | no | yes | yes |
| ambient occlusion | no | 8 samples, half size | 14 samples |
| car's probe at speed / standing | 64 / 128 per face, a face every 2nd frame (standing too) | 128 / 256; a face every 2nd frame (2 in the tunnel), standing 2 every 3rd | 256 / 512, 2 faces a frame (3 in the tunnel), standing 3; in the tunnel the faces see 160 m |
| wet road mirror | none (the six nearest lamps' heads drawn into the water analytically) | 0.35 of the view's height, to 220 m, streaked copy 0.3 of its height | 0.5, to 320 m, streak 0.3 |
| forest: full / reduced / impostor trees to | 0 / 60 / 650 m | 34 / 95 / 900 m | 50 / 130 / 1200 m |
| effects: skid quads / soft particles / sparks | 800 / 192 / 48 | 1500 / 320 / 96 | 2000 / 400 / 128 |

When frames run long the governor (`src/engine/governor.js`; engine.md, "The
quality ladder") sheds the tier's ladder one rung at a time, and only then
lowers the render scale (0.85, 0.72, on low also 0.6), never under the
floor; it steps back up when frames have been steady for a while. A browser
that caps the frame rate itself (Low Power Mode: 30 a second) makes it shed
nothing, after one trial of about a second. A scene drawn below the canvas's
size is brought to it by a sharpening upscale (engine.md), not stretched.
Before 2026-11-19 the render scale was the only thing shed and went to 0.5:
a 3x phone on medium ended at 1.0 drawn pixel per CSS point.

## Quality tiers and budgets

`auto` takes the capability probe's guess (`src/engine/caps.js`): software
WebGL and unknown phone GPUs start `low`; every iPhone and iPad (whatever
the browser says of its GPU, or hides), Adreno 640+ and Mali-G71+ phones
`medium`; Intel graphics other than Arc and Xe `medium`;
other desktop GPUs `high`. The choice is stored and applied by reloading.

Budgets set by the rework for a chase frame: low 150 draw calls and 250 k
triangles, medium 300 and 600 k, high 500 and 1.2 M.

Measured (picture lane, 2026-11-18): a whole chase frame at phone shape
(393x852 at device scale 2), autopilot run by day, the triangles of every pass
of the frame (scene, sun's shadow map, probe faces, and by night the wet
road's mirror) averaged over 6 frames, before and after the budget work
(chunked rails, posts, kerbs and glow; the probe's cadence and stand-in
massif; the glow's coarser grid; skid marks drawn only where laid):

| place (time in the run) | low before | low after | medium before | medium after | medium, night, after |
| --- | --- | --- | --- | --- | --- |
| grid (t = 0, standing) | 467 k | 253 k | 2.07 M | 861 k | 1.05 M |
| esses, before the tunnel (t = 33) | 479 k | 328 k | 1.83 M | 1.04 M | 1.31 M |
| sky road (t = 45) | 420 k | 254 k | 1.49 M | 666 k | 838 k |
| ledge bend (t = 79) | 480 k | 323 k | 1.73 M | 929 k | 1.17 M |

Draw calls after: low 168 to 230, medium 197 to 279 (by night 265 to 375).

Night, medium, the same four moments at 393x852 and device scale 1, before
and after the night lane (floodlights round the lap, their cones and the
mirror's halos and streaked copy; the rails, the contact shadows and the
spray left out of the mirror): 1.05 / 1.31 / 0.84 / 1.17 M triangles before,
1.02 / 1.27 / 0.81 / 1.12 M after (the mirror's own 167 to 245 k down to 130
to 200 k); draw calls 237 to 330 before, 273 to 371 after.
**Still over budget**: low by up to 30 %, medium by up to 75 %. What is left
on medium: the scene's own triangles, 420 to 780 k (the nearest trees at full
detail, up to 185 k among the conifers of the esses; the terrain 60 to 130 k;
the massif 92 k; the car 85 k with its wheels), the shadow map 140 to 190 k
(the car 58 k, the terrain 60 k), the probe 100 to 160 k, the mirror 170 to
245 k (the car again 85 k). How it was measured: `renderer.renderBufferDirect`
wrapped in the page, labelled by the pass being drawn (techniques.md, "What
each pass draws").

**Draw calls after the finish lane** (2026-11-18, the same four moments at
393x852 and device scale 1, one whole frame each, `stats().drawCalls` of
the last of six frames, so a frame that draws a probe face; counted with the
page's `renderer.renderBufferDirect` wrapped, as above):

| moment | low, day, before | low, day, after | medium, night, before | medium, night, after | medium, day, after |
| --- | --- | --- | --- | --- | --- |
| grid (t = 0) | 213 | 133 | 409 | 291 | 200 |
| esses (t = 33) | 220 | 140 | 392 | 267 | 187 |
| sky road (t = 45) | 194 | 138 | 305 | 228 | 173 |
| ledge bend (t = 79) | 257 | 149 | 418 | 273 | 192 |

Both inside their budgets (low 150, medium 300) at these moments; other
places on the lap were not counted. Triangles hardly moved (low 293 to
358 k, medium by night 0.97 to 1.30 M): still over the triangle budgets.
About a quarter of every pass's calls is the car (25 in the scene and in the
mirror, 14 in the shadow map), which this lane did not touch.

**Draw calls at the tunnel** (tunnel lane, 2026-11-18, the same counter, the
last of four frames, from t = 34.5 of the autopilot run: the approach 120 m
before the entrance, near the entrance, deep inside, at the exit), before and
after the box tunnel:

| t (place) | low, day, 393x852: calls, triangles before | after | medium, night, 1280x720: before | after |
| --- | --- | --- | --- | --- |
| 34.5 (approach) | 166, 363 k | 155, 345 k | 328, 1.40 M | 326, 1.40 M |
| 37.3 (near the entrance) | 140, 329 k | 135, 313 k | 264, 1.09 M | 249, 1.15 M |
| 39.5 (deep inside) | 155, 345 k | 136, 306 k | 301, 1.22 M | 253, 1.23 M |
| 42.4 (at the exit) | 157, 360 k | 151, 341 k | 283, 1.19 M | 281, 1.19 M |

In the tunnel by night the wet road's mirror is no longer drawn (the road
there is dry) and its calls go to the probe's second face
(`PROBE.tunnelFaces`). The approach was over both call budgets before the
tunnel changed and still is.

**The approach to the tunnel** (ref lane, 2026-11-26; `node tools/perfcount.cjs`, 402x874, day, level 0, one
frame on average of four, at t = 34 (s 1339 m, 140 m before the portal) and t = 36 (s 1446 m, 33 m before it)),
before and after the cutting became a meadow:

| tier, t | before: calls, triangles (scene / shadow / probe calls) | after |
| --- | --- | --- |
| low, 34 | 136, 295 k (90 / 27 / 10) | 132, 285 k (85 / 27 / 11) |
| low, 36 | 133, 295 k (84 / 29 / 11) | 136, 299 k (86 / 30 / 12) |
| medium, 34 | 190, 951 k (123 / 33 / 17) | 168, 841 k (105 / 34 / 12) |
| medium, 36 | 179, 860 k (110 / 36 / 16) | 181, 882 k (112 / 34 / 18) |

At t = 34 the wood beside the road is gone (no full or reduced trees in view, where medium drew 17 and 23); at
t = 36 the meadow's tall grass, its furniture and the nearer bushes add 2 to 3 calls and 4 to 22 k triangles. More
trees are in view as impostors, two triangles each (the spruce wood is a close lattice), and more of them cast.

The still from `?photo=r1` beside photograph R1 (medium, 1280x720, the shutter cut to a ninth; mean colour and
relative luminance Y of matching regions, each picture's own boxes):

| region | R1: sRGB, Y | ours: sRGB, Y | ours / R1 |
| --- | --- | --- | --- |
| hillside meadow | 133 182 43, 0.418 | 138 176 62, 0.371 | 0.89 |
| portal concrete | 184 198 180, 0.569 | 209 205 189, 0.610 | 1.07 |
| verge grass | 131 144 15, 0.254 | 122 131 67, 0.217 | 0.85 |
| spruce wood | 8 33 34, 0.013 | 16 38 30, 0.022 | 1.6 |
| asphalt | 177 192 197, 0.513 | 117 116 117, 0.176 | 0.34 |
| the mouth | 14 29 35, 0.014 | 136 137 137, 0.269 | 19 |

The meadow, the concrete and the verge are within 15 per cent. The wood is dark but still 1.6 times the
photograph's (hue 145 against 181): it is lit from the front by a low sun. The asphalt and the mouth are the
circuit's own asphalt and tunnel lighting, which this place does not change (design.md lists what differs).

None of these was measured on a real GPU or phone.

## What a frame costs

Counted, not timed: this machine draws with software WebGL, so no number here
says how long anything takes on a GPU. `node tools/perfcount.cjs` (tools.md)
wraps the renderer in the page and counts what each pass is asked to draw;
the full-screen passes are counted from their shaders. Autopilot run by day,
`?seed=1`, an upright phone's shape (402x874), four frames averaged; page
seconds (the lap clock is about 5.2 s less).

**Medium, by day, before the perf lane** (b786f90, 2026-11-19):

| place | draw calls | triangles | the scene | the sun's shadow map | probe faces (a face every 2nd frame) | trees: full / reduced / impostors | tree cards over the picture | caster cards in the shadow map |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| start straight, t = 8 | 171 | 973 k | 87 calls, 662 k | 43, 182 k | 24, 129 k | 40 / 22 / 1829 | 4.0 layers | 198 trees, 40 M texels |
| forest, t = 26 | 201 | 1038 k | 128, 777 k | 30, 135 k | 26, 126 k | 43 / 13 / 2326 | 12.3 layers | 451 trees, 77 M texels |
| into the tunnel, t = 36 | 178 | 792 k | 106, 565 k | 32, 132 k | 23, 96 k | 0 / 0 / 426 | 0 | 196 trees, 27 M texels |
| coast road, t = 56 | 132 | 607 k | 63, 369 k | 31, 146 k | 22, 92 k | 0 / 0 / 4 | 0 | none |

The budget is 300 calls and 600 k triangles. What the triangles are (t = 8 /
t = 26): the full trees 204 k / 181 k (40 and 43 trees: about 5 k each; on
the start straight `detail` stretches the full form to 127 m for the wall of
maples); the massif 92 k, in every frame wherever the camera looks; the car
55 k and its wheels 29 k, and again 36 k + 21 k + 4 k in the shadow map; the
terrain's band and grid 59 k / 142 k, and 79 k / 48 k in the shadow map; the
three rings of far mountains 50 k; the sea 20 k; the road 14 k / 53 k. A
probe face is about 190 to 260 k triangles (a third of it the reduced trees
on the start straight).

Two things the triangle count does not show, both larger than it:

- **Tree cards over the picture.** The area of every tree card the view
  draws, as seen, over the picture's area: 12 layers in the forest, 10 of
  them the 43 full trees. Each is alpha-tested (alpha to coverage on the
  multisampled tiers), so the GPU cannot reject what is hidden before
  shading it as it does for solid things. An upper bound: depth rejects what
  lies behind something already drawn.
- **Caster cards in the shadow map.** Every tree whose crown is in the
  light's way is drawn into the sun's map as one card turned to the light,
  and every texel of the card runs an alpha test. Under the day's 16 degree
  sun the map is fitted to the ground (a texel is 5.5 cm across and 2.8 cm
  up the light's view), so a crown 8 m wide and 14 m tall is some 70 000
  texels: 27 to 77 M texels of cards a frame in a map of 4.2 M, 6 to 18
  times its area, against a picture of 1.4 M pixels. (Cards that hang over
  the map's edge are counted whole.)

**The full-screen passes** (medium; lookups per pixel of the picture, which is
the view times the render scale; engine.md lists the passes):

| pass | size | texture lookups per picture pixel | writes |
| --- | --- | --- | --- |
| the scene | 1 | (its materials') | half-float colour and 24-bit depth, 4 samples each: 68 MB at 804x1748, resolved to 17 MB |
| occlusion term | 1/4 | 13 of depth each: 3.3 | 8-bit, 1/4 |
| its blur, twice | 1/4 each | 10 each: 5 | 8-bit, 1/4, twice |
| occlusion into the picture | 1 | 10 | half-float, full size |
| motion blur | 1 | 6 where nothing moves, 2 more per sample: to 30 (to 18 with the `blur` rung shed) | half-float, full size |
| bloom, 5 halvings | 1/4 ... 1/1024 | 13 each: 4.3 | half-float, 1/3 in all |
| bloom, 4 enlargements | 1/4 ... 1/256 | 10 each: 3.3 | half-float, 1/3 in all |
| star | 1/16 | 36 each: 2.3 | half-float, 1/16 |
| flare source | one texel | (a level of at most 48 x 105 texels, once) | |
| final | 1 (the canvas's pixels at scale 1) | 6 | the canvas, or 8-bit at the scene's size |
| upscale (render scale under 1 only) | the canvas's pixels | 12, of the 8-bit picture | the canvas |

40 to 64 lookups a pixel and three full-size half-float targets written
(the resolve, the occlusion's picture, the blur's) with everything on; 22 to
46 and two with the `ao` rung shed, 22 to 34 with `blur` shed as well. Low: no occlusion, the blur inside the
final pass (up to 14 lookups), four bloom levels, then FXAA (9 to 23 lookups
of the 8-bit picture).

**Fragment shaders as three.js compiled them** (medium, lines of code after
its includes; texture lookups written in the source, not executed: a loop
counts once): the asphalt 2071 lines and 73 lookups; the car's paint 2045 and
65; the terrain 1891 and 69; the sea 1680 and 63; the tunnel 1664 and 61;
the massif 1632 and 61; concrete and the town 1604 to 1996 and 58. All of
them carry three.js's physical material (the environment map, the shadow
map's filter, the lights' loops) under the demo's own code.

**The lakeside, before and after** (1f27e8a against the lakeside's commit, 2026-11-26; the same shape and
method; t = 48 is the sky road's first third, t = 54 its end with the tarn ahead, t = 56.5 the lakeside itself):

| tier, place | draw calls before | after | triangles before | after | trees after: full / reduced / impostors |
| --- | --- | --- | --- | --- | --- |
| low, t = 48 | 119 | 119 | 264 k | 264 k | 0 / 0 / 680 |
| low, t = 54 | 116 | 122 | 237 k | 250 k | 0 / 8 / 829 |
| low, t = 56.5 | 110 | 113 | 254 k | 264 k | 0 / 27 / 866 |
| medium, t = 48 | 139 | 139 | 678 k | 678 k | 0 / 0 / 1145 |
| medium, t = 54 | 152 | 167 | 740 k | 831 k | 14 / 17 / 1660 |
| medium, t = 56.5 | 145 | 148 | 838 k | 830 k | 37 / 10 / 1609 |

At the sky road's end the tarn, its shore's wood and the bank's stand come into view (6 draw calls more on low,
15 on medium: the water, the fence, the flowers, more forms of tree; 5 and 12 % more triangles); on the stretch
itself the wall of conifers that stood at the rail is gone and the stand on the bank has taken its place, at about
the triangles the place cost before.

**The golden wood and the arm of the lake, before and after** (e0b0b36 against these two places, 2026-11-26; the
same shape and method, an upright phone's shape; t = 22, 26 and 30 are the esses' three bends, t = 84 and 87 the
gully bridge, t = 90 the start of the long right):

| tier, place | draw calls before | after | triangles before | after | trees before: full / reduced / impostors | after |
| --- | --- | --- | --- | --- | --- | --- |
| low, t = 22 | 125 | 121 | 316 k | 306 k | 0 / 39 / 1407 | 0 / 27 / 1204 |
| low, t = 26 | 153 | 151 | 340 k | 352 k | 0 / 37 / 1045 | 0 / 31 / 1128 |
| low, t = 30 | 120 | 120 | 290 k | 288 k | 0 / 53 / 1624 | 0 / 27 / 1614 |
| low, t = 84 | 101 | 104 | 228 k | 229 k | 0 / 0 / 1209 | 0 / 0 / 702 |
| low, t = 87 | 112 | 114 | 265 k | 263 k | 0 / 4 / 1578 | 0 / 3 / 755 |
| low, t = 90 | 107 | 109 | 299 k | 292 k | 0 / 43 / 1144 | 0 / 35 / 604 |
| medium, t = 22 | 164 | 154 | 992 k | 961 k | 36 / 42 / 3160 | 30 / 45 / 2926 |
| medium, t = 26 | 210 | 200 | 1090 k | 1165 k | 30 / 48 / 2739 | 32 / 40 / 2965 |
| medium, t = 30 | 165 | 157 | 1012 k | 928 k | 49 / 54 / 2736 | 27 / 46 / 2742 |
| medium, t = 84 | 125 | 129 | 649 k | 659 k | 0 / 0 / 2904 | 0 / 0 / 1563 |
| medium, t = 87 | 151 | 151 | 811 k | 785 k | 6 / 35 / 2864 | 7 / 18 / 1328 |
| medium, t = 90 | 147 | 150 | 949 k | 886 k | 40 / 56 / 1768 | 31 / 35 / 941 |

In the esses both tiers now cost what they did within a few per cent (low -3 to +4 % of the triangles, medium -8
to +7 %): the walls' first two rows keep the full form about as far as the lap's trees do and the three behind
only the reduced one (a first version kept the full form further out and cost 10 to 22 % more on medium). At the
arm of the lake both tiers cost what they did within 2 % at the bridge and a little less in the long right: the
wood on the bank is gone, the water is the lake's own sheet, and the fine ground, the fence and the far shores'
wood add two to four draw calls.

## Sound

Everything is synthesised in `src/game/Sound.js` on `src/engine/Audio.js`:
the engine (two oscillators locked to the firing frequency, rpm / 30 Hz,
through a saturation, a formant near 650 Hz, a rasp near 1.35 kHz and a
low-pass that opens with rpm squared), intake noise, a turbocharger whistle,
gear changes (cut, thump, glide), tyres (squeal, scrub), wind (band-passed, then low-passed at 1.4 kHz so its skirts make no clicks at 200 km/h), road and kerb
rumble (the kerb's teeth, 0.45 m apart, thrum at speed / 0.45 Hz; the paved margin hardly at all), scrapes and impacts, the start's ticks and go, and a reverb that
grows in the tunnel. In split screen the two cars sit 0.7 either side of the
stereo picture. Sound starts on the first touch or key (the browsers' rule).
`tools/soundtest.cjs` measures it: 62 checks.

## Storage

`localStorage`; everything works without it.

| key | what |
| --- | --- |
| `dreamcar.best.v2` | the board, per time of day |
| `dreamcar.ghost.v2` | the ghosts, per time of day |
| `dreamcar.quality` | the chosen tier |
| `dreamcar.units` | km/h or mph |
| `dreamcar.map` | the map on or off |
| `dreamcar.stats` | the performance readout on or off |
| `dreamcar.level.v1` | where the governor ended on this device, as `tier:level`: the next visit starts there, not at the top |
| `dreamcar.assists` | the driving help: full, sport or off |
| `dreamcar.throttle` | the touch throttle: auto or manual |
| `dreamcar.steering` | the touch steering: pad, slider, arrows or tilt |
| `dreamcar.hand` | the hand that holds the phone (where the pad's ghost rests): right or left |
| `dreamcar.zones.v1` | the touch controls have been named once |
| `dreamcar.muted` | sound off |
| `dreamcar.hinted.v1` | the first-run hint has been shown |

## Requirements

WebGL 2 (three.js 0.187). Half-float render targets are used where the
browser has them, with an 8-bit fallback (`caps.hdr`). The build targets
ES2020 and Safari 15. No file is fetched at run time. Tested only in headless
Chromium on software WebGL (see [tools.md](tools.md)).
