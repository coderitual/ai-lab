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
cut into the hill, parapets on the bridges, walls in the tunnel. Trees stand
behind the barrier, never as it.

How the ground is drawn (src/assets/world): the asphalt (road.js) is
dark, fine racing asphalt with a polished, darker racing line and rubber in
the bends and the braking zones (corridor.js), runs of surfacing of different
ages with joints, the paver's seams 2 m either side of the middle, a few
patches and sealed cracks, tyre marks before the carousel (roadHistory.js);
its markings are a solid white line inside each edge (0.2 m), the start line
and twelve grid boxes from `track.grid`, nothing else. A second, anisotropic
specular lobe stretched along the line of sight lays the low sun's glare on it
as a long streak (`ASPHALT_SHEEN`). The kerbs (kerbs.js) are red and white
painted concrete, one colour per tooth, on `track.kerbs`, exactly on
`track.profile()` (on low, rows at every second tooth top). Beyond the margin
the terrain's band carries the verge: mown stripes 1.6 m wide, a ragged strip
of worn earth along the kerbs, longer grass at the barrier. Barriers: two
stacked W-beams on posts (one beam where trackside panels stand behind it;
set back behind tyre walls), low concrete walls 0.93 m high on the straight
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
| The tunnel | 1409 to 2006 | a rock cutting, the lit bore (1479 to 1828, 349 m, bending right at 1000 m radius) and a cutting out; up to 255 km/h |
| The sky road | 2006 to 2582 | on piers: a 576 m left of 300 m radius, banked 10 degrees, the valley 42 m under its middle; about 230 to 257 km/h |
| The carousel | 2582 to 2915 | a 150 m climb, then 190 degrees right round a spur at 55 m radius, banked 8 degrees: the only heavy braking of the lap, 90 km/h |
| The crest | 2915 to 3115 | the top (108 m), in the open, the lake far below; the car goes light over it at about 160 km/h |
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
in the project's own stroke letters (`src/assets/world/signs.js`).

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
- **Options** (on the title and the pause sheet): quality (auto, low, medium,
  high; kept under `dreamcar.quality`, applied by reloading the page; `?q=` in
  the address wins; auto is what the capability probe chose), sound, time of
  day, speed in km/h or mph (`dreamcar.units`), the map shown or hidden
  (`dreamcar.map`). Keys reach every button by Tab and Enter, a pad by its
  d-pad and A; every touch target is at least 44 px.
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
  beat. The best-laps board is on the title, the pause sheet and the results,
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
  go. Lifting off tightens the line; too much throttle in second gear steps
  the tail out and the stability control catches most of it.
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
is the same picture every time. Frame D1's camera on the start straight is
about `{ back: 4.5, right: 2.2, up: 0.9, yaw: 22, pitch: 1, fov: 46 }`.

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
  rims near the sun); a compact sun with a soft aureole; dry asphalt. Sunlit
  level ground gets about 2.1 from the sun against about 0.5 of sky and fill
  in the shade (some 2 to 2.5 stops at this height, the shade blue);
  exposure 0.85. Haze in two layers: the valley haze (hundreds of metres)
  and a thin air with a 1.4 km scale height that lifts and blues the far
  land kilometres away, warmer towards the sun. A limestone massif (far.js)
  fills the background, composed as D1 seen from the start line: its main
  peak 17° left of the road at about 19°, a greater shoulder over 23° by 30°
  left, the ridge about 9° under the sun and lower beyond; back-lit,
  blue-grey in its own shade, gullies down its face, forest and scree on its
  lower third. Exposure for sunlit asphalt, closing by about 2.5 stops inside
  the tunnel and recovering over a second on the way out.
- **Day has the sun in it.** Heading into the low sun it blooms into a soft
  glare, faint lens ghosts lie across the frame (medium and high), the sky
  stays blue up to it and the road shines towards the light.
- **Dusk is golden hour** (references D4, D2): the sun 3.5° up, 125° left
  of the start straight's heading, out over the lake behind the left shoulder of a car on the start
  straight. Its orange light crosses the straight almost level, so whatever
  stands on the lake side throws shadows 15 to 20 m long over the grid while
  the trees, the gantry and the buildings on the land side, and the massif,
  stand in full orange light. The sky runs from pale gold towards the sun
  through a rose belt to blue overhead, with clouds lit from below that the
  paint mirrors. Dry. Lamps and windows are coming on.
