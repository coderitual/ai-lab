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
| Forest esses | 657 to 1409 | right 260 m, left 330 m, right 240 m, climbing at 5 to 6 per cent, between walls of turned broadleaves ("The golden wood"); 205 to 240 km/h |
| The tunnel | 1409 to 2006 | an alpine meadow with low walls at the road's edge and a headwall and hood set into the hillside ("The approach to the tunnel"), the lit box (1479 to 1828, 349 m, bending right at 1000 m radius) and a cutting out between retaining walls with acoustic screens; up to 255 km/h |
| The sky road | 2006 to 2582 | on piers: a 576 m left of 300 m radius, banked 10 degrees, the valley 42 m under its middle; about 230 to 257 km/h |
| The carousel | 2582 to 2915 | a 150 m climb, then 190 degrees right round a spur at 55 m radius, banked 8 degrees: the only heavy braking of the lap, 90 km/h |
| The crest | 2915 to 3115 | the top (108 m), in the open, the lake far below; the car goes light over it at about 160 km/h |
| The plunge | 3115 to 3394 | 8 per cent down a 400 m right into a compression; to 215 km/h |
| The ledge | 3394 to 3778 | a left of 300 m and a right of 350 m on the hillside, rock on one side; 216 to 257 km/h |
| Gully bridge | 3778 to 4115 | 337 m straight on piers, 26 m over the gully, 8 per cent down; to 282 km/h |
| The long right | 4115 to 4686 | 90 degrees at 300 m radius, banked 9 degrees, onto the straight, an arm of the lake below it on the left ("The arm of the lake"); 234 to 283 km/h |

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
  applied to every car at once), and on touch screens the steering (pad,
  slider, arrows or tilt; `dreamcar.steering`), the holding hand (right or
  left; `dreamcar.hand`) and the throttle (auto or manual;
  `dreamcar.throttle`). Keys reach every button by Tab and Enter, a
  pad by its d-pad and A; touch targets are at least 44 px (the driving
  buttons 64 px and more).
