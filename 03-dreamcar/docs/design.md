# Dreamcar: design

What this demo is meant to be. The numbers here are targets; what the build
actually does, number by number, is in [spec.md](spec.md). When the two
disagree, decide which is wrong and fix that one.

## The demo in one paragraph

A silver saloon, a racing circuit and a clock. You drive a current
Mercedes-Benz C-Class (the W206 saloon in AMG Line trim, modelled in code from
photographs of one particular car, in a hot dream tune) round a five-kilometre
circuit in the mountains by a lake: a lakeside straight, fast esses through the
woods, a lit tunnel, a road on piers across the valley, a slow carousel, a
crest, a plunge, a ledge, a second bridge and a long right back to the shore.
Three laps against the clock, alone or against a friend in split screen. The
same circuit exists three times: on a sunlit autumn afternoon with the sun
straight down the start straight, at golden hour, and on a wet night after
rain, when the picture is made of lamps and their reflections in the asphalt.
It plays in a browser with a keyboard, a gamepad, or thumbs on a phone.

It is an original demo. Two things were looked at for what "good" looks like
and never for names, tracks, interface or art: an old open racing sample (the
shape of the thing: a fast road with rails rising into the sky on columns, a
chase camera, big readable figures, streaks of speed and glow) and a console
racing simulator (how a car should sit in the frame, how a circuit is lit by
a low sun, what autumn trees and a wet road look like). Five frames of the
owner's from them are the spec for the look (below, "The reference frames");
they stay out of the repository. The car is an unofficial model made out of
enthusiasm for the real one; this project is not affiliated with its maker.

## What it is built round

1. **The car is the picture.** The camera sits low and close behind it, so
   most of what you look at is paint, glass, lamps and tyres. The model has to
   survive that: correct proportions, a paint that mirrors the trees going by,
   lamps that are objects with depth and not red rectangles, wheels that
   steer, spin and ride on springs, a body that rolls and squats.
2. **Light is the subject.** The times of day are not a tint. By day: one
   low sun straight ahead, its glare on the asphalt, hard shadows, haze in the
   valleys, a sky the paint reflects. At golden hour: level orange light on the
   crowns and the gantry, the road in long shade. By night: the wet asphalt
   mirrors the lamps, the car's low beam has a shape and a cut-off, the edge
   lines' glass beads answer it, the tunnel is lit, and the exposure opens up
   the way eyes do.
3. **It drives like a car.** A rigid body on four sprung wheels with tyres that
   have a grip limit, an engine with a torque curve and an automatic gearbox,
   rear-wheel drive, weight transfer you can see. The assists a real car has
   (ABS, traction control, stability control) keep it drivable from a keyboard
   and can be felt working, not hidden.
4. **Playable wherever you are.** Keys, a gamepad, or one thumb on a phone;
   two players on one screen with one keyboard, two gamepads, or the two
   halves of a tablet.
5. **Made of code.** No model, texture, font or audio files, and nothing
   fetched at run time. The body is lofted from curves, the asphalt is noise,
   the engine note is synthesised. Every asset can be changed by changing a
   number.
6. **Room to grow.** Weather is the obvious next step, so the road already
   has a wetness (used today only by the night, as a look), the lighting is one
   table per time of day, and the sky, fog, lamps, wetness and exposure all
   come from that table.

## The car

The real thing, as the ruler for the model (W206 saloon):