- **Night:** a three-quarter moon low ahead and a little left of the start
  straight (8° left of its heading, 17° up, beside the massif, which stands as a silhouette with
  moonlit edges), enough to draw the ridges and the edges of the road; stars; the low beam reaching about
  65 m with a sharp cut-off rising to the right, high beam about 150 m; LED
  daytime running lamps always on; tail lamps red with a hot core; brake lamps
  three times brighter; warm tunnel lamps; lit windows in the pit building and the
  towns. Exposure about 4 stops above day (lighting.js: 18 against 1; at 5
  stops the moonlit land read as dusk and anything facing a head lamp within
  30 m burnt white). Lens ghosts are off at night.
- **Night is the night after rain.** The asphalt is wet (lighting.js
  `wetness`: day 0, night 0.65; `?wet=` overrides): dark, glossy, with
  broken puddles in the wheel tracks and low spots, dry under the tunnel's
  roof. On the medium and high tiers it mirrors what stands on it through a
  planar reflection drawn per view about the road's plane under the view's
  car (engine/PlanarMirror.js; a third of the view's height on medium, half
  on high; nothing on low, which keeps the speculars): the tail lamps, the
  car, the lamps, the tree line and the sky, each light
  drawn out into a streak towards the viewer. The head lamps lay a cool pool
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

Day answers to D1, D3 and A; golden hour to D4 and D2; the wet night to two
further night references of the owner's (a wet street at night with lamps
mirrored in it). Nothing is taken from any of them but the quality, the
light, the materials, the vegetation, the composition and the sense of speed:
no names, logos, HUD artwork or layout, track shapes, liveries or lettering.
The car itself is checked against four daylight photographs of the owner's
car (car.md), which also stay out of the repository.

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

Early autumn: most broadleaves green, maples (and some limes and birches)
turned in groups, most of them round the start; larch green-gold; spruce and
fir dark. Built in `src/assets/world/`:

- `treeSpecies.js` seven species (spruce, fir, larch, birch, maple, lime,
  hazel for the undergrowth) and nine grown individuals; per species a
  `green` tint, `autumn` tints and how readily it `turns`.
- `forestTextures.js` the foliage atlas (broadleaf tiles painted nearly grey,
  the tint colours them) and the bark, with coverage-preserving mip levels.
- `treeGeometry.js` grows each individual into a full and a reduced mesh;
  broadleaf crowns are leaf masses clumped round the last limbs, normals out
  of the crown, occlusion dark inside and below.
- `treeMaterial.js` the standard material plus light through the leaves (sun
  behind, sky behind and above), light and shade carrying the crown's colour
  (`crownTone`), wind, coverage. No hashed or dithered transparency at any
  tier: alpha to coverage where the scene target is multisampled, a plain cut
  on low.
- `impostors.js` bakes, at start-up, 8 level and 8 raised pictures of each
  individual (colour; normal in the tree's frame and the crown's light).
- `forest.js` plants and draws. Where trees stand is asked of `woodAt(track,
  noise, s, side)` (the Track's own `woodAt` when it has one, else the sides
  whose edge kind is TREES), from 2 m behind the barrier; `turnedAt` is how
  much of the wood has turned; `createWorld({ keepOut })` keeps places free.
  Levels per tier (m): full to 0 / 34 / 50, reduced to 60 / 95 / 130,
  impostors to 650 / 900 / 1200 (low / medium / high), cross-faded by
  coverage over 8 m on medium and high. Shadows (medium, high): impostor
  cards on a layer only the sun's shadow camera sees, turned to the light.
  The mirror and the probe see reduced trees and impostors only.

Measured (software WebGL, chase view in the green wood at s 667, 1280x720):
forest draw calls / triangles low 10 / 61 k, medium 19 / 294 k, high
20 / 540 k (plus one shadow call of 2 triangles per caster); start-up
(plant, textures, grow, bake, meshes) about 0.53 s low, 1.16 s medium,
1.27 s high. Not measured on a real phone or a real GPU.