- **Controls, each device as if it were the only one.** Keys: W A S D or the
  arrows, Space the handbrake. Pad: triggers, left stick, A or RB the
  handbrake. Touch: the owner plays on an iPhone held upright in one hand,
  and asked for controls that are "one-hand friendly and super smooth and
  precise". So the default is one thumb on an analog pad that appears under the thumb
  (round 3: the owner plays with either hand and asked that "the pad
  should also adjust to where the user starts to touch"; he had rejected a
  stick whose base moved while the finger moved, so the centre is set at
  touch-down and never moves until the thumb lifts). At rest it is a faint ghost at the bottom
  corner of the holding hand's side (Hand: Right or Left: it only places the
  ghost and the handbrake button), within the
  thumb's natural arc: drawn like a finished game's stick (a dark glass disc
  with a light rim, its centre and full lock marked, an amber brake arc
  along its foot that fills as the brake is pressed, a red arc below it).
  Across is the steering; the car drives itself, and pulling the thumb down
  first lifts and then brakes, so one thumb can trail the brake into a bend;
  pulled on into the red arc it yanks the handbrake, like a lever, and the
  knob clicks into the arc: brake, flick into a slide and steer through it
  with one thumb. A round HANDBRAKE button stands in the other bottom corner
  for a second thumb; a second finger anywhere is the handbrake too. The pad's centre is where
  the thumb landed and never moves, so the first input is zero and the knob
  springs back when it lifts; near an edge the travel is compressed (to
  60 % at the least) and then the centre is nudged inward with a 6 px hold
  at zero, so there is never a jump. Options: the slider (a track with a marked
  centre) or two arrows, each with the pedals (BRAKE, DRIFT, and GAS on
  manual); tilt (the phone rolled like a wheel, the pad still braking;
  untested on a real phone). Throttle manual makes the pad's up the
  throttle. The controls are outlined and named on the first touch run, drawn
  pressed with a glow the moment a finger lands, and step back to 45 % a few
  seconds into a run so as not to sit over the picture. In split screen
  each half has all of it, laid out for the half. (Round 1 of the controls
  had the slider and pedals as the default; before that a floating stick
  whose centre followed the thumb, with the power on only while the steering
  was touched: the owner found both wrong.)
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
`?photo=back,right,up,yaw,pitch,fov` (add `,hud` to keep the HUD), so that
`node tools/shot.cjs --url "…?manual&auto&ap&t=20&photo=4.5,2.2,0.9,22,1,46"`
needs no `--eval`. It reads nothing but the car's pose: with `?manual&t=…` it
is the same picture every time. The reference frames' cameras are named
places (`PHOTOS` in game/config.js): `?photo=d1` (the run-up to the line,
day, t 100 s), `?photo=d3` (the ledge's first bend, day, t 78.8 s) and
`?photo=d4` (the grid at golden hour, t 5.5 s, just after the lights go out: the lamps show green), and
`?photo=r1` (the approach to the tunnel, day, t 34.85 s: photograph R1's camera, with the car behind it),
`?photo=r2` (the lakeside, day, t 56.45 s), `?photo=r3` (the golden wood, day, t 25.8 s) and `?photo=r4` (the
arm of the lake from the gully bridge, day, t 85.4 s); a name
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

- **R2**, a photograph (free licence), not a game: a country road in early
  summer sweeping gently right along a hillside above a lake. On the left a
  steel guard rail on wooden posts with tall grass and dandelions growing
  against it, a dark pine at the frame's edge, the blue water below and, far
  beyond it, a range of blue peaks streaked with snow under cumulus in a deep
  blue sky. On the right a low cut of dark rock under a bank of grass and
  outcrops, a wire fence on wooden posts, and a row of full, sunlit birches
  and broadleaves. Warm pale asphalt with a white edge line and a yellow
  centre dash, the shadow of a tree lying across it. It is the spec for one
  place only: "The lakeside", below.
- **R3**, a photograph (free licence): a mountain road in autumn, by day
  under a blue sky with cumulus. Along its right side a continuous wall of
  aspens in gold and orange, lit by the sun, their foliage coming down to the
  slope at their feet and their pale trunks half hidden in it; the bank under
  them covered in fallen leaves and russet low growth; a pale gravel
  shoulder; warm grey asphalt with a white edge line and a double yellow
  centre line; the left side open, with a few dark conifers far down the
  road and a bare mountain beyond. It is the spec for one place only: "The
  golden wood", below.
- **R4**, a photograph (free licence): a road coming down towards a lake
  under an overcast sky, seen through a long lens. The asphalt and its narrow
  verges of gravel and pale long grass in the foreground, a low rail where
  the road bends away; a dark band of low wood; the water, grey and still,
  with a wooded point reaching into it; and beyond it ridge behind ridge,
  each paler than the one before, up to a snow-dusted massif under the
  cloud. It is the spec for one place only: "The arm of the lake", below.

Day answers to D1, D3 and A; golden hour to D4 and D2; the wet night to two
further night references of the owner's (a wet street at night with lamps
mirrored in it). Nothing is taken from any of them but the quality, the
light, the materials, the vegetation, the composition and the sense of speed:
no names, logos, HUD artwork or layout, track shapes, liveries or lettering.
The car itself is checked against four daylight photographs of the owner's
car (car.md), which also stay out of the repository.

A second place has a photograph of a real road as its reference instead of a frame
from a game: **R1**, the approach to the tunnel (below, "The approach to the
tunnel"). It is free to use, stays out of the repository like the others, and
nothing in it is copied literally.

## The lakeside

One place on the lap answers to a photograph instead of a game frame (R2,
above): the 170 m where the road leaves the sky road and climbs along the
hillside to the carousel (s = 2588 to 2758 m, lap time about 0:50 to 0:53).
It was the barest stretch of the lap: a wall of conifers on the left, a nine
metre rock face on the right, bald slopes beyond. The road, its edges, its
kerbs, its lamps and boards are what they were; everything that changed is
scenery beyond the solid edges, and one module describes it
(`src/assets/world/lakeside.js`).

- **The lake's side (left).** The conifers that stood along the rail are gone
  from this stretch. The ground falls from the rail down a grass bank to a
  tarn 6.5 m under the road where the stretch begins (the road climbs away
  from it: 13 m over it by the bend), about 5 ha of water held on a bench
  above the valley under the sky road. The bank is a meadow of long grass in
  the photograph's warm yellow-green, lighter on its rises and darker in its
  hollows, lit; long grass with pale seed heads (the approach meadow's own
  cards, warmed) stands in a continuous band from the paved margin to beyond
  the rail and goes on down the bank to the water, thinning, with dandelions
  in it; a stone or two lie on the bank, and groups of two or three irregular
  birch saplings in the stand's dark tone stand behind the rail, whose
  shadows lie across the road. None of the lap's short dark tufts grows on
  this stretch. No tall tree with a
  bare trunk stands here (the owner has ruled those out). The rail itself is
  the circuit's own (two W-beams on steel posts): what cars hit did not move;
  a weathered wooden post stands close behind it every four metres, as the
  photograph's rail has. The water mirrors the sky brightly, and along its
  far banks the dark of the wood that stands over them.
- **The far shore.** A wood of conifers, birches and limes stands round the
  tarn down to the water, darker than the lap's sunlit woods, and behind it,
  left of the middle of the picture, a wooded headland 40 m high. The tarn
  begins 60 m past the end of the sky road, so that the valley beside the
  deck keeps its own sunlit slope; the bench's southern end is a wooded
  slope with a low rim. Beyond it the hills that ringed the course, nine
  degrees high from here, are cut through by a pass 3 to 80 degrees left of
  the road, so that the land falls away behind the far shore and a range of
  peaks with snow in streaks closes the valley three kilometres off, about
  five degrees high. Straight ahead, where a bald dome a kilometre away
  closed the road, a lower wooded hill does.
- **The land's side (right).** The rock face is a low cut, 1.3 to 2.6 m, in
  darker, browner stone than the lap's pale limestone; above it a gentle bank
  of meadow with outcrops of faceted rock sunk in it, a stock fence of
  weathered posts and three wires two metres back from the lip, and behind
  the fence a stand of birches (pale trunks), limes, hornbeams and maples
  three rows deep: full crowns that begin two to three metres up and run
  into one another, a wall of foliage in a dark olive green with deep shade
  inside it and the wood's own floor under it. From 17 m back the bank gives
  way to the hillside the Track asks for, so that the spur keeps its shape on
  the side of the leg that comes back from the carousel; that spur, which
  stood as bare grey facets over the bank and inside the carousel, is clothed:
  the bank's browner stone on its steep ground, grass on the rest, and a wood
  of firs and dark broadleaves from its foot to its skyline, none of them
  tall enough to stand far into the view from the leg along its top.
- **The light** is the day's own: the sun 16 degrees up, 67 degrees left of
  this stretch's heading, so it stands over the lake, the road and the bank
  are lit from the left and shadows fall across the road to the right.

The comparison camera is `?photo=r2`: 1.45 m up on the paved margin just
outside the left edge line, 24 m behind the car (no further: the sun's
shadow map is laid round the car, and the shadows in the foreground are part
of the picture), turned 5 degrees left.

What still differs from the photograph, by measurement on the staged pair
(tools.md): the asphalt and the grass are several times darker than the
photograph's (its sun is high and its asphalt pale and warm; ours is the
lap's dark asphalt under a sun at 16 degrees, and neither the light nor the
asphalt is this place's to change); there is no yellow centre dash; the
trees are the lap's own, more yellow-green and brighter than the
photograph's; the far range is darker and its snow lies in caps more than in
streaks; the rail is the circuit's; the bend at the end is the carousel,
tighter than the photograph's sweep, and the road climbs at 6 %.

Seen from the sky road: the first version's tarn began at the deck's end,
and its bench rose out of the valley beside the last spans on the side away
from the day's sun: a dark face under the tarn's rim in the wide chase view
at lap 0:46 to 0:48. The tarn was moved 60 m on; the ground beside the deck
is the valley's own again, and what rises to the bench beyond it is side-lit
and wooded.

## The golden wood

A second place answers to a photograph (R3, above): the forest esses, from
their first bend to where the meadow before the tunnel opens (s = 635 to
1257 m, lap time about 0:15 to 0:27). They were the lap's plainest wood:
tall conifers on bare stems standing apart behind the rails, with plain
green ground between them. The road, its edges, kerbs, rails, tyre walls,
boards and lamps are what they were, and no ground moves; what changed is
what grows beyond the solid edges, and one module describes it
(`src/assets/world/goldwood.js`).

- **Two walls of turned broadleaves.** The lap's own autumn trees (lime and
  birch in gold, hornbeam a duller yellow, maple in orange and some red; a
  few of each still green) in five rows on each side from the barrier to 35 m
  behind it, each row taller than the one before. Every tree stands a
  quarter of its height under the ground and is wider than it grew, so that
  the foliage begins at the grass, the crowns run into one another, and the
  trunks are dark lines half hidden in leaves: no bare stem stands at the
  road (the owner has ruled those out). Young birch, lime and maple close
  the wall's foot at the barrier. From the fourth row back a dark spruce or
  fir stands among them here and there, an accent and never a row; the
  lap's conifer wood begins behind, 38 m from the edge.
- **The sun on the road.** By day the sun stands 16 degrees up on the left
  of the esses. The wall on that side is therefore low at the barrier (about
  4 m) and rises away from the road at the sun's own angle, so that the
  light comes over it and through its top: the asphalt and the taller wall
  on the right are lit, as the photograph's road and aspens are, and the
  left wall glows against the light. Where the hillside itself rises on the
  left (the second bend) it shades the road whatever grows on it.
- **The ground.** The verges are pale dry grass, unmown, flecked with fallen
  leaves in gold, orange and brown that lie thickest in a drift along the
  paved margin and against the barrier's foot; long pale grass gone to seed
  stands along the verge's outer edge; behind the barrier the wood's floor
  is this year's litter. The lap's short dark tufts do not grow here and its
  low bushes have turned.
- **The light** is the day's own; at golden hour and at night the walls are
  the same trees under those lights.

The comparison camera is `?photo=r3`: at eye height in the left lane where
the first bend gives way to the second, looking along the right-hand wall,
the car behind the camera.

What still differs from the photograph, by measurement on the staged pair
(tools.md): the near wall is within 13 % of the photograph's luminance and
three degrees of its hue, but the wall further down the road is brighter and
yellower (+62 %, hue 38 against 29: the low wall on the sun's side and the
haze), the verge is paler (+67 %: long straw grass where the photograph has
russet scrub and gravel) and the shade under the crowns is deeper (-46 %).
The trees are the lap's broadleaves, rounder and fuller than aspens, with
few pale trunks; the verge has a kerb and a steel rail and no gravel
shoulder or fallen logs; the asphalt is the lap's grey without a centre
line; the sky is the lap's paler blue; there is no bare mountain behind:
the meadow over the tunnel closes the road instead.

## The arm of the lake

A third place answers to a photograph (R4, above): the end of the lap's long
descent, where the road comes off the gully bridge at 8 per cent towards the
long right (s = 3785 to 4500 m, lap time about 1:18 to 1:27). The road ran
down into a closed wood there, the ground beyond it rose to a hill that hid
the lake, and the lake itself ended 150 m short of the place. Now the lake
reaches an arm up the valley below the road, and the bridge looks down the
road to water. The road, its edges, rails, boards and lamps are what they
were; everything that changed is scenery beyond the left solid edge, and one
module describes it (`src/assets/world/arm.js`).

- **The water.** The arm is the lake's own water at the lake's own level:
  it leaves the lake beside the straight at its western end, turns north and
  runs 700 m up the valley to a head below the bridge's end, 60 to 100 m
  from the road and 25 to 35 m under it. From the bridge it lies ahead and
  to the left, a band of water between the verge and the far shore; from the
  long right it lies below the road on the left all the way round.
- **The bank.** The woods that stood on the left of the road from the
  bridge's end round the first half of the long right are gone: a bank of
  meadow grass falls from the rail to the water, steep under the bridge's
  end and gentle further round, with long grass at the rail and down the
  bank, a stock fence on weathered posts along its top for the first 170 m,
  and groups of young birch and lime no taller than 5 m, so that nothing
  stands between the road and the water. The rail, the tyre wall and the
  boards on the outside of the bend are the circuit's own.
- **The far shores.** West of the arm the hills rise straight from the
  water, wooded (conifers and broadleaves, darker than the lap's sunlit
  woods) with the pale hall of frame D3 on its hilltop behind them; south of
  it the land that closed the valley is cut back to a shore 400 m further
  off and rises behind it ridge after ridge to the far ranges, each paler in
  the day's haze.
- **The light** is the day's own: the sun 16 degrees up on the right of the
  descent, so the bank below the road is in its own shade, and the water,
  the western shore and the ridges beyond are lit.

The comparison camera is `?photo=r4`: on the gully bridge 150 m before its
end, a long lens (24 degrees) down the road, the car behind the camera.

What still differs from the photograph (tools.md): the photograph is a dim,
overcast, nearly colourless exposure and ours is the lap's sunny day, which
is not this place's to change. Against the sky, the far range and the water
are as bright as the photograph's (within 15 %), but the middle ridge and
the near slope are several times lighter and bluer: ours stand in sunlit
haze, the photograph's in cloud shadow. The far range has no snow; the
foreground is the bridge's parapet and the lap's asphalt, not a gravel verge
with dry grass (the long grass and the fence begin where the bridge ends);
there is no dark band of wood before the water, no sign, no centre line;
the road bends right, not left. The arm's far shore lies on the terrain's
100 m lattice: its line is straight in pieces.

Seen from elsewhere: the ledge's first bend (frame D3) looks the same way,
and its far ridge is lower and paler than it was, with a sliver of the arm
under it; the hall on its hilltop and everything nearer are unchanged.

## The tunnel

The owner's own video is the spec (37 s, filmed from the passenger seat of
his car one autumn evening; it stays out of the repository, as the reference
frames do). It is read here as measurements and words; nothing of the real
place (its signs' text, its names, its numbers) is copied. The portal on the forest side (the entrance) and
the land round it have a reference of their own, photograph R1: the next
section.

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
| into the entrance | (photograph R1: the next section) | a meadow, low walls, a headwall and a hood; a gantry 185 m before the portal |

What still differs from the video: the road keeps its own dark asphalt (the
video's is pale concrete-grey); there are no lamp posts in the cutting; the
signs are pictograms of our own and carry no text or numbers; there is no
traffic.

## The approach to the tunnel

Lap time about 0:27 to 0:33. It was a cutting between two bare concrete
walls with a box portal and a bald hump behind; the owner's reference for it
is **R1**, a photograph of a real alpine road (free licence; out of the
repository; nothing in it copied literally, and none of its signs' faces or
lettering).

**R1 in words.** Taken from the road, low, a little right of the middle of
the right-hand lane, 200 m before a tunnel. The road sweeps towards the
mouth, which sits left of the middle of the picture, two fifths of the way
up. The mouth is set INTO a hillside that fills the upper two thirds of the
picture and leaves no sky: bright, sunlit, lush meadow green (133 182 43 in
the picture), darker where the ground folds, with dark spruce woods across
the top left, scattered broadleaves and bushes in a loose line down the
middle, single spruces and a dark timber hut with a grey roof on the meadow
right of and above the portal. The portal is clean pale concrete: a hood
with a rounded arch standing out of a level-topped headwall that runs on to
the right until the meadow has climbed to its top; on the left a long low
wall runs away along the road with a fence over it. On the verge, right up
to the road's edge, tall lit grass gone to seed (straw heads over green) and
small flowers; a wire fence on wooden posts between verge and meadow; a
guard rail nearer the mouth; black and white marker posts at the edge, red
and white striped ones between the lanes; in the right foreground a sign
post: a lamp box, a warning triangle, a blue square with a white field and a
tunnel's arch. The asphalt is pale grey and sunlit, its lines crisp white.
The light is high and soft; nothing casts a long shadow.

**How it is built** (approach.js holds the numbers; entrance.js, meadow.js,
terrain.js, forest.js, groundCover.js, groundMaterial.js read them):

| | R1 | the build |
|---|---|---|
| the land | a mouth set into a hillside | the cutting is gone: from 88 m before the face the ground beyond the solid edges is a meadow, rising 0.45 to 0.55 m per metre on the hill's side (the right), a low shoulder on the other; over the bore the hill climbs 0.6 m per metre to 75 m over the crown (it was a ridge 40 m over it) |
| at the road's edge | grass to the asphalt, a guard rail | the Track's solid edge is unchanged (a rail to 70 m before the face, a wall's from there): where it is a wall's a low concrete wall 0.8 m high stands on it, of the portal's concrete, the meadow behind and above; no tyre wall stands on the meadow |
| the portal | a hood with a rounded arch, a level headwall, a wall running down into the grass | a hood 2.6 m deep and 0.8 m thick, its arch upright to 3.4 m and rounded to 7.4 m at the front, falling to the box's own opening at the face (the box is unchanged: 17 m by 6.4 m); a headwall 10 m high, level on the hill's side for 23 m to where the meadow reaches its top, falling 0.36 m per metre on the other for 17 m; pale concrete |
| the meadow | lush and sunlit, with tone in it: lighter yellow-green rises, darker blue-green hollows, terracettes, a pale path | its own green in the ground's material where the terrain marks it (linear albedo 0.097 0.2 0.043), open from 190 m before the face: yellower on the rises and darker and bluer in the hollows at two scales, terracettes along the contours where it is steep, the mower's swathes where it is not, a few pale trodden paths, the blades' fine noise; no rock, scree or scrub on it |
| the verge | a wall of tall seed-headed grass with pale tops, flowers | cards of tall grass with straw ears, one in three with a few flowers, on the verge's outer part and for 12 m behind the barrier (12 a metre of road and side on medium, 2.5 on low), and a taller wall of it from the verge's outer edge to the fence (10 more a metre, 2 on low); the circuit's own dark tufts and bushes are left out there |
| trees | a dense dark spruce stand above left, low round bushes and small broadleaves in clumps along the hollows, single spruces | whatever the forest had planted on the meadow is taken out; a spruce wood on the low side (from 52 m beyond the edge before the face, so that its shade stays off the road, from 20 m behind it) and the same along the hill's crest over the bore, so the skyline is trees: a dense dark mass of spruce and fir on a 4.4 m lattice, each tree half as wide again as it grew and sunk a sixth of its height so that its skirt lies on the grass and no stem shows, 10 to 22 m over the ground, tinted dark and towards blue, no larch; its edge towards the meadow is the circuit's own autumn broadleaves, low (6 to 12 m), with hazel in front; four single spruces on the meadow, full and skirted; ten clumps of hazel bushes 2.4 to 4.2 m high with young limes and hornbeams of 4.5 to 7 m among them, tinted a mid green; no tall single tree with a bare stem |
| the hut | dark timber, grey roof | a chalet 7.2 by 5 m (stone plinth, dark timber, a shingle roof with deep eaves, a door and two shuttered windows) right of and above the portal, and a hay barn higher up; shapes of our own |
| fence, posts | wire on wooden posts; marker posts | posts every 3.5 m with four wires (7 m and two on low) along the hill's side from 190 m out and along the other wall; black and white marker posts every 24 m; red and white ones on the left wall and red and white boards on the hood's jambs (ours stand at the edges: nothing may stand in the road) |
| the sign | lamp box, triangle, blue square | the same three on two legs behind the rail 82 m before the face; the triangle and the square each carry an arch of our own drawing; no lettering, no numbers |
| the camera | `?photo=r1` | 1.3 m over the right-hand edge line 90 m before the face, turned 17 degrees right of the car's heading and 6 up, a 36 degree lens; the car is 6 m behind it |

The tunnel's sign gantry stood 110 m before the portal, where its shadow lay
across this picture's foreground; it stands 185 m before it now. The banner
and the chevron board of the old entrance are gone.

**What still differs from R1** (measured on the medium still, spec.md "The
approach to the tunnel"): our asphalt is the circuit's own dark asphalt, a
third as bright as the photograph's pale grey, and has a red and white kerb
where the photograph has a white line and gravel; the mouth shows the lit
box (our tunnel's entrance zone is lit 2.4 times as brightly as its
interior) where the photograph's is black; our spruce wood is lit from the
front by a sun 16 degrees up and reads 1.6 times as bright as the
photograph's shaded woods and greener, with autumn broadleaves along its
edge where the photograph has none, and there is a strip of sky over it
where the photograph's far hillside goes on up; our broadleaves are the circuit's
hazels and young limes, smaller and sparser than the photograph's bushes; at the game's
own shutter the picture is streaked by speed (the camera moves with the car
at 190 km/h: the comparison pair is taken with the shutter cut to a ninth,
as the screenshot tool does for staged pictures); our portal is twice as large in the picture (the
camera stands at 90 m, not 200 m: further back the road's bend and the
gantry come between); the light is the day's low warm sun from behind, with
long shadows, not a high soft one.

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
