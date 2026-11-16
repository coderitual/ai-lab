# Backlit Swan: what the build does

Read back out of the code. Where a number appears here it is in the source
file named beside it; if they disagree, the source is right and this file has
a bug. What the numbers were aiming at is in [design.md](design.md).

## Scale, axes, time

- Metres. Y is up, the water is the plane y = 0, the pond's centre is the
  origin. North is -Z, east is +X.
- The swan's waterline length `L` is 0.60 m (`assets/swan/anatomy.js`).
- Time is real time: `SIM.timeScale` is 1 (`scene/config.js`). Slow motion
  sets it to 0.25. The camera, the UI and the sound always run in real time.
- The pond is a lobed circle of mean radius 11 m (`assets/pond.js`).

## Opening

The page opens with the film: `SwanMind.playFilm()` and the Director in
`film` mode, unless the URL says `?film=0` or `?still`.

## The film (`FILM` in `scene/SwanMind.js`)

11 seconds. Headings are the film's (0 side-on facing the left of the
picture, 90 facing the camera, 180 facing right) and are read from a track of
24 keys; speed from a track of 9 keys, in L per second; the neck from a track
of 20 keys naming shapes.

| time (s) | heading | speed (L/s) | neck |
| --- | --- | --- | --- |
| 0 | 10 | 0.16 | A, the proud S |
| 0.87 to 1.17 | 23 to 28 | 0.16 | A to B: stretched tall, bill level |
| 0.9 to 1.48 | | | **the shake** rides on it |
| 1.5 to 2 | 32 to 40 | 0.16 | B to C: a straight column |
| 3.75 | 92 | 0.27 | C |
| 4.62 to 4.9 | 124 to 125 | 0.33 | C to D to E: **the dunk**, bill under at 4.9 |
| 5.7 | 127 | 0.33 | E2: head sunk to eye level |
| 5.92 to 6.4 | 129 to 134 | 0.32 | H (hovering), E again at 6.2 (the second touch), H |
| 7 to 7.5 | 148 to 155 | 0.3 | G1 to G: bowed upright |
| 8.4 to 9.9 | 167 to 171 | 0.34 to 0.22 | G to F1: **the reach**, bill under by 9.9 |
| 10.5 to 11 | 172 | 0.16 to 0.12 | F: the low arch |

- **Drips before the shake**: eight drops of 7.5 mm leave the bill tip at
  0.0, 0.03, 0.32, 0.37, 0.58, 0.62, 0.65 and 0.68 s.
- **The shake** (`SHAKE`): 0.58 s at 3.64 turns a second, the arch of the
  neck swinging ±1.45 rad about the neck's axis from 55 % of the way up it.
  About 150 beads of 3 to 5.2 mm leave the bill tip sideways, most when the
  head is moving fastest and in the middle of the shake, at 0.66 to 3.4 m/s
  (mostly near the bottom of that), between 0.3 m/s downward and 0.55 m/s
  upward, one in eight popping up by a further 0.3 to 0.9 m/s.
- **Coming out of the water**: 3 to 6 beads at once, then single drops every
  0.14 to 0.26 s (further apart as the bill dries, over about 2.5 s). After
  the film's dunk that is the string of beads under the bill until about 8 s.
- When the film ends the swan holds the reach for 1.6 s, rises, and is on its
  own.

## On its own (`scene/SwanMind.js`)

- It glides at 0.035 to 0.115 m/s on a slow winding course, and is steered
  back when it leaves an ellipse 6.4 m by 3.8 m centred 0.7 m south of the
  pond's centre (`HOME`): the sunlit water in front of the wood's shadow.
- Its neck settles into a shape that wanders between the film's A, C and G.
- Every 5 to 11 s it does something: with a wet bill, 60 % of the time it
  shakes; with a dry one it dunks (40 %), reaches (22 %) or looks round
  (the rest).
  - **Dunk**: down in 0.3 s, under for 0.7 to 1.5 s, hovers, half the time
    touches a second time, rises in 0.6 s.
  - **Reach**: 1.5 s down, 1.2 to 2.6 s feeding with the body all but
    stopped, 2.7 s back up.
  - **Shake**: 0.3 s up to B, the shake, back down over about 2 s.
  - **Look**: the head turns 0.5 to 1.0 rad to one side for 1.6 to 3.2 s.
- **Called** (a touch on the water): it swims there at up to 0.5 m/s, turning
  faster than usual, stops with its bill over the place, and reaches.
- A request made while it is busy waits; only the latest is kept.
- What it does to the water: a small dent at the breast every 4.5 cm
  travelled (strength 0.0005 plus 0.004 times the speed in m/s; the churned
  water behind the tail comes from `assets/pond/surface.js`, from the body's
  movement alone); a dent where the bill enters and leaves;
  small ones every 0.11 s while the bill is under; a slow breath of a ripple
  under the body every 1.4 s.

## The camera

