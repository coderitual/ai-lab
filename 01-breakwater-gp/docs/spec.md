# Specification

What the build does, read back out of the code. Where a number appears here it
is the number in `src/`; if the two ever disagree, the code is right and this
file is out of date (see [README.md](README.md#keeping-this-current)).

Units are metres, seconds and radians unless stated. Speeds shown to the
player are km/h (m/s × 3.6).

- [1. Shape of the program](#1-shape-of-the-program)
- [2. Time](#2-time)
- [3. The sea](#3-the-sea)
- [4. The boat](#4-the-boat)
- [5. The course](#5-the-course)
- [6. The race](#6-the-race)
- [7. Bots](#7-bots)
- [8. Camera](#8-camera)
- [9. Controls](#9-controls)
- [10. HUD and panels](#10-hud-and-panels)
- [11. Sound](#11-sound)
- [12. Effects](#12-effects)
- [13. Drawing a frame](#13-drawing-a-frame)
- [14. Online play](#14-online-play)
- [15. Options and hooks](#15-options-and-hooks)
- [16. Build and publishing](#16-build-and-publishing)

## 1. Shape of the program

Plain JavaScript modules, three.js r187, built by Vite. No other runtime
dependency and no asset files.

```
src/
  main.js            entry: reads the query string, makes a Game, exposes window.__bw
  viewer.js          dev-only asset viewer (viewer.html)
  engine/            knows nothing about this particular game
    Engine.js          renderer, resize, fixed-step loop, adaptive quality
    waves.js           the sea: wave table, GLSL for it, the same maths in JS
    ChaseCamera.js     chase and orbit camera
    Input.js           keyboard and touch
    Audio.js           synthesised sound
    ReflectionProbe.js live cube map and the mirror coat for materials
    WaterMirror.js     planar reflection of what stands on the water
    BakedShadow.js     sun shadows of things that never move, drawn once
    math.js            small helpers
  assets/            everything visible, generated
    palette.js         colours, sun direction, teams
    textures.js        noise, ripple normals, caustics
    sky.js             sky dome, shared sky/fog GLSL, sky environment map
    water.js           ocean mesh and shader
    environment.js     sea + sky + sun + shadows, assembled
    boat.js, boat/     the boat (see boat.md)
    buoys.js           marks, course floats, start arch
    island.js          land: height function, mesh, the ground material (sand, grass, rock)
    palm.js            coconut palms: trunks, fronds, their textures, the wind
    scenery.js         rocks, lighthouse, pier, sailboats
    geo.js             modelling helpers (part, merge, loft, skin, fan, facet)
    registry.js        what the viewer can show
  game/
    config.js          rules and tunables
    track.js           centre line, marks, racing line, grid
    World.js           builds the place, floats the props
    Craft.js           one boat: physics and model
    drivers.js         player and bot drivers
    Race.js            rules and bookkeeping
    effects.js         wake field, spray, mist
    Lens.js            rain on the camera lens, and the finish of the picture
    Hud.js, hud.css    DOM HUD, minimap, panels, lobby
    Game.js            wires it together; solo, split screen, online
  net/
    PeerLink.js        one WebRTC link, joined by hand-carried codes
    OnlinePlay.js      lobby, shared clock, state messages, prediction
tools/               dev scripts, not part of the build (see tools.md)
```

Conventions used everywhere:

- World: +Y up. A boat's heading `yaw` is a rotation about +Y; forward is
  `(sin yaw, 0, cos yaw)`; port is `(cos yaw, 0, -sin yaw)`; positive yaw turns
  to port.
- Boat model: +Z bow, +X port, origin on the waterline amidships.
- `pitch > 0` is bow up; `roll > 0` is starboard down.
- Controls: `steer` −1 (left) … +1 (right); `throttle` 0…1; `brake` 0…1.
- Track frame at arc length `s`: `lateral > 0` is to the right of the
  direction of travel.

## 2. Time

- Physics runs in fixed steps of **1/120 s** (`FIXED_DT`). A frame advances the
  simulation by however many steps fit, and draws with the boats interpolated
  between the last two steps.
- A frame longer than **0.1 s** is cut to 0.1 s; time lost that way, or while
  the tab is hidden, is not simulated. (Online, the shared clock keeps running
  through it: section 14.)
- With `?manual` the loop does not run; time moves only when
  `__bw.advance()` / `__bw.skip()` are called. Tests and captures use this.

## 3. The sea

The surface is a sum of trochoidal (Gerstner) waves:

```
P.xz = p + Σ dir_i · H_i · cos θ_i        θ_i = k_i (dir_i · p) − ω_i t + φ_i
P.y  =     Σ       A_i · sin θ_i          k = 2π / length,  ω = √(g k),  g = 9.81
```

`H = A × steep`; phase `φ_i = 1.7 i + 0.4`. Directions are degrees from +X
toward +Z.

Waves the boats ride (CPU and GPU):

| dir | length | amplitude | steep | |
| --- | --- | --- | --- | --- |
| 218° | 76 | 1.35 | 1.18 | main swell |
| 250° | 47 | 0.85 | 1.18 | |
| 188° | 29 | 0.5 | 1.2 | |
| 290° | 17 | 0.23 | 1.2 | wind chop |
| 150° | 10.5 | 0.105 | 1.2 | |
| 325° | 6.2 | 0.045 | 1.1 | |

Waves only the GPU draws (six on desktop, the first four on phones):
lengths 4.3, 3.3, 2.6, 2.05, 1.6, 1.25 m; amplitudes 0.072 … 0.017 m.

Every amplitude is scaled by a field that depends on place:

- **Shelter.** Along the direction 225°, amplitude falls smoothly from 1 on
  the open side to **0.5** in the lee (`smoothstep(−110, 150)` of the distance
  along that direction).
- **Shores.** Within 55 m of an island's shore circle the amplitude falls to
  0.3 of its value.
- **`sea.scale`**: a global multiplier (`?sea=`), 1 by default.

`sampleSurface(x, z, t)` returns height, normal, vertical speed and the
undisplaced coordinates for a point. Trochoidal waves move the water sideways
as well as up and down, so it first finds which bit of water is at (x, z) now
(three fixed-point iterations) and reports the height of that.

## 4. The boat

Dimensions: 5.8 m long (z from −2.7 to +3.1), 2.16 m beam. See
[boat.md](boat.md) for the model. The physics treats it as follows.

**Feeling the sea.** Four points, one under each end of each hull: ±0.77 m
from the centre line, 1.9 m ahead of and behind the middle (`HULL` in
`game/config.js`). Each step, each point asks the sea for its height, its
vertical speed and its slope there.

**Buoyancy.** At each point, with `keel` the height of that bit of the hull's
bottom (from the boat's height, pitch and roll, 0.24 m below the waterline)
and `depth = water + planing − keel` (`planing` rises to 0.09 m by 18 m/s):

- `depth ≤ 0`: that point is out of the water and feels nothing.
- `depth > 0`: it is pushed up by
  `55·min(depth, 1.2) + 260·deep² − 9·rise·hold`, where `deep` is how far past
  the float line (`gravity / buoyancy` = 0.227 m) plus 4 cm it is, `rise` its
  vertical speed relative to the water and `hold = clamp(depth / 0.205)`. A
  point driving down into the water also meets `2.2·rise²` of drag.

A quarter of the sum of the four lifts the boat against gravity (12.5 m/s²).
Their differences turn it: pitch with inertia 2.6, roll with inertia 0.62.
Nothing else tells the hull what attitude to take.

- `grip` (the mean `hold` of the four) scales drag, the bite of the hulls and
  the weathercock; `gripAft` (the mean of the two under the tails) scales
  thrust and the helm. All fade as the boat leaves the water.
- No point in the water for more than 0.05 s counts as airborne. Coming down
  after more than 0.16 s with an impact over 1.4 m/s is a *landing*: strength
  `(impact − 0.6) / 10`, and up to 11 % of horizontal speed is lost.
- In the air the hull levels out and settles 0.07 rad bow-up, so it comes
  down tails first.

**Drive.** Thrust `9.2·throttle·√gripAft`. Drag `c1·v + c2·v|v|` with
`c1 = 0.12` and `c2` chosen so thrust and drag balance at the top speed for
the current power:

| power | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| top speed, m/s | 22.6 | 23.8 | 24.9 | 26.0 | 27.1 | 28.4 |
| km/h | 81 | 86 | 90 | 94 | 98 | 102 |

Braking adds `9.2·brake·√grip` of drag. Wave faces push the hull downhill with
`0.55·gravity·slope`.

**Going sideways.** The water resists sideways speed `u` with
`most·tanh(5·u / most)`, where `most = 17 m/s² × (1 + 0.35·brake) × grip`.
Below about 2 m/s of sideways speed that is a firm 5 /s of damping, and the
boat carves; past it the force stops growing, the boat needs more than the
water will give, and it slides. Sliding scrubs `0.055·|u|` off the forward
speed.

**Steering.** The helm asks for a yaw rate of `−steer × 1.3 rad/s × authority`,
where authority rises with speed up to 6 m/s, eases off to 80 % by 28 m/s,
and gains 30 % under full brake; reversed when going astern; 22 % of it is
left with the tails out of the water. A boat going sideways also wants to
point the way it is going: `1.15 × slip` rad/s is added (slip being the angle
between heading and course), 45 % less under full brake. The yaw rate
follows the sum at 8 /s (2 /s in the air).

What that gives, measured on a calm sea from about 100 km/h by
`tools/handling.cjs` (run it again after changing `CRAFT_TUNE`):

| helm | result |
| --- | --- |
| half lock, 3 s | a clean carve: 6° of slip, 69 m radius, no speed lost |
| full lock, 3 s | a drift: 20° of slip after 1 s, 34° after 3 s, 102 → 80 km/h, radius closing from 42 m to 33 m |
| then let go | slip back to 15° in half a second and to nothing within a second and a half |
| full lock and brake, 0.9 s | a tight powerslide: 34° of slip, 105 → 61 km/h, 18 m radius |
| flick one way, then the other | 15° of slip one way, 18° the other, speed kept |

**Trim.** On the water the bows are asked up `0.055 rad × throttle` while
accelerating and 0.04 rad at speed, down 0.04 rad under braking, and the hull
is asked to lean into a turn by `0.23 rad per rad/s` of yaw rate, through the
same springs the four points make.

**Inputs are smoothed**: keys ramp the helm at 3.6 /s toward a side and 6 /s
back to centre; an analogue thumb follows at 14 /s; throttle at 5.5 /s; brake
at 9 /s.

**Collisions.** A hull is three circles of radius 1.2 m at −1.6, 0 and +1.6 m
along its centre line.

- Boat against boat: the deepest-overlapping pair of circles pushes the two
  apart equally, with restitution 0.35. Ignored if their heights differ by
  more than 1.6 m (one is jumping over the other).
- Boat against a mark (soft: it shoulders you aside, speed × 0.9) or a moored
  boat (hard: bounce 0.3, speed × 0.72).
- Boat against land: where the sea bed is shallower than 0.55 m under any of
  three points along the hull, the hull is pushed back down the slope.
- A closing speed over about 1.2–1.5 m/s raises a *bump* event (camera kick,
  splash sound, water on the lens).

## 5. The course

A closed loop round the main island, **1144 m** long: a centripetal
Catmull–Rom curve through ten points at angle/radius (degrees, metres)
0/172, 36/190, 72/160, 108/186, 144/204, 180/168, 216/150, 252/184, 288/200,
324/164, sampled at 800 points.

- Half-width 26 m, marked by 96 orange floats (one pair every 24 m).
- Nine slalom marks, 6.5 m off the centre line on alternating sides:

| mark | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| at, m | 97 | 217 | 343 | 463 | 572 | 698 | 818 | 938 | 1058 |
| pass on its | right | left | right | left | left | right | left | right | left |

- Start/finish arch at `s = 0`. Grid: four slots at lateral −9, −3, +3, +9 m,
  14 m before the line.
- Land: the main island (radius 78 m, 30 m high) at the origin; a rocky islet
  with the lighthouse at (−92, 250); a sandy islet at (253, −146); six far
  hills on the horizon. Props: palms, sea stacks, a pier, moored boats (which
  can be hit), sailboats.

## 6. The race

Constants: 3 laps, 4 boats, power 0…5, 5 misses allowed, 5 s allowed outside
the floats.

**States**: `grid` → `countdown` → `racing` → `finished`.

- Countdown: 3.6 s. "3", "2", "1" a second apart; GO when 0.6 s is left.
- A mark is judged when a boat's progress passes the mark's `s`: clean if the
  boat is more than 0.4 m to the correct side of it.
  - Clean: power +1 (bots have a cap: section 7).
  - Miss: power 0 and one miss counted. A local player's fifth miss retires
    them ("OUT").
- A lap is counted from progress along the centre line; lap times are kept.
- Outside the floats (more than 1.5 m beyond the half-width): a local player
  sees a countdown, and after 5 s is put back on the racing line at their
  progress, moving at 7 m/s, power 0, with the next mark the first one still
  ahead.
- Going the wrong way for more than a second shows a warning.
- The race is over, on a given machine, once every player on that machine has
  finished or retired. The others race on behind the results panel, which
  becomes final when everybody is home or 25 s later, whichever comes first.
- Ranking: finishers by time, then those still running by distance covered,
  then the retired. On the grid, before anybody has moved, the humans are
  listed last.

Events the game reacts to: `countdown`, `go`, `gate`, `lap`, `finish`,
`retire`, `offCourse`, `wrongWay`, `respawn`, `raceOver`.

## 7. Bots

Each bot aims at a point `12 + 0.6·speed` metres ahead on a racing line that
passes each mark 7.5 m wide of it (holding that offset for 15 m either side of
the mark and swapping sides in between), plus its own offset:

| bot | power cap | pace | line offset | wobble | steering gain |
| --- | --- | --- | --- | --- | --- |
| 1 | 5 | 0.958 | 0 | ±0.6 m | 2.5 |
| 2 | 4 | 0.968 | −4.2 m | ±1.0 m | 2.2 |
| 3 | 4 | 0.945 | +4.2 m | ±1.4 m | 2.0 |

- `pace` multiplies top speed. A bounded catch-up adds `gap / 6000` to it
  (−0.025 … +0.045), `gap` being metres behind the best human.
- A boat up to 14 m ahead and within 3.3 m sideways pushes the aim 4.2 m to
  the other side.
- The aim is never allowed onto the wrong side of the next mark (at least
  4.2 m clear of it).
- A sliding boat is not going where it points, so 75 % of its slip angle is
  added to the heading it steers for.
- Heading error over 1.1 rad: throttle 0.35; over 0.8 rad at more than
  12 m/s: brake.
- Running wide (moving outward at `o` m/s with less than `2.5 + 1.6·o` m to
  the floats): throttle 0.45, and brake inside `1.5 + 0.8·o` m.
- Under 2.5 m/s for 3.5 s: put back on the line.

An autopilot of the same kind drives a player's boat with `?ap`, in tests,
and after that player has finished. Where several humans race, each one's
autopilot keeps a lane of its own (±2.3 m in split screen; −3.6, −1.2, +1.2,
+3.6 m by seat online), or they would all want the same water.

## 8. Camera

Chase pose, relative to the boat:

| | landscape | portrait |
| --- | --- | --- |
| distance behind | 6.3 + 0.7·k | 7.4 + 0.7·k |
| height above its lazy height | 1.7 | 1.9 |
| looks at a point | 7 m ahead, 0.2 m up | 7 m ahead, 0.3 m up |
| field of view | 54° → 64° with k² | the same horizontal view as 4:3 would have, at most 96° |

`k = speed / 28`. Yaw follows heading plus 55 % of the angle to the direction
of travel, at 4.6 /s. Height follows at 3 /s (1.6 /s in the air) and is kept
within −1.0 … +0.45 m of the boat. The lens never goes below the water at its
own position plus 0.75 m. Roll follows yaw rate and hull roll a little. Bumps
and landings shake it.

Orbit pose (title, after the flag): a circle of 10.5 m (13.5 m in portrait)
round the boat, 0.22 rad/s. The two poses blend over about a second.

## 9. Controls

| | keyboard (solo) | split screen P1 / P2 | touch |
| --- | --- | --- | --- |
| steer | ← → or A D | A D / ← → | first finger down becomes a stick; ±62 px is full lock |
| throttle | ↑ or W | W / ↑ | automatic (off while braking) |
| brake | ↓, S or Space | S / ↓ | pull the same finger down (dead zone 26 px, full at 70 px), or hold a second finger |
| start | Enter or the button | the button | the button |
| sound | M or the link | | the link |

The stick's origin trails the thumb once it is dragged past full lock, so a
change of direction answers at once.

## 10. HUD and panels

All DOM, one set of readouts per view: position, lap, race time, the next
mark's side, standings, speed, power pips, miss dots, minimap, a toast line,
and (in multiplayer) a name tag over every other boat with place and, online,
ping. Tags are placed by projecting a point 2.05 m above the boat; hidden
behind the camera or beyond 170 m; bunched tags step upward.

Panels: title (Start race · 2 players · 2–4 players online), results (times,
Race again, Back to menu), and the online lobby (name, seats, host or join,
invite, reply).

## 11. Sound

Web Audio, synthesised. Per local player one *voice*: two sawtooths (×1 and
×1.503) and a square (×0.5) through a low-pass, plus looped noise through a
band-pass for the water.

- Engine note: `(41 + 106·revs) Hz`, `revs = 0.16 + 0.5·throttle + 0.34·k`,
  +0.22 in the air. The second player's engines run 7 % higher.
- Low-pass opens with revs (`260 + 1900·revs²` Hz); water noise brightens and
  swells with speed and fades with grip.
- In side-by-side split screen each voice, and that player's cues, are panned
  to their half. Start signals are centred.
- Cues: count (440 Hz), go (880 Hz), clean pass, full power, miss, lap,
  finish, splash (noise burst plus a thump for hard ones).
- Master gain 1.2 into a limiter (threshold −8 dB, ratio 12).

## 12. Effects

- **Wake field**: a 1024² texture (512² on phones) covering 176 m round the
  view's boat, redrawn every frame. Red: churned water. Green: boats'
  shadows. Blue: how fresh the churn is. Each boat leaves a trail of up to 76
  points, one every 1.9 m, lasting 6.5 s, widening from 1.05 m to 4.65 m
  half-width.
- **Spray**: 2200 point sprites (1500 on phones), 1.5–11 px.
- **Mist**: 420 soft puffs (220 on phones), up to 300 px (150 px), for the
  plumes at speed and the cloud after a landing.
- **Rain on the lens**: one number per view, `wet` (0 dry … 1 soaked), plus
  `sheet` for the second after a hard landing. It rises by `0.05 /s` at speed
  (`0.085` in a full slide), by `0.34 /s × (1 − behind/18) × (1 − side/3.4)`
  in another boat's plume (2–18 m astern of it, within 3.4 m of its line), by
  `0.02 + 0.22·strength` on a landing and `0.06 + 0.2·strength` on a bump. It
  dries at `(0.09 + 0.12·speed) × (0.35 + wet)` per second: soaked glass
  clears in about 6 s at speed. Drops run down the glass below 28 km/h and
  are blown outward above 70 km/h. Above `wet` 0.45 the glass mists over
  except where a drop has just passed.
- **The finish** (desktop only): glow from what is brighter than 0.8 of white
  (taken at half size, spread over three widths), sharpening of soft detail
  (not of hard edges), 8 % more colour, a gentle S-curve, corners 16 % darker.
- **Sun shadows on boats**: one 2048² map (1024²) over a 52 m (40 m) square
  that follows the view's boat.
- **Sun shadows on land**: one map per island, drawn once (2048² for the main
  island, 1024² for the islets; half that on phones). Land, palms, the pier
  and the lighthouse cast into it; land and palms read it.
- **Palms**: 44 on the main island, 11 on the sand islet. Each has 22–26
  fronds of 7 segments and a 9-ring trunk, about 930 triangles. The three
  islands themselves are 20 000 triangles. They lean
  0.1 m with the wind and up to 0.3 m in gusts at the crown; fronds bob
  ±0.13 m at the tip.

## 13. Drawing a frame

In order, per frame:

1. **Reflection map**: one face of a 256² cube (128² on phones, and only every
   other frame), from the first view's boat, with that boat, the spray and the
   mist left out and the sea swapped for a low-detail stand-in.
2. For each view:
   1. wake field texture round this view's boat;
   2. sun shadow map round this view's boat;
   3. **water mirror**: the scene without sea, sky, spray and mist, from a
      camera mirrored in the plane at the height of the water under this
      view's boat, at 0.5 scale (0.4 on phones);
   4. the view itself, into its viewport;
   5. the lens: the view is copied to a texture, its highlights are drawn at
      half size into a second one, and one full-screen pass puts back the
      picture with glow, sharpening, grade and, if the glass is wet, rain.
      On phones this happens only while the glass is wet, and without the
      finish.

A solo frame is about 165 draw calls and 640 000 triangles; split screen about
285 and 1 030 000; a phone, with its coarser sea, about 135 and 470 000. (The
island and its 55 palms are about 70 000 of those, drawn again in the water
mirror.)

**Resolution.** Pixel ratio is the device's, capped at 2. On a desktop whose
screen has fewer than 1.5 device pixels per CSS pixel the picture is drawn at
1.5× anyway (less on a big window: never more than about six million pixels)
and the browser scales it down, which is where the "4K" crispness on an
ordinary monitor comes from.

**Giving ground.** The extra resolution is a luxury: it is given back as soon
as sixty frames a second cannot be held with it (frames longer than 1/55 s
adding up to 1.2 s, faster frames paying that back at twice their length),
and nothing else is given up until it has gone.
After that, if frames take longer than 1/42 s for 75 frames, the game takes a
step down (at most two):

| step | resolution | given up |
| --- | --- | --- |
| 1 | × 0.82 if above 1 | water mirror, sun shadows |
| 2 | × 0.82 again | reflection map (boats mirror a plain sky), the lens pass |

Fixed `?dpr=` turns this off.

## 14. Online play

Two to four players, each on their own device. No game server.

**Joining.** WebRTC with manual signalling. The host makes an *invite* (an
offer) and sends it as a link `…#join=CODE`; the guest opens it, gets a
*reply* (an answer) and sends that back; the host pastes it in. A code is
`BW1<c|u>.<base64url>.<7-character check word>`: the session description,
deflated when the browser can. ICE candidates are gathered for up to 3.5 s
before a code is shown; a connection must come up within 25 s. STUN:
`stun.l.google.com:19302`, `stun.cloudflare.com:3478`. No TURN.

**Topology.** A star. Each guest is linked to the host only, by two data
channels: one reliable and ordered (lobby, start, results), one unreliable
and unordered (positions). The host passes each guest's reports on to the
others. The host has seat 0; friends take seats 1–3 in the order they join;
bots fill the rest and are simulated by the host.

**Messages** (`k` is the kind):

| from → to | kind | carries |
| --- | --- | --- |
| guest → host | `hello` | protocol version, name |
| guest → host | `name` | a changed name |
| guest → host | `ping` | its clock |
| guest → host | `rtt` | its measured round trip, for the others' name tags |
| both | `s` | race number, groups of `[time, [boat states…]]`, progress |
| guest → host | `bye` | leaving |
| host → guest | `version` | "you need to reload" |
| host → guest | `welcome` | protocol version, seat |
| host → guest | `roster` | seat, the four seats |
| host → guest | `pong` | the guest's clock back, the sea clock |
| host → guest | `start` | race number, when, the roster |
| host → guest | `left` | a seat that emptied |
| host → guest | `lobby` | back to the lobby |

Protocol version **3**. A guest on another version is told to reload.

**Clock.** Everyone reads one *sea clock*, the host's. A guest estimates the
offset from ping round trips (keeping the fastest), sets it in the lobby, and
trims it by a few milliseconds per ping during a race. While a link is up the
clock is tied to real time: a machine that drops frames loses ground on the
water, not time on the clock. The countdown is announced 0.9 s ahead as a time
on that clock.

**State.** 20 reports a second. Each machine simulates only its own boat (the
host also the bots). A remote boat is drawn where it should be now: its newest
report coasted forward on its speed and turn rate (by at most 0.3 s), each
correction blended in over a few frames; a jump of more than 12 m is taken at
once. Height, pitch and roll are replayed 80 ms late and set onto the local
copy of the sea. Contact with a remote boat moves only your own.

**Leaving.** A guest leaving mid-race stops where they are and the others
race on; the host leaving ends the race for everyone. After the flag the host
can start a rematch or return everyone to the lobby.

Names: A–Z, 0–9, space, `_`, `-`; at most 10 characters.

## 15. Options and hooks

Query string:

| option | effect |
| --- | --- |
| `?auto` | start the race straight away |
| `?ap` | a bot drives your boat |
| `?mode=split` | split screen |
| `?laps=1` | number of laps |
| `?dpr=1` | fix the pixel ratio (and turn adaptive quality off) |
| `?sea=0.8` | wave height multiplier |
| `?drops=0` | no rain on the lens |
| `?look=0` | no finishing of the picture (glow, sharpening, grade) |
| `?reflect=0` | no reflection map and no water mirror |
| `?shadows=0` | no sun shadows |
| `?manual` | do not run the frame loop |
| `?nodraw` | run without drawing |
| `?netlag=80&netjitter=40&netloss=5` | online: delay (ms) and drop (%) what this page receives |

The host page can set `data-online="off"` on `#game` (no online button: for
embeds that cannot open direct connections) and `data-play-url` (where the
full game lives).

`window.__bw`: `game`, `advance(seconds, fps = 60)` (step and draw),
`skip(seconds)` (step without drawing, then draw once).

Viewer: `viewer.html?asset=sea|craft|crafts|world&az&el&dist&tx&ty&tz&fov`,
plus `team`, `flat`, `sea`, `t`, `spin`, `manual` (then `__viewer.frames(n)`).

## 16. Build and publishing

`npm run build` writes a static site to `dist/` with relative paths. The
repository's workflow (`.github/workflows/pages.yml`) builds every numbered
demo folder on each push to the default branch and publishes them to GitHub
Pages; this one lands at `/ai-lab/01-breakwater-gp/`. Needs WebGL 2.
