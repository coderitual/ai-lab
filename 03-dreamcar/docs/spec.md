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
| banking | by rule 9° x tanh(250 m / R), or the piece's own; at most 10° (the sky road, the first ledge bend) |
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
| `tunnel` | The tunnel | 1409 to 2006 | rock cutting 70 m; the bore 1479 to 1828 (349 m, right R 1000 through 20°); cutting 178 m | 216 to 255 |
| `viaduct` | The sky road | 2006 to 2582 (576 m) | on piers: left R 300 through 110°, banked 10°, ground 42 m under the middle | 229 to 257 |
| `carousel` | The carousel | 2582 to 2915 | 150 m climb at 6 %, then right R 55 through 190°, banked 8° | 90 to 229 |
| `crest` | The crest | 2915 to 3115 | 200 m straight over the top | 108 to 161 |
| `plunge` | The plunge | 3115 to 3394 | right R 400 through 40°, banked 5°, 8 % down into the compression | 161 to 215 |
| `ledge` | The ledge | 3394 to 3778 | left R 300 50° (bank 10°; low walls both sides, the valley open inside, a wooded bank outside), right R 350 20° (6°, rock on the inside) | 216 to 257 |
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
| barriers | steel rail by default; a low concrete wall the whole length of the straight on the lake side, and on the land side along the pits (the 110 m before the line and the 40 m after it); a rail on the rest of the land side, with open mown paddock behind it on the 340 m run-up to the line and the maples close behind it on the 210 m after the grid (`paddock`, `grove`); cut rock at the cuttings, the carousel and the ledge; walls in the tunnel and parapets on the bridges, 1.5 m beyond the pavement |
| structures | the tunnel's bore 349 m, ceiling 6.4 m over the road (`TUNNEL`); two bridges on piers, 913 m in all: `viaduct` 2006 to 2582 (drop 42 m), `gully` 3778 to 4115 (drop 26 m) |
| kerbs | 15 runs, 3855 m in all, 1.2 m wide, flush at the road and rising 4 cm to the outside with a 0.9 m saw-tooth, ramped over 4 m at each end (`KERB`); on the inside of every bend under 800 m radius and the outside of the exits of those under 500 m; surface `KERB`, grip 0.9 |
| tyre walls | 8 runs, on the outside of the fast bends |
| trackside boards | 11 runs, both walls of the straight included |
| distance boards | 300 m and 200 m (on the sky road's parapet) and 100 m before the carousel |
| marshal posts | 12 |
| start gantry | across the line, feet at 11.5 m left and 12.4 m right of the centre line |
| street lamps | 23, 9 m high, every 30.4 m on alternating sides along the whole straight |
| tunnel lamps | 29 rows of two, every 12 m |
| sector lines | s = 1881.8 m (37 %, just out of the tunnel) and 3420.0 m (67 %, the start of the ledge); the third is the line |
| grid | 12 boxes behind the line (`track.grid`) |

The start area, the pit building, the stands, the town and the woods are
scenery beyond the barriers; design.md describes them.

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
| 0 to 100 km/h | 3.89 s |
| 0 to 200 km/h | 12.1 s |
| standing 400 m | 11.81 s at 198 km/h |
| up-shifts at full throttle | 53, 86, 124, 170 km/h (2nd to 5th) |
| top speed | 283.9 km/h in 8th (limited); 324.7 km/h without the limiter |
| 100 to 0 km/h | 27.8 m in 2.11 s (mean 1.42 g); locked, without ABS, 32.5 m |
| 200 to 0 km/h | 105.6 m in 3.97 s |
| steady cornering, 50 m circle | 1.26 g at 90 km/h; understeer 0.92° per g; roll 3.47° per g |
| key held through a long bend | 1.26 g at 110, 1.27 g at 140, 1.31 g at 200 km/h |
| step steer, 2° at 100 km/h | 0.67 g; yaw rate 90 % in 0.11 s, overshoot 2 % |
| tyres squeal from | 84 % of the most grip at 60 km/h, 87 % at 110 km/h |
| full key lock for 3 s, throttle held | 4.4° of slip at 150, 3.8° at 200, 3.0° at 250, 2.9° at 280 km/h: never spins |
| full throttle in 2nd at 0.65 g | assists on: 2.8° of slip; assists off: spins |
| rail touched at 10° / 100 km/h, 5° / 200, 8° / 250 | keeps 93 %, 96 %, 92 % of the speed, along the rail in 0.02 to 0.10 s |
| rail hit at 45°, 80 km/h | keeps 53 % |
| ride | 1.30 / 1.51 Hz, damping 0.47 (bump 0.35, rebound 0.58) |
| key steering lock | 33.2° at 20, 20.4° at 40, 6.6° at 100, 4.0° at 200 km/h |
| a key held at 80 km/h | 90 % of the yaw rate in 0.33 s, under 10 % 0.33 s after release |

Laps of the real road (flying laps, Node, no drawing):

| driver | lap | notes |
| --- | --- | --- |
| autopilot, pace 1.0 | 85.1 s (217 km/h mean) | 0 impacts, stability control 4.5 s a lap |
| autopilot, pace 0.9 (`?ap`) | 92.9 s | 0 impacts |
| autopilot, pace 0.7 | 117.1 s | 0 impacts |
| one thumb (full throttle unless braking) | 84.7 s | 0 impacts |
| pad (analog) | 85.1 s | 0 impacts |
| keys | 85.6 s | 0 impacts, stability control 20.8 s a lap |
| ham-fisted keys (flat out, full keys, slow hands) | 90.5 s | 0 impacts, body 0.38 m onto the kerb at worst |

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
| drive / brake | W / S or ↑ / ↓ | W / S and ↑ / ↓ | right / left trigger | automatic throttle; pull the thumb down to brake, or a second finger |
| steer | A D or ← → | A D and ← → | left stick | the first finger is a stick where it lands: 62 px for full lock |
| handbrake | Space | Space, right Shift | A | |
| camera | C | C, `.` | Y | button |
| look back | B (held) | B, `,` | X | |
| put back | R | R, `/` | B | button |
| high beam | H | H | | button |
| ghost | G | | | |
| time of day | N | N | Back / View | title |
| mute | M | M | | options |
| pause | P, Esc | P, Esc | Start | button |
| start, menus | Enter, Tab | | A, d-pad | tap |

Each driver reads whichever of their devices was used last. On a tablet in
split screen each half of the screen is one driver's touch zone. Every button
can be reached by Tab and Enter, or a pad's d-pad and A; touch targets are at
least 44 px.

## Cameras

`src/game/Cameras.js`, numbers in `CAMERA` (`src/game/config.js`).

| | |
| --- | --- |
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
  gear, the ABS / TC / ESC lamps;
- bottom left: a small map (can be hidden);
- over the road above the car, only while it slides: a drift readout (the angle and a running score; `Hud.setDrift`), and on touch screens a place under the right thumb for round thumb buttons (`Hud.addThumbButton`). Both exist in the HUD; nothing in `Game.js` calls them yet, so neither shows (checked in the source at this head);
- touch screens: four small buttons together (camera, high beam, put back,
  pause);
- the best-laps board on the title, the pause sheet and the results only.

DOM writes: 45.8 a second at 1280x720 solo while running (HUD lane's
measurement; `stats().hudWrites`).

## Options

On the title and the pause sheet: quality (auto, low, medium, high; applied
by reloading the page), sound on or off, time of day, units (km/h, mph), the
map shown or hidden.

## URL parameters

Read once by `src/engine/params.js`.

| | |
| --- | --- |
| `?time=day\|dusk\|night` | the time of day to open on (default: the first in `TIMES`, the day) |
| `?mode=split` | two players |
| `?laps=N` | laps per run |
| `?cam=chase\|far\|bonnet\|bumper` | the camera |
| `?q=low\|medium\|high` | the quality tier (wins over the stored choice) |
| `?dpr=` | the device pixel ratio |
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
| `?photo=d1`, `d3`, `d4` | named places of it (`PHOTOS` in config.js): the camera of a reference frame (d1 the run-up to the line by day, d3 the ledge's first bend by day, d4 the grid at golden hour) with its own moment of the autopilot's run and time of day, unless `?t=` or `?time=` give them |
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
| sun / moon | 3° right of the straight's heading, 16° up; intensity 7.5 | 125° left (over the lake, behind the driver's left shoulder), 3.5° up; colour [1, 0.6, 0.3], 3.4 | the moon 8° left, 17° up; 0.08 |
| exposure (tunnel) | 0.72 (5.6) | 3.2 (6) | 18 (8) |
| wetness | 0 | 0 | 0.65 |
| street lamps / tunnel / windows | 0 / 1 / 0 | 1 / 1 / 0.7 | 1 / 1 / 1 |
| car lamps | running lights | low beam | low beam |
| clouds cover | 0.4 | 0.38 | 0.3 |
| bloom / glare / ghosts | 0.05 / 0.015 / 0.0003 | 0.09 / 0.03 / 0.0003 | 0.15 / 0 / 0 |
| contrast / saturation | 1.18 / 1.04 | 1.12 / 1.12 | 1.12 / 0.94 |

N, or the title's choice, fades to black and back (0.25 s each way) to switch.

## The picture

One render call per view into a multisampled half-float target, then the
passes of `src/engine/FramePipeline.js`; docs/engine.md lists them pass by
pass with their sizes. In short:

| | low | medium | high |
| --- | --- | --- | --- |
| pixel ratio cap | 1.5 | 2 | 2 |
| scene MSAA | none (FXAA on the finished picture) | 4 | 4 |
| motion blur | inside the last pass, 6 taps, streak ≤ 4 % | own pass, 12 taps, ≤ 7.5 % | 18 taps, ≤ 9 % |
| bloom levels | 4 | 5 | 6 |
| lens (flare source, ghosts, glare, star) | no | yes | yes |
| ambient occlusion | no | 8 samples, half size | 14 samples |
| car's probe at speed / standing | 64 / 128 per face, a face every 2nd frame | 128 / 256 | 256 / 512, 2 faces a frame |
| wet road mirror | none | 0.35 of the view's height, to 220 m | 0.5, to 320 m |
| forest: full / reduced / impostor trees to | 0 / 60 / 650 m | 34 / 95 / 900 m | 50 / 130 / 1200 m |
| effects: skid quads / soft particles / sparks | 800 / 192 / 48 | 1500 / 320 / 96 | 2000 / 400 / 128 |

The adaptive render scale (1, 0.85, 0.72, 0.6, 0.5) steps down when frames run
long and back up when they are short; it shrinks only the off-screen targets.

## Quality tiers and budgets

`auto` takes the capability probe's guess (`src/engine/caps.js`): software
WebGL and unknown phone GPUs start `low`; recent Apple, Adreno 640+ and
Mali-G71+ phones `medium`; Intel graphics other than Arc and Xe `medium`;
other desktop GPUs `high`. The choice is stored and applied by reloading.

Budgets set by the rework for a chase frame: low 150 draw calls and 250 k
triangles, medium 300 and 600 k, high 500 and 1.2 M.

Measured (software WebGL, by the lanes, with `__dreamcar.stats()`):

- whole frame, low, merged head of the rework: 432 k triangles, 173 draw calls
  (ENV lane) — **over the low budget**; of it the forest 54 k, the far
  mountains 39 k, lamps 46 k, the car 44 k, the ghost 25 k;
- the forest, chase view in the green wood: low 10 calls / 61 k, medium
  19 / 294 k, high 20 / 540 k (TREES lane);
- the start's dressing (delta of hiding it, probe off): low 27 / 11 k, medium
  25 / 40 k by dusk and 39 / 52 k by night, high 34 / 55 k and 48 / 67 k
  (START lane);
- the road mirror: about 48 draw calls and 9 to 13 ms of CPU (LOOK lane,
  viewer, 960x540);
- ambient occlusion: 36 ms on medium, 45 ms on high on software WebGL
  (ENGINE lane).

None of these was measured on a real GPU or phone.

## Sound

Everything is synthesised in `src/game/Sound.js` on `src/engine/Audio.js`:
the engine (two oscillators locked to the firing frequency, rpm / 30 Hz,
through a saturation, a formant near 650 Hz, a rasp near 1.35 kHz and a
low-pass that opens with rpm squared), intake noise, a turbocharger whistle,
gear changes (cut, thump, glide), tyres (squeal, scrub), wind, road and kerb
rumble, scrapes and impacts, the start's ticks and go, and a reverb that
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
| `dreamcar.muted` | sound off |
| `dreamcar.hinted.v1` | the first-run hint has been shown |

## Requirements

WebGL 2 (three.js 0.187). Half-float render targets are used where the
browser has them, with an 8-bit fallback (`caps.hdr`). The build targets
ES2020 and Safari 15. No file is fetched at run time. Tested only in headless
Chromium on software WebGL (see [tools.md](tools.md)).