| | |
| --- | --- |
| length / width (body) / height | 4.751 m / 1.820 m / 1.438 m |
| wheelbase | 2.865 m |
| track front / rear | 1.582 m / 1.594 m |
| tyres (this car's 19-inch wheels) | 225/40 R19 front, 255/35 R19 rear |
| kerb weight | about 1 650 kg |
| engine | 2.0 l turbocharged four, 190 kW, 400 N·m, 9-speed automatic, rear-wheel drive |
| 0–100 km/h / top speed | about 6.0 s / 250 km/h (limited) |
| **the demo's tune** | 640 N·m, 365 kW; 0–100 km/h 3.9 s, 0–200 12.1 s, 284 km/h (limited); about 1.26 g at 90 km/h, a little downforce above that; 100–0 in 28 m |

The particular car: high-tech silver metallic, AMG Line (star-pattern grille
with one horizontal blade and the large star, sport bumpers with black
intakes, chrome twin tail-pipe trims in a black diffuser), black mirror caps,
dark tinted rear glass, a black panoramic roof, 19-inch five-twin-spoke
wheels in black with machined faces, and the two-piece tail lamps of this
generation. What must read from the chase camera, in order: the stance and
silhouette, the tail lamps and their light signature, the rear screen and
roof, the bumper with its diffuser and tail-pipe trims, the wheels, the
mirrors. From the front (title screen, staged pictures): the grille, the star,
the head lamps with their daytime running "eyebrow", the bonnet's two power
domes.

It carries a number plate. By default the plate is a made-up one
(`DRIVERS` in game/config.js); `?plate=` puts another text on it.

A second car, in a different paint, is the second player's.

## The road

A racing circuit, not a public road: 5.14 km, driven clockwise, 108 m between
the lake shore and the top (110 m above the water). Paved 12 m wide (three
lanes, `HALF_WIDTH` 6), a 1.2 m strip beyond each edge line that is a red and
white kerb in the bends and a paved margin elsewhere, then mown grass 3 to 10 m
wide (widest on the outside of the fast bends) to a barrier: a steel rail by
default, a low concrete wall along the lake side of the start straight and
beside the pits (the rest of the land side is a rail), rock where the road is
cut into the hill, parapets on the bridges, the walkways' kerbs in the tunnel. Trees stand
behind the barrier, never as it.

How the ground is drawn (src/assets/world): the asphalt (road.js) is
dark, fine racing asphalt with a polished, darker racing line and rubber in
the bends and the braking zones (corridor.js), runs of surfacing of different
ages with joints, the paver's seams 2 m either side of the middle, a few
patches and sealed cracks, tyre marks before the carousel (roadHistory.js);
its markings are a solid white line inside each edge (0.28 m), the start line
and twelve grid boxes from `track.grid`, nothing else. A second, anisotropic
specular lobe stretched along the line of sight lays the low sun's glare on it
as a long streak (`ASPHALT_SHEEN`). The kerbs (kerbs.js) are red and white
painted concrete, one colour per tooth, on `track.kerbs`, exactly on
`track.profile()` (on low, rows at every second tooth top). Beyond the margin
the terrain's band carries the verge: mown stripes 1.6 m wide, a ragged strip
of worn earth along the kerbs, longer grass at the barrier, with tufts of
three crossed cards standing in it on medium and high. All grass (meadow,
verge, tufts, bushes, the wood's floor) is one early-autumn olive green
(`GRASS` in groundMaterial.js), a little less saturated than the trees, and
lets through against the low sun two to three times the light it reflects: brighter,
never neon. The kerbs' white paint is beaded and sparkles in the car's head
lamps (retro.js), as the road's lines do. Barriers: two
stacked W-beams on posts (one beam where trackside panels stand behind it;
set back behind tyre walls; a reflector painted on the upper beam over every
fourth post, which blazes in the head lamps at night), low concrete walls 0.93 m high on the straight
(walls.js, precast blocks painted white and teal), cut faces of bedded
limestone where the edge is rock. Viaduct piers are slender eight-sided
shafts under flared capitals; the short bridge spans a V-shaped gully across
it with a stream's notch. Gradients up to 8 per cent; banking by rule
from the curvature (up to 9 degrees) and per piece, up to 10 degrees on the
sky road and the first bend of the ledge. The numbers by stretch (s from the
line, m; speeds are the autopilot's at full pace):

| stretch | s | what it is |
| --- | --- | --- |
| Lakeside straight | 4686 to 250 | 700 m, level, along the shore (the line 450 m along it); lamps every 30 m on alternating sides; 225 to 279 km/h |
| Shore bend | 250 to 657 | a banked right of 220 m radius (9 degrees) away from the water, starting to climb; about 200 km/h |
| Forest esses | 657 to 1409 | right 260 m, left 330 m, right 240 m, climbing at 5 to 6 per cent; 205 to 240 km/h |
| The tunnel | 1409 to 2006 | a rock cutting faced in concrete at its end, the lit box (1479 to 1828, 349 m, bending right at 1000 m radius) and a cutting out between retaining walls with acoustic screens; up to 255 km/h |
| The sky road | 2006 to 2582 | on piers: a 576 m left of 300 m radius, banked 10 degrees, the valley 42 m under its middle; about 230 to 257 km/h |
| The carousel | 2582 to 2915 | a 150 m climb, then 190 degrees right round a spur at 55 m radius, banked 8 degrees: the only heavy braking of the lap, 90 km/h |
| The crest | 2915 to 3115 | the top (108 m), in the open, the sea far below on the left; the car goes light over it at about 160 km/h |
| The plunge | 3115 to 3394 | 8 per cent down a 400 m right into a compression; to 215 km/h |
| The ledge | 3394 to 3778 | a left of 300 m and a right of 350 m on the hillside, rock on one side; 216 to 257 km/h |
| Gully bridge | 3778 to 4115 | 337 m straight on piers, 26 m over the gully, 8 per cent down; to 282 km/h |
| The long right | 4115 to 4686 | 90 degrees at 300 m radius, banked 9 degrees, onto the straight; 234 to 283 km/h |

The autopilot laps in 85.1 s at full pace (217 km/h on average), 92.9 s at
0.9, 117.1 s at 0.7. Sector lines at 1882 m (just out of the tunnel) and
3420 m (the start of the ledge).

The Track says where everything of a circuit goes, as data the world reads
(`src/game/track.js`, header): kerbs, what grows behind each barrier, tyre
walls on the outside of the fast bends, runs of trackside boards, distance
boards before the carousel, marshal posts, the start gantry. Road furniture is
drawn from scratch and carries no real names or words: the circuit is called
Calvenna, and the boards advertise made-up firms (Varno, Torvel, Miralta,
Brennik, Oskali, Lundar, Pellora, Arvent, Solmere) with simple abstract marks,
in the project's own letters (`src/assets/world/signs.js`): a heavy display
face of capitals built from filled shapes on each letter's box (stems,
bands, rounded rings), so that every letter is the same height, the ends of
the diagonals are cut level and the points of A, V and W are flat; digits
keep the plate's stroke letters.

The start (`src/assets/world/dressing.js` gathers it): a steel truss on two
lattice towers across the line, the circuit's name board on both faces, and
under its middle five columns of four hooded lamps, the lower two red for the
count, the upper two green for four seconds after lights out. On the land side
behind the wall a catch fence, a pit lane and a two-storey pit building
(garages, a glazed floor lit at dusk and at night, a roof terrace under a
canopy carrying the name); on the lake side a covered stand. Along the lake
side of the straight one run of tall hoardings (3.8 m panels, tops near 5 m),
broken only by the stand and the gantry's tower; the land side stays open
(grass, the barrier, the pits). Past the pit exit a short tyre wall with low
boards on a low wall behind it. At the far end of the straight a footbridge
carrying boards, a marshal's tower, and on the outside of the first bend a
small stand and distance boards 200, 150 and 100. Low boards along the bends,
tyre walls, distance boards before the carousel and marshal huts come from
the Track's data; nothing stands inside the solid edges. Past the end of the straight a town
climbs the slope beyond the shore bend with a church tower and a large pale hotel on the height; a hamlet
lies on the far shore of the lake (`town.js`, on `facade.js`'s houses).

## A run

- **Title.** A hero picture: the car parked on the grid seen from low down
  (0.85 m) at a front or rear three-quarter view, 8.6 m out through a 34°
  lens, swinging slowly to and fro. Of the four three-quarter views it takes
  the one whose look runs beside the brightest part of the sky (the sun's
  direction from the time of day's table; `CAMERA.orbit.times` may override
  per time of day), so the paint has the sky to mirror. The car is exposed
  for: `SHOWCASE` in game/config.js adds stops to the exposure on the title
  and the results (eased in and out). On a wide screen the menu is a column on
  the left and the car is framed to the right of it; on an upright phone the
  car is in the upper third and the menu is a sheet under it. The menu: Drive,
  one or two players, the time of day, Options, the best-laps board of the
  time of day showing (and the keys, on a tall desk screen).
- **The time of day it opens at** is one constant, `DEFAULT_TIME` in
  game/config.js: null, which means the first time lighting.js's `TIMES`
  holds (the day); `?time=` in the address overrides it.
- **Options** (on the title and the pause sheet): quality (auto, low, medium,
  high; kept under `dreamcar.quality`, applied by reloading the page; `?q=` in
  the address wins; auto is what the capability probe chose), sound, time of
  day, speed in km/h or mph (`dreamcar.units`), the map shown or hidden
  (`dreamcar.map`), the driving help (Full, Sport, Off; `dreamcar.assists`,
  applied to every car at once), and on touch screens the steering (slider
  or arrows; `dreamcar.steering`) and the throttle (auto or manual;
  `dreamcar.throttle`). Keys reach every button by Tab and Enter, a
  pad by its d-pad and A; touch targets are at least 44 px (the driving
  buttons 64 px and more).
- **Controls, each device as if it were the only one.** Keys: W A S D or the
  arrows, Space the handbrake. Pad: triggers, left stick, A or RB the
  handbrake. Touch (a phone upright or on its side, one thumb each side):
  fixed controls that never move. At the bottom left a steering slider: a
  track with its centre marked; the steering is how far the thumb is from
  that centre, so a thumb landing off it steers at once and the knob springs
  back when it lifts (or, as an option, two arrow buttons that steer as keys
  do). At the bottom right the pedals: BRAKE, DRIFT (the handbrake) above
  it, and with the throttle on manual GAS in the corner. Power does not
  depend on touching the steering: on auto (the default) the car drives by
  itself from the green light and lifts only while BRAKE or DRIFT is held; on
  manual only GAS drives. Nothing else on the screen drives the car. The
  controls are outlined and named on the first touch run. In split screen
  each half has all of it, laid out for the half. (This replaced a floating
  stick whose centre followed the thumb, with the power on only while the
  steering was touched: the owner, on an upright iPhone, found both wrong.)
- **A slide is seen and counted.** While the car slides beyond 12° its angle
  and a running score show just above the speed, fading a second after; the
  best slide of the run is on the results. The chase camera keeps nearer the
  way the car is going while it slides, so the car is seen yawed and the road
  ahead stays in view, and opens its lens a little. The rear tyres mark the
  road and trail a thin smoke in a held slide on dry asphalt, and throw more
  spray on a wet one (`FX.slide…`).
- **Start.** On the one race clock: the camera dives from 16 m up, 34 m behind
  and 9 m to the side onto the car's tail while the gantry's five lamps come
  on, and is settled in the chase view as the last one lights; the hold, then
  lights out, go. No cut and no jump at go. While it dives the shutter is cut
  to a quarter.
- **Three laps.** Each lap is cut into three sectors; crossing a sector line
  flashes the gap to your best lap large at the top (green ahead, amber
  behind). On screen throughout, and nothing else: the lap n / N, the lap
  clock with the live gap beside it and the best lap under it (top left); the
  next time to beat, as one line (top right; in split screen the place and
  the gap); the speed in large figures under a rev arc with the gear above it
  and the lamps of ABS, traction and stability control under it (bottom
  right); a small map that can be hidden (bottom left); on touch screens four
  small buttons (camera, lamps, put back, pause) together under the time to
  beat, and the bottom corners left to the thumbs' controls (the speed moves
  to the top middle, or above the steering on an upright phone). The best-laps board is on the title, the pause sheet and the results,
  not on the run. A faint ghost of your best lap drives with you.
- **Results.** Lap times, the best lap, a medal against three target times,
  and the five best laps set on this device for that time of day; the camera
  orbits the car, framed clear of the panel.
- **Two players** race each other over the same three laps, each in half the
  screen, and can lean on each other.

Leaving the road costs grip, not the race. A car that ends up facing the wrong
way, stuck, or on its roof can be put back on the road (a key, a button; after
a few seconds it is offered).

## How it should feel

- **Grip first, then a warning, then a slide.** Tyres squeal before they let
  go, and what is left beyond the limit is nine tenths of the grip, not a
  cliff. Lifting off tightens the line.
- **It turns in the moment it is asked, at any speed.** A key, a stick or a
  thumb reaches nine tenths of its turn in about a fifth of a second at 80 and
  at 250 km/h without darting: the lock shrinks with speed, and at speed the
  rear wheels steer a little with the fronts.
- **Arcade, with the look of the real thing: the car can be slid.** Thrown
  into a bend on the brake or off the throttle with the steering hard over,
  with a dab of handbrake, or booted out of a slow corner, the tail steps out.
  The slide holds on the throttle for as long as the driver steers into the
  bend (the steering picks the line; the front wheels are turned to where the
  car is going for them), keeps its speed, and comes back in about a second
  when the steering is let go, without a swing the other way. Three levels of
  help (`ASSISTS` in `src/game/config.js`): **Full**, the default and what a
  phone gets, holds about 20 degrees and cannot be spun short of insisting;
  **Sport** holds 25 to 35 degrees and still catches the car; **Off** is the
  bare car with ABS.
- **Weight.** The nose dives under braking and lifts under power; the body
  leans on the outside wheels; kerbs and the verge come through the springs.
- **Speed is seen, not only read.** The lens widens, the camera drops back,
  the roadside streaks while the car stays sharp, the camera shakes with the
  surface, and kerbs, boards and barriers go by.
- **The camera shows the slide.** It follows where the car is going more than
  where it points, so oversteer looks like oversteer.

## The camera

- **Chase (default):** composed, not just placed (game/Cameras.js `_chase`,
  numbers in `CAMERA.chase`). On a level road the horizon lies 37 % of the way
  down the picture and the middle of the car 60 %; the camera's height follows
  from those, so the road ahead shows over the roof at every lens. The lens
  opens from 58° to 72° (top to bottom on 16:9) and the camera drops back
  1.5 m (from 5.4 m behind the car's origin) as the speed signal rises from
  70 to 270 km/h, eased over 0.6 s so a gear change does not pump it. The car
  is then about 17 % of a 16:9 picture's width at 255 km/h (its box; measured
  with the page handle), larger when slow. It swings round late into bends
  (3.4 /s) and looks into them; the picture rolls with 40 % of the road's
  banking; height and grade are followed lazily, so over the crest and
  through the compression the picture lags a little. A fine shake above
  200 km/h, more on kerbs and the verge, a knock on impacts. It never goes
  through a barrier, the ground or the tunnel's roof. On a picture narrower
  than 4:3 (an upright phone, a side-by-side half) the lens keeps a 4:3
  picture's width of view, the camera backs off a quarter and the horizon
  rises to 30 %; on one wider than 16:9 (a stacked half) it keeps a 16:9
  picture's width.
- **Far chase** (9.5 m, 54° to 66°), **bonnet** (62° to 74°) and **bumper**
  (66° to 78°) views, changed with a key or a button; **look back** while a
  key is held.
- **Title**, **start** and **results** cameras as above.
- **Speed.** The shutter opens with speed (`VIEW.motionBlurSlow` 0.12 at rest
  to `VIEW.motionBlur` 0.9 of a sixtieth at 70 m/s, eased by the 1.5th power),
  so at 80 km/h the roadside is nearly crisp and at 250 km/h it streaks while
  the car, held sharp by the engine, does not.

## Staging stills

For comparison stills (and the repository's screenshot tool) the page handle
has a staging camera: `__dreamcar.photo({ back, right, up, yaw, pitch, fov })`
puts every view's camera `back` m behind, `right` m right of and `up` m above
its car's origin in the car's own level frame, turned `yaw` degrees left of
the car's heading and `pitch` degrees up, with a lens of `fov` degrees top to
bottom (as given, whatever the picture's shape); the HUD is hidden unless
`hud: true` is given; `photo(null)` ends it. The same in the address:
`?photo=back,right,up,yaw,pitch,fov[,roll]` (`roll`: degrees the picture leans clockwise; add `,hud` to keep the HUD), so that
`node tools/shot.cjs --url "…?manual&auto&ap&t=20&photo=4.5,2.2,0.9,22,1,46"`
needs no `--eval`. It reads nothing but the car's pose: with `?manual&t=…` it
is the same picture every time. The reference frames' cameras are named
places (`PHOTOS` in game/config.js): `?photo=d1` (the run-up to the line,
day, t 100 s), `?photo=d3` (the ledge's first bend, day, t 78.8 s),
`?photo=d4` (the grid at golden hour, t 5.5 s, just after the lights go out: the lamps show green) and
`?photo=e1` (frame E1, strict spec for the coast stretch: day, t 64.9 s, the car coming out of the carousel,
the camera on the crest looking back at it; a `roll` of 7 degrees tilts the horizon as the frame's does); a name
brings its own moment of the autopilot's run and its time of day unless the
address gives `t` or `time`, and also works on the handle
(`__dreamcar.photo('d1')`). The camera moves with the car, so the engine's
motion blur streaks the roadside at the moment's speed while the car stays
sharp. The reflection probe needs a few drawn frames to fill: stage stills
with a short `advance` after loading.

## The look

- Linear HDR frame, filmic tone curve, bloom from real brightness (lamps are
  hundreds of times brighter than paint), camera and object motion blur with
  the car held sharp, a slight vignette and grain. No effect that is not also
  on a real camera.
- **Day** (references D1, A; the owner: "the whole exact screenshot"): the
  sun 16° above the horizon, 3° right of the start straight's heading, i.e.
  straight down the road (lighting.js `PLACES`, turned to the Track's heading
  by `placeLights`): the chase view drives into it, its glare lies along the
  asphalt, shadows fall straight back and a little left. A deep blue sky, pale
  and bright at the horizon, with small lit cumulus (grey-blue bases, silver
  rims near the sun); a compact sun with a soft aureole; dry asphalt. The
  drawn sky is as bright as the frames' (pale blue, paling to the horizon);
  its light on the scene is set apart (`env.intensity` 0.6, fill 0.13), so
  that the shade stays open but deep: sunlit level ground about 2.1 from the
  sun against about 0.65 of sky and fill (about 1.7 stops); exposure 0.68,
  contrast 1.14, saturation 1.18 (picture lane: with 0.72, 0.16 and 1.06 the
  blacks of the D1 still were grey, p1 30 levels against the frame's 10; now
  18, and the sky's blue nearer the frame's). Haze in two layers: the valley haze (hundreds of metres)
  and a thin air with a 1.4 km scale height that lifts and blues the far
  land kilometres away, warmer towards the sun. A limestone massif (far.js)
  fills the background, its skyline read off D1 from D1's camera: a great
  shoulder climbing out of the frame's left edge (26° and more beyond 56°
  left of the road), a saddle at 40° left (17°), the main pyramid at 15° left
  (23.6°), the ridge falling to 13° under the sun and lower beyond; back-lit,
  blue-grey in its own shade, gullies down its face, forest and scree on its
  lower third. Exposure for sunlit asphalt, closing by about 2.5 stops inside
  the tunnel and recovering over a second on the way out.
- **Day has the sun in it.** Heading into the low sun it blooms into a soft
  glare, faint lens ghosts lie between it and the middle of the frame, never
  on the car or the road under it (medium and high), the sky
  stays blue up to it and the road shines towards the light.
- **Dusk is golden hour** (references D4, D2), late: the sun 2° up, 125° left
  of the start straight's heading, out over the lake behind the left shoulder of a car on the start
  straight. Its orange light crosses the straight almost level, so whatever
  stands on the lake side throws shadows 25 to 30 m long over the grid while
  the trees, the gantry and the buildings on the land side, and the massif,
  stand in red-orange light. Golden, never violet (render lane, after the
  owner's "small shading problems" and D4 beside our still): the sky is a gold
  haze low down paling into a clear light blue overhead, the haze the far
  land fades into is gold-brown, the sky's fill is warm, and the grade warms
  the white balance (tint 1.05, 1.0, 0.9) with rust in the shadows and gold in
  the highlights (split toning); clouds lit from below that the paint
  mirrors; the fill is low (env 0.6, exposure 4.2, contrast 1.2), so the lit crowns and the
  lamps carry the picture and the shade stays deep and warm. Dry. Lamps and
  windows are on.
- **Night:** a three-quarter moon low ahead and a little left of the start
  straight (8° left of its heading, 17° up, beside the massif, which stands as a silhouette with
  moonlit edges), enough to draw the ridges and the edges of the road; stars; the low beam reaching about
  65 m with a sharp cut-off rising to the right, high beam about 150 m; LED
  daytime running lamps always on; tail lamps red with a hot core; brake lamps
  three times brighter; cool white tunnel lamps; lit windows in the pit building and the
  towns. Exposure about 5 stops above day (lighting.js: 22 against 0.68; at 32
  the moonlit land read as dusk and anything facing a head lamp within
  30 m burnt white). Lens ghosts are off at night.
- **Night is the night after rain.** The asphalt is wet (lighting.js
  `wetness`: day 0, night 0.8; `?wet=` overrides): dark, glossy, with
  broken puddles in the wheel tracks and low spots, dry under the tunnel's
  roof. On the medium and high tiers it mirrors what stands on it through a
  planar reflection drawn per view about the road's plane under the view's
  car (engine/PlanarMirror.js; a third of the view's height on medium, half
  on high; nothing on low, which keeps the speculars): the tail lamps, the
  car, the lamps, the tree line and the sky, each light
  drawn out into a streak towards the viewer, on the thin film that covers the
  whole road as well as in the puddles; the tail lamps lie on it as two long
  red streaks (drawn by the asphalt on every tier; the low tier draws the
  nearest lamps' streaks so too). Floodlights stand round the whole lap, each
  with a visible cone of light in the damp air, and the sky is a deep blue
  that the massif stands against. The head lamps lay a cool pool
  on the road ahead through the asphalt's own backscatter (road.js), while
  their beam keeps light off what is close and high.
- A circuit has no studs and no guide posts (studs.js and posts.js place
  none). A town of about 330 lamps (high tier) lies on the lake's
  far shore and the slope behind it, mirrored in the lake, with a soft warm
  glow on the haze above it, a radio mast's red lamps and a hamlet high on
  the slope beyond (from which stretches of the new circuit it is in the frame
  has not been checked yet).
- The paint is a metallic silver under a clear coat: a sharp mirror image of
  the real surroundings over a soft, flake-sparkling base.

## The reference frames

The owner chose five frames as the spec for the look ("treat those
screenshots as spec, not suggestion"). They are kept out of the repository
and described here in words. Every change to the light, the materials or the
grade is judged by staging our still beside the frame it answers to, at the
same framing, and listing what still differs (ideas.md keeps the lists).

- **A**, from an old open racing sample, by day: a road three lanes wide with
  rails, rising into the sky on columns; a sun you cannot look at, with rays
  and a row of flare discs, in a blue sky with clouds; a hard car shadow;
  streaks of speed with the car crisp in the middle of the frame, seen from
  above its roof so that the road ahead shows; big readable figures for lap,
  time, speed and gear.
- **D1**, from a console racing simulator, by day: a deep blue sky with small
  lit cumulus; a low sun almost exactly over the road's vanishing point,
  about 15° up, with a wide soft glare; a huge back-lit limestone massif
  filling the background, blue-grey in its shade with crisp ridges; sunlit
  trees and bushes in the middle distance; dark smooth asphalt with the
  sun's glare lying on it as a long streak; on one side a low wall of dark and
  bright blocks with tall boards behind it, on the other mown grass and a
  steel barrier; long sharp shadows; glints on the paint. It is to be
  matched as a whole picture, read as a scene on our start straight.
- **D2**, the same simulator at dusk, close to a car: glossy paint and glass
  mirroring a rose and orange evening sky in detail; soft light; fine dark
  asphalt; red and white kerbs, mown grass, steel barriers; the car's lamps
  lit.
- **D3**, the same simulator, trees and speed: full broadleaf crowns, bright
  translucent green where the sun comes through, real limbs, dappled shade
  on the road; everything beside the road streaked by speed while the cars
  stay sharp; a white edge line, a grass verge, low walls with boards.
- **D4**, the same simulator, the start at golden hour: dense, rounded maple
  crowns of very many small leaves in gold, orange, yellow and red, glowing
  in low warm light, with rust in their shade and dark trunks below; a gantry
  over the road carrying columns of round start lamps; boards, a tyre wall, a
  low concrete wall; the asphalt in shade, the car's tail lamps lit.
- **E1** (sea lane; strict spec for the coast stretch, preset `e1`): a road
  winding in an S round a cut hill on a headland high above an open sea; the
  whole frame is described under "The sea".

Day answers to D1, D3, E1 and A; golden hour to D4 and D2; the wet night to two
further night references of the owner's (a wet street at night with lamps
mirrored in it). Nothing is taken from any of them but the quality, the
light, the materials, the vegetation, the composition and the sense of speed:
no names, logos, HUD artwork or layout, track shapes, liveries or lettering.
The car itself is checked against four daylight photographs of the owner's
car (car.md), which also stay out of the repository.

## The sea

(sea lane) After the tunnel the road comes out onto the coast. The owner:
"after the tunnel there is a nice part of the track where we can have a
sea; the sea and its shader are built in the repo, in the 01 project". His
reference for the look (kept out of the repository, like the others; called
E1 here): a road winding along a headland high above an open sea, deep blue
water with a long soft swell, a bright band towards the horizon and haze
into a clear sky; an ochre and rust cut slope with grass on top on the land
side, ochre gravel run-off and a steel rail on white posts on the sea side;
a viaduct on tall piers standing in front of the water; sun-bleached warm
light. Only its light, colour, materials and composition are taken.

**E1 is strict spec for the coast stretch** (the owner, round 2: "This is
strict spec"; and "give a sea view after the tunnel"): a still from the
comparison camera `e1` must read as the same picture except for the car.
Nothing of the game's content is copied (no names, logos, board lettering,
track shape). The frame, read carefully: the camera looks back along a road
that winds in an S round a hill on a headland high above the sea; open sea
fills the right half and the upper middle to a straight hazy horizon about
60 % up, tilted a few degrees, with clear pale-blue sky deepening upwards and
no land behind the water; on the left a steep hill cut for the road, a
rust and ochre face 10 to 15 m high with erosion gullies, dark at its foot,
dry olive grass and scrub above; dark asphalt with a double yellow centre
line and white edge lines, a low concrete kerb strip on the inside of the
bend; on the outside a broad apron of ochre gravel, then a steel rail on
white posts, a lip of dry grass and then the sea far below; red and white
boards at the next bend; a pale viaduct on tall slender piers standing in
the sea; a low warm sun from the left behind the camera, the hill's shadow
over the left of the road.

**Where E1 is on our course** (`?photo=e1`): the carousel, the slow right
hairpin round a spur at the head of the headland, is the bend nearest the
frame's S; the camera stands on the crest just past its exit, looking back
north at the car coming out of it on the inside lane. The hill on the left
is the spur inside the hairpin (`COAST.knoll`), cut for the road; the
apron, the rail and the sea are on the right; the boards stand round the
hairpin's outside. What our course cannot give: the sky road is behind this
camera (it runs from the climb's foot back south-east to the tunnel), so the
frame's viaduct is not in our picture; its piers stand in the sea where the
driver sees them, from the tunnel's cutting, the sky road and the climb. And
our day sun is fixed: 16 degrees up, due east (down the start straight); from
E1's camera, looking a little east of north, it stands about 80 degrees to
the left and very slightly ahead, so the cut face (facing west) is in its own
shade and the spur's shadow lies across the near road, where the frame's sun
comes from behind the camera's left and lights the face.

- **Where the coast runs** (`SEA` in terrain.js). The course stands on a
  headland. Seen from the middle of the course, everything outside the loop
  at a bearing outside the mainland's (-115° to 50°, 0° being the start
  straight's heading) is sea to the horizon: north of the tunnel's spur, round
  the sky road and the headland of the carousel and the crest, down the west
  side. The mainland with the massif and the far ridges stays east, behind
  the start straight, so frame D1 is untouched. The lake beside the straight
  is a bay of the same sea, as it was to the east and opening to the open
  water in the south-west. (Round 2: the mainland's sector ends at 24°, not
  50°, so that from the climb no far shore stands across the inlet; D1's view
  lies between -70° and -2°.) Away from the coast road the land falls to the
  water 55 to 170 m beyond the solid edge, the last of it as a cliff (rise
  1.15 per metre) of ochre rock with a dark wet band at its foot; the seabed
  shelves away at 0.3 per metre to 45 m. Seven sea stacks stand 30 to 120 m
  off the open coast. No far shore: the far ridges stand aside where the sea
  is (far.js), so the sky road and the crest look over water, haze and sky.
- **The coast road's cliff** (round 2, `COAST` in terrain.js). On the sea
  side of the coast road the land does not slope away to a shore far off:
  beyond the rail a lip of dry grass 1.5 to 4 m wide, then a cliff straight
  down into the sea (1.6 to 2.6 m down per metre out, rounded at its top, a
  talus at its foot 7 m under the water), so that open water lies some 40
  to 60 m beyond the solid edge and 85 to 110 m below the road. The land
  side is cut 4 m deep (the coast's rust face) and rises gently beyond it
  (at most 0.25 per metre), and the spur between the climb and the crest
  rises as a hill up to about 22 m over the road, along a ridge from 80 to
  230 m down the tongue from the hairpin's centre, set towards the climb.
  It is low round the hairpin itself, on purpose: the day's sun stands on
  that side 16 degrees up, and with an 11 m cut and the rock preset's steep
  hillside (round 2's first tries) the whole of E1's road and apron lay in
  its shade; now the shade covers the inside of the road at the bend's
  exit, as the frame's does. Nothing grows tall either side of the coast
  road: dry olive grass and scrub.
- **The sky road over the sea** (round 2): the deck crosses an inlet; the
  ground under its middle is 96 m down (`drop`), under the water, so its
  piers stand in the sea.
- **The low crossing and the big waves** (round 2; the owner: "after the
  tunnel it would be nice to see some sea side with BIG waves. Maybe some
  river that will be super nice to cross ... we will be very close to it").
  Between the tunnel and the gully the road is 60 to 108 m up and already
  climbs and falls at 7.5 to 8 per cent: no piece can come down to the water
  there without breaking the course's limits (the gradient, the top on the
  crest 100 to 130 m over the lake). The first place after the tunnel where
  the road comes down to the sea is the long right before the straight
  (`back`), from half way round it to near its end: 170 m with the road 2
  to 14 m over the water. There the land either side falls away (terrain.js
  `CAUSEWAY`): the road runs on a causeway, a lip of 2.5 m beyond each rail
  and a rubble bank into the water, across the mouth of a lagoon on the
  inside of the bend (120 m wide, 9 m deep at most) with the bay on the
  outside. The rails are the open steel rails the corridor already had; the
  course is untouched, but nothing grows behind the long right's rails any
  more (`shoreRun`, `shoreUp`: the woods hid the water). Off the outer side the swell runs big (waves.js
  `BOOST`): its three long waves 2.5 times their height at the middle of a
  circle of 360 m (up to about 3 to 4 m from crest to trough in the sets);
  the same factor moves the mesh (medium, high), shades the normals (low)
  and answers `sampleWaves`. It stops short of the straight, whose bay
  frames D1 and D4 look over. `?photo=waves` looks over the lagoon beside
  the causeway. Not yet what the owner asked for: in the first stills the
  water is close on the lagoon side and glitters, but the boosted swell does
  not read as rollers from the road (150 m waves 3 m high are gentle slopes
  at that range); spray against the bank, breakers that curl over and a
  finer inner mesh near the eye are not built.
- **The coast road** (`coastDown`, `coastRun`, `coastTop` in trackLayout.js:
  the climb, the carousel, the crest and the plunge): on the sea side the
  steel rail stands on white posts and nothing grows that would hide the
  water; round the carousel and over the crest the verge inside the rail is
  a broad apron of ochre gravel (round 2: `verge: 'gravel'`, the grip and
  sound of gravel; no tyre wall on a coast side's run-off), elsewhere grass;
  on the land side the cut rock of the climb and the carousel is the coast's
  rust and ochre in faint beds scored by gullies, dry grass on top. The
  corridor's edges and slopes are exactly the presets' it replaced. The road
  from the sky road to the plunge has a double yellow centre line
  (`PIECE_MARKS` in road.js) and its kerbs are bare concrete (kerbs.js); no
  floodlight poles stand round the carousel and over the crest
  (`lapLamps.skip`). Within a few hundred metres of the sea all rock
  is that warm stone and all loose stone ochre grit (groundMaterial.js reads
  the sea map); inland it stays the grey limestone.
- **The water** is demo 01's sea (engine/waves.js, sea.js): a long soft
  swell (150, 98 and 63 m long, 0.6 m and less; round 2: lower and spread
  wider in direction, and every wave rising and falling in sets and lulls of
  its own, `GROUPS`, so that from high above it is a texture, not ruled
  lines) under a light breeze's chop,
  from the open sea in the north-west; the swell dies down over the shallows
  and breaks along the shore in bands of surf that run in with it; a few
  streaks of foam behind crests. Its colour is what it mirrors and what comes
  back up out of it: the sky's environment map with water's Fresnel, so it
  pales into a bright band towards the horizon and fades there into the
  haze the sky shows under the horizon; a dark blue body, greener over the
  shallows. **Day**: deep blue with the sky in it; the sun stands behind
  the coast road's views, so its glitter path lies towards the land. **Golden
  hour**: the low sun over the bay and the south-west, a path of gold glitter
  on dark teal water (round 2: the water gives back less of the bright
  golden sky, 0.42, and its body is a dark teal; by day 0.78 and a deeper,
  more saturated blue, `SEA_LOOK.byTime`). **Night**: black water, the moon's glitter, and the
  nearest lamps of the lap drawn into it as long streaks (the same lamps the
  wet road glints with).
- **Tiers**: low draws a flat disc of 160 triangles with the swell in the
  normals only; medium and high move the mesh with the swell. One draw call
  in every pass that sees it; no pass of its own.

## The tunnel

The owner's own video is the spec (37 s, filmed from the passenger seat of
his car one autumn evening; it stays out of the repository, as the reference
frames do). It is read here as measurements and words; nothing of the real
place (its signs' text, its names, its numbers) is copied. One more frame,
from a racing game, is the reference for the portal on the forest side only,
for its light, materials and composition: nothing of its content.

**The approach (the video's first 12 s).** A wide road falling gently into an
open cutting. Pale, smooth retaining walls of cast concrete about 5 m high
either side, with irregular panel joints and a cap; on them acoustic screens
3 to 4 m high: panels of vertical slats in a light gold between steel posts
about 4 m apart, rails across every half metre, glowing in the low sun, in
steps that come down towards the portal. A steel sign gantry across the road
(a two-chord truss with one long diagonal, signal boxes over the lanes, a
camera box hanging under it), tall lamp posts, small square blue signs on the
walls, green signal heads at the mouth.

**The portal.** A plain pale grey headwall about 3 m deep over the mouth, a
parapet band along its top and a two-rail railing on it. The mouth is a dark,
clean rectangle, wider than the carriageway by the walkways, about 5.5 to
6.5 m high; inside it the lines of fittings converge as bright dashes, and
green down arrows hang over the lanes just inside.

**The portal on the forest side (the game's frame).** Lower and wider, of
weathered grey concrete with dark streaks, a lintel band standing out over
the mouth with small lamps under it; a sloped concrete revetment leading to
it on one side; a black and white chevron board beside the mouth; a banner
board on top; big trees over it and their dappled shade on the road.

**Inside (from 13 s).** A box (cut and cover), not a round bore: about 15 m
wall to wall and 6.5 m high, with a chamfer about a metre across where wall
meets ceiling. Pale beige grey walls of cast panels a few metres long; a
raised walkway at the foot of each wall with a pale kerb face; a flat grey
ceiling, darker in the middle. Two lines of rectangular LED fittings along
the ceiling at the foot of the chamfers: in the first 60 m or so pairs of
bars two to three metres apart, almost a continuous line; further in single
fittings six to eight metres apart. Lane signals (green arrows) hung across
every hundred metres or so; pairs of jet fans; a reddish pipe and cable trays
under the ceiling; small green guidance lights about a metre up the walls
every dozen metres; tall green-lit emergency doors and green signs every
60 m; red fire points. The road pale and evenly lit, a solid edge line and
broken lane lines. The light is neutral to cool white, even and bright: the
walls brightest low down, the ceiling darker. The exit is a small, white,
blooming rectangle that grows; the world reappears in it as the eye adapts.

**How it is built** (tunnel.js; the light road.js, lamps.js):

| | the video | the build |
|---|---|---|
| section | box about 15 x 6.5 m | 12 m road + 1.5 m to each kerb face, 1 m walkways, walls 17 m apart, ceiling 6.4 m, chamfer 0.9 x 0.7 m |
| fittings | pairs every 2 to 3 m at the entrance, single every 6 to 8 m | pairs every 2 m over the first 60 m, single every 3 m to 130 m and over the last 36 m, every 6 m between; bars 1.25 x 0.24 m |
| light | cool white, entrance brighter | lamps every 12 m on each side, 0.9 0.96 1.0, the entrance's 2.4 times as bright over 60 m, easing to the interior's over 70 m; the last 36 m 1.4 times (by day; half of that extra at golden hour, none at night) |
| walls | pale cast panels | panels 5 m long, a joint along the dado at 1.15 m, grime at the foot |
| on the walls | green lights, doors, signs, fire points | guidance lights every 12.5 m at 1 m; a door with a lit frame and a sign every 60 m, alternating sides; a fire point between |
| under the ceiling | lane signals, jet fans, pipe, trays | lane signals at the entrance and every 120 m; jet fans in pairs every 110 m from 70 m in; a pipe and a tray the whole length (not on low) |
| out of the exit | retaining walls about 5 m, screens 3 to 4 m | walls as high as the cut (5 m: the `cutting` preset), screens 2.4 m at the portal, 0.6 m higher every 26 m up to 4.2 m, for 110 m |
| into the entrance | (the game's frame) | sloped revetments over the last 75 m, upright at the face and leaning back 0.22 m per metre from 10 m out; a gantry 110 m before the portal |

What still differs from the video: the road keeps its own dark asphalt (the
video's is pale concrete-grey); there are no lamp posts in the cutting; the
signs are pictograms of our own and carry no text or numbers; there is no
traffic.

## Left out on purpose (for now)

- **Weather.** Rain, spray, fog and a wet road that changes the grip are the
  planned next step. (The wet road at night is a look, not weather: it is
  always there at night and the tyres do not notice it.)
- **Opponents driven by the computer**, damage, a career, more tracks, more
  cars, tuning.
- **Online play.** Demo 01 has it; this one does not need it.
- **A cockpit view.** The cabin is modelled only as far as it shows through
  the glass.

## The forest

Early autumn: most broadleaves green, the maples of the start turned, birches
yellowing, larch green-gold, spruce and fir dark. Built in
`src/assets/world/`:

- `treeSpecies.js` eight species (spruce, fir, larch, birch, maple, lime,
  hornbeam, hazel for the undergrowth), ten grown individuals; per species a
  `green` tint, `autumn` tints and how readily it `turns`. The maple's ten
  autumn tints are set from frame D4's crown pixels (hue shares there: red
  12 %, orange 55 %, gold 31 %; ours from the d4 camera within a few points
  of each), the broadleaf greens from D3.
- `forestTextures.js` one atlas of 12 tiles: needles, leaf sprigs (four to a
  tile), masses of small leaves for the reduced trees, fallen leaves and the
  floor; broadleaf tiles painted grey (the tree's tint colours them);
  coverage-preserving mip levels (`alphaMips`).
- `treeGeometry.js` grows each individual: trunk, main limbs, a limb per
  crown lobe, twigs, some 1300-1900 leaf cards on the lobes' shells, each
  with a bent normal and its openness to the sky; the reduced mesh is every
  third card at 1.7 times the size.
- `treeMaterial.js` light through the leaves, `crownTone`, wind, coverage.
  No hashed or dithered transparency at any tier: alpha-to-coverage where the
  scene target is multisampled, a hard cut where it is not.
- `impostors.js` pictures of each individual baked at start-up: 8 level and
  8 raised views (8 only on low), cells up to 192 / 256 / 256 px (low /
  medium / high), sampled with a mip bias of -0.75. Baked from the full trees;
  on low, where no full broadleaf is ever drawn, from the reduced broadleaves
  (only the conifers' full meshes are grown there).
- `forest.js` plants and draws. Where trees stand: `woodAt` (the Track's);
  `turnedAt` (turned from the line to about 230 m past it, green elsewhere
  round the start and in the ledge's first bend, groups here and there round
  the lap). The three places of the reference frames are planted by hand in
  rows (`plantRows`): D4's wall on the land side beyond the line (six rows
  14-19 m to 26-33 m tall from the barrier to 45 m back, nearly all maples,
  a dark fir or two in front); D3's bank (open rows of hornbeams with limes
  and maples, the first leaning out over the road, the three behind it 8-11,
  10-14 and 15-22 m tall from 4 to 32 m back (their crowns are where the
  low sun crosses the road's line, so their shade lies on it), the valley side of the bend
  kept to low growth; the bank rises gently, 0.12 in 1 (`SIDES.bank` in
  trackLayout.js), and the mass of the forest stands 125 m or more behind its
  barrier, so that the day's sun, 16 degrees up on the right of the bend,
  comes in under and between the crowns and lies on the road in patches: on
  a bank steeper than the sun the whole bend was in shade); D1's middle distance (low round green trees behind the
  rows of the first bend). Far from every road the forest is planted at half
  the density, without asking the Track. Levels per tier (m): full to 0 / 58
  / 80, reduced to 55 / 80 / 110, impostors to 650 / 900 / 1200; a tree's
  `detail` scales its full and reduced distances, up to 1 / 1.6 / 2 times
  and 1.6 / 2.8 / 2.8 times (`fullCap`, `redCap`): the wall and the bank have
  detail 2-2.8 in their front rows, so that from the d4 camera the wall is
  meshes out to some 150 m on medium. The floor: a grass patch under every
  tree of the road's rows, fallen leaves under every turned one. Shadows:
  impostor cards on a layer only the sun's shadow camera sees.

Measured on software WebGL in this container (shared with other work, so the
times scatter by a third), the forest alone in the main view:

| place (camera) | tier | draw calls | triangles | full / reduced / impostors |
| --- | --- | --- | --- | --- |
| D4 (`photo=d4`) | low | 4 | 20 k | 0 / 11 / 1677 |
| D4 | medium | 9 | 153 k | 23 / 19 / 3310 |
| D4 | high | 10 | 295 k | 44 / 37 / 5224 |
| D3 (`photo=d3`) | low | 6 | 13 k | 0 / 9 / 228 |
| D3 | medium | 10 | 79 k | 15 / 8 / 1390 |
| green wood (chase, `t=14`) | low | 13 | 71 k | 0 / 59 / 1689 |
| green wood | medium | 23 | 276 k | 54 / 58 / 2783 |

Budgets for the forest in a chase frame: 40 / 120 k (low), 80 / 300 k
(medium), 120 / 600 k (high). Start-up of the forest (plant, textures, grow,
bake, meshes): about 1.3 s on medium (400 / 450-550 / 200 / 100-160 / 80-160
ms) and 1.1-1.3 s on low (300 / 400-550 / 150-200 / 50-120 / 60-120 ms):
over the 1 s and 0.7 s aimed at. Textures 47.7 MB (medium, high), 23 MB
(low).

Not measured on a real phone or a real GPU.