- **The film's operator** (`scene/Director.js`) stands where the default view
  puts the camera: 5 m from the pond's centre, 10 degrees up, looking north
  (`CAMERA` in `scene/config.js`), and aims at the swan from there, the aim
  trailing the swan slightly. From 3.5 s they lean in: 0.35 m by 7 s, 0.75 m
  by 10.5 s. The field of view is 28 degrees for a square picture of the same
  area as the real one: about 37 degrees top to bottom on an upright phone.
- The swan sits 24 % of half the picture below the middle and 10 % right of
  it on an upright screen; 44 % below and 4 % right on a wide one.
- **Yours**: the moment the camera is dragged, pinched or wheeled it is in
  `free` mode and circles the swan, following it. Dragging turns 0.22 degrees
  a pixel round and 0.14 up and down, with a coast that dies away; limits are
  2 to 35 degrees above the water and 2.2 to 9 m away, never lower than 12 cm
  above the surface. Left alone for a few seconds it sways by 0.35 degrees.
- **Views** (`VIEWS`): film, low, close, high, meadow. Double tap or `1`
  returns to the film's view.

## Touch

- A tap on the water lets a drop of 11 mm fall there from 0.55 m and calls
  the swan. Taps on the bank, the sky or within 1.5 m of the shore do
  nothing.
- A tap on the swan (within 0.3 m of its body or 0.12 m of its head) makes it
  shake.
- A single tap waits a third of a second to be sure it is not the first of
  two.

## Keys

`S` shake, `D` dunk, `R` reach, `F` the film again, `1` to `5` views, arrows
move the camera, `+` and `-` closer and further, `T` slow motion, `M` sound,
`H` hide the controls.

## The look (`LOOK` in `scene/config.js`)

| | value |
| --- | --- |
| Sun | 14 degrees east of north, 32 degrees up; linear colour 4.2, 4.0, 3.6 |
| Sky fill | 0.1, 0.2, 0.33 |
| The wood's shadow | begins 1.6 m from the pond's centre toward the sun, soft over 0.9 m, wandering by 0.5 m |
| Aperture | 0.08 of a blur disc of 3.4 % of the picture height; the mirrored far layer is blurred by at least `mirrorSoftness` 0.3 of it |
| Glow | strength 0.22, no threshold |
| Tone | exposure 1, toe 0.008, shoulder 3 |
| Print | 1 (the measured curve, `printCurve` in `engine/PostChain.js`) |
| Vignette, grain, chromatic aberration | 0 |

The look panel's sliders write `sunAzimuth` (-60 to 90), `sunElevation` (16
to 62), `aperture` (0 to 1), `bloomStrength` (0 to 0.6), `exposure` (0.4 to
2.2) and `print` (0 to 1); Reset puts back the values above.
Under the sliders: the views, the quality chips, Reset, one line of small
print (tier, size of the scene target, frames a second) and a second naming
the paths this device took (GPU string, half-float or 8-bit, multisampling,
ripple precision, pixel ratio, render scale, and any WebGL error from
start). On a screen with a mouse it also lists the keys.

## Quality tiers (`TIERS` in `scene/config.js`)

Chosen by a probe of the device (`engine/caps.js`) or by `?q=`.

| | low | medium | high |
| --- | --- | --- | --- |
| pixel ratio cap | 1.5 | 2 | 2 |
| canvas pixel budget (the ratio is lowered to fit; a forced `?dpr=` is exempt) | 1.2 million | 2.2 million | 4 million |
| multisampling | none | 4x | 4x |
| far layer, far mirror, swan mirror (share of the picture's size) | 0.4, 0.25, 0.5 | 0.5, 0.3, 0.75 | 0.5, 0.4, 1 |
| bloom levels | 5 | 6 | 7 |
| ripple texture | 256² | 384² | 512² |
| water detail | 0 | 1 | 2 |
| specks | 7000 | 13000 | 16000 |
| leaves, trunks | 4800, 80 | 9000, 140 | 13500, 220 |
| drops in the air at once | 192 | 384 | 768 |
| swan detail | 0 | 1 | 2 |

If frames run long for a while the off-screen targets shrink in steps (1,
0.85, 0.72, 0.6, 0.5) and grow back when there is room (a browser-held rate such
as 30 fps in Low Power Mode is recognised and not chased); see
[engine.md](engine.md).

## Sound (`audio/Ambience.js`)

Off until switched on. A bed of low-passed noise, a band of leaf noise that
swells and fades, a band of lapping water, a short falling tone for every
drop that lands (higher for small drops, at most ten at once), and a soft
burst when the bill enters or leaves the water.

## Messages

- While loading: "Loading…".
- If WebGL 2 cannot start: "This device could not start WebGL 2. Try a recent
  version of Safari or Chrome."
- If a shader does not compile: "This device’s graphics driver refused a part
  of the picture." with the driver's own log in small print.
- If the WebGL context is lost and not restored within 3 s (page visible):
  "The picture was lost. Tap to load it again." A tap reloads the page.
- Hint under the title until the picture is first touched, or for 14 s: "Drag
  to look round · pinch to come closer · touch the water" (with a mouse:
  "scroll" and "click").
