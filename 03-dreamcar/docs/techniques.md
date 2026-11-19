# Dreamcar: techniques

How the tricky parts work, one section each, with the file where each lives.
The frame and the car have documents of their own, which go deeper:
[engine.md](engine.md) (the passes, the tone curve, the probe and the mirror)
and [car.md](car.md) (the skin, the paint, the lamps, the wheels). This page
covers everything else and summarises those two.

## The Track: a road from straights and arcs

`src/game/trackLayout.js` describes the circuit the way a road engineer would:
a chain of pieces, each a straight (`len`) or an arc (`r`, `deg`, positive
bending left), with the gradient at its end (`g`, plus knots inside it,
`gk`), the banking if it is not the rule's (`bank`), what stands on each side
(a preset from `SIDES`), and flags for tunnels and bridges. Nothing in it is
geometry.

`src/game/track.js` turns it into a road:

1. **The plan is a function of curvature against distance.** Where two
   pieces meet, the curvature eases linearly from one to the other over the
   joint's `ease` metres, centred on it, so the centre line has no kink in
   direction, curvature or steering rate: a car at 280 km/h feels a joint as
   a gradual change of steering, never a step. The plan is integrated from
   the start pose in eight sub-steps per sample, in doubles.
2. **Closing the loop.** The turned angles are round numbers that must add up
   to one turn to the right; what the integration misses by is spread evenly
   as curvature, and what the baked lengths miss the start by is spread along
   the lap (`closureOf`). `node tools/trackmap.mjs --fit a,b` solves the
   lengths of two straights so that the loop closes and prints them to paste
   back.
3. **Samples and cubics.** The centre line is sampled every metre (the
   spacing divides the lap exactly), and samples are joined by Hermite
   cubics through their exact positions and directions. `frameAt(s)` and
   `locate(x, z)` read the same cubics, so one inverts the other to a
   hundredth of a millimetre (the unit test checks 16 000 round trips), and a
   wheel never meets a facet.
4. **Height.** Gradient knots at the ends of the pieces, straight lines
   between them and every corner rounded into a vertical curve; the descent
   is scaled by a fraction of a per cent so the lap comes back to its own
   height.
5. **Banking** by rule, 9° x tanh(250 m / R), or the piece's own number,
   eased into the bend like the curvature and rounded at its ends.
6. **The cross-section** (`profile(s, lat)`) is linear in (sin bank, slope,
   far slope): the pavement and the 1.2 m strip beyond it are one banked
   plane, the verge follows its own slope to the solid edge, the hillside its
   far slope. Because it is linear, the same function gives its rate of
   change along the road, which the vehicle's normals need.
7. **The corridor.** Each side's distance to the barrier wanders inside the
   preset's range on slow noise, then is held under 0.12 m of change per
   metre, so rails and walls are continuous lines. Where another stretch of
   road is within 45 m beyond the edge (beside the carousel above all), the
   hillside between the two is worked out from both edges, so the ground
   between them is one ground seen from either.
8. **Kerbs are part of the course.** `kerbs` are ranges on the inside of every
   bend under 800 m radius from entry to exit, and on the outside of the
   exits of those under 500 m. `profile()` and `surfaceAt()` return them: a
   surface kind of its own (grip 0.9), flush at the road, rising 4 cm to the
   outside with a 0.9 m saw-tooth, ramped in over 4 m. The kerb mesh is drawn
   exactly on `profile()`, so what the wheels feel is what the eye sees.
9. **Dressing as data.** Tyre walls, board runs, distance boards, marshal
   posts, the gantry, the lamps and the sector lines are lists on the Track.
   The world reads them; nobody hard-codes an `s` or a coordinate.

A wheel asks one question, `surfaceAt(x, z, hint)`: height, normal, grip and
the distances to the solid edges, found from the last answer's sample by a
short walk (733 ns a call in Node).

## The terrain, conformed to the road

`src/assets/world/terrain.js`. One height function, built outwards from the
Track: out to the solid edge it is the Track's own cross-section; beyond it,
the hillside the Track asks for, with a cliff where the edge is rock (a rock
face stands in front of it, `rock.js`); further out it blends over 10 to
100 m into a field made on a 16 m grid from the road itself (rising inside
the loop, falling towards the sea, the bay and the valleys, a ridge over the tunnel,
a ravine under the sky road), with ridged noise on top; far away, mountains.

It is drawn in three pieces that meet without cracks: a **band** that follows
the road row by row with the Track's samples, its columns on the corridor's
own kinks (so it is exact where the eye is closest); a **grid** of square
cells over the course with the band's cells dropped; the **far land** in
100 m cells (140 m on the low tier). The road's outermost vertices are the
band's innermost ones. The far land has a hole where the grid is: the lines
of its lattice nearest the grid's border are moved onto the border, their
heights read there from the same lattice the grid's border eases onto, and no
triangle is made inside them. (It used to run on under the grid, sunk 150 m
in the middle but at its own height for two cells in from the border. Where
the road stood within those two cells, in a cutting lower than the land, one
of its triangles lay over the road, visible only from above: a dark slab over
the car in the tall picture of a phone held upright, at the esses.)

**Light in baked shade** (`shading.js`). The sky's share never falls under
`BAKE_SKY_FLOOR` (0.7) of the open sky's, and by day and at golden hour the
indirect light where the baked sun is gone is multiplied by up to
1 + `BAKE_BOUNCE` (1.0): what the sunlit surroundings throw back. Without it
the grass run-off inside a bend under the trees was a featureless dark sheet.
The wood's floor is leaf litter of albedo about 0.07 (it was 0.04 and read as
a black void behind the barrier), and the tyre walls are painted white and
red by blocks of five stacks, so a long wall in shade is not a black band.

**Baked sun shadows** (`shading.js`, `terrain.js`). At a low sun whole
valleys lie in the shade of a ridge kilometres away, far beyond the shadow
map's square round the car. Once, at start-up, the height field is marched
towards the day's sun, the golden-hour sun and the moon from every vertex, and
the answers ride on the vertex as `aBake` (sun, moon, sky seen, golden hour).
Patched materials multiply the directional light by the channel of the time
showing and the sky's light by the share of sky seen. The shadow map still
draws everything near; where both say "no light" they agree.

## The vehicle

`src/game/vehicle/` (Vehicle.js, tyre.js, drivetrain.js, params.js). A rigid
body (mass, inertia tensor from the body's box scaled to 0.8) on four sprung
wheels. Each fixed step (1/120 s, cut further if longer than 1/110 s):

1. springs (from the ride frequency and damping ratio), anti-roll bars,
   gravity, drag and downforce (Cl·A 0.7 m², applied at the centre of mass,
   shared among the wheels on the ground) give the velocity the body would
   have if the tyres did nothing;
2. the tyres act as friction against that velocity: a combined-slip model
   with a peak and a fall beyond it, the front's peak later than the rear's
   (the car's understeer), the load from the springs. Because it is friction
   against a velocity, a car parked on a 10 % hill does not creep and a slow
   car cannot be reversed by its own brakes;
3. the pose is integrated;
4. what is solid (the Track's edges, the ground under a car on its roof) is
   met with impulses and a push back out. A rail met at a shallow angle takes
   the lateral speed and some friction and turns the car along it, which is
   why a touch at 8° and 250 km/h keeps 92 % of the speed.

The drivetrain is an engine (a torque curve with a turbo lag on the way up),
a torque converter, a nine-speed automatic with shift times and hysteresis
that will not hunt, and a limited-slip differential. ABS, traction control
and stability control are controllers on slip that learn and forget at
their own rates; the stability control's reference is the yaw rate a car of
this characteristic speed (44 m/s) would have at the steering angle, capped
by the grip it can have (`esc.holdG` 1.6 g), so it does not brake every
banked sweeper.

**Testable in Node.** Nothing in `src/game/vehicle/`, `track.js` or
`drivers.js` touches the DOM or WebGL, and the vehicle allocates nothing
while stepping (a unit test counts bytes per step). So `tools/unit.mjs` drives
whole laps of the real road in Node in seconds, and `tools/handling.mjs`
measures the car the way a road test would (0 to 100, braking, skidpad, step
steer, lift-off, rail touches) and prints the table spec.md quotes.

## Hands that fit a car

`PlayerDriver` in `src/game/drivers.js`. A key is either down or up. The
steering moves at a rate towards a lock that shrinks with speed: all of it at
walking pace, at 200 km/h only the 4° that take the front tyres to their limit
(the lock is the angle the path needs at 12.3 m/s² plus the front tyres' slip
angle at the peak). So a key held through a fast bend gives a steady 1.3 g and
not a spin, and a tap at 200 km/h moves the wheel a fraction of a degree. With
keys, a hand catches the rear when it slides beyond the rear tyres' peak
slip (counter-steer 0.75 rad per rad). A stick or a thumb is trusted and only
given the same lock.

On a touch screen the default is a one-thumb pad (`src/engine/Input.js`):
a disc whose centre is set where the thumb lands (`_land`) and never moves
until it lifts, so the thumb's offset from it is an absolute position, not a
gesture, and zero at touch-down. Short of room at an edge the offset is
stretched back (`dx / f`, `f` the compressed share of the travel, at least
0.6) before it reaches `padControls`; under 0.6 the centre is nudged inward by
the missing travel and the input held at zero for 6 px of movement from the
landing point. The disc is drawn inside the safe area (the knob stays on
the centre). The Hud keeps two discs: the live one under the thumb, and a ghost
at the layout's home place; the 0.4 s before the ghost returns is a CSS
transition delay, so no clock is read. A second finger in the zone is the
handbrake pedal; the pad keeps the pointer that placed it. `padControls(dx, dy, scale, manual,
tripped)` turns that offset into everything the car needs, and is pure, so the
scripted thumb of the Node tests drives through the very same function:
across over 70 px is the steering; down, the first quarter of 56 px lifts
the throttle (a thumb can trim speed without braking) and the rest brakes,
fully at 56 px; on beyond 74 px is the handbrake, held until the thumb comes
back above 62 px, so a hard stab at the brake does not trip it and a held
slide does not flicker off; the knob is drawn clicked into the red arc while
it is pulled. The values are worked out in the pointer handlers and stored,
so the fixed step only reads numbers. The pad and the slider are linear; the
curve that makes small corrections easy at speed is the hands'
(`HANDS.thumb.expo`, the same place as a stick's), and so is the smoothing:
for a thumb, two equal lags in a row (`order: 2`, a critically damped
follow: no overshoot of its own, about twice the lag to most of the way),
22 ms standing to 50 ms at speed, and 30 ms on the pad's pedals. That takes a
shaky thumb's jitter out without a lag a hand feels; a single lag long
enough to do the same was either sluggish or let the jitter through, and a
shorter one made the yaw overshoot by 26 % at 250 km/h (the turn-in test
holds it under 22 %).

Tilt reads `deviceorientation`'s beta and gamma as the world's up in the
device's frame (`rollOf`), turned into the screen's frame by the screen's
angle, and the roll is the angle of that up within the screen: so the same
formula serves an upright phone and one on its side, and does not go through
the Euler angles' gimbal lock when the phone is held upright (where gamma
swings wildly for a small roll). Where gravity lies mostly out of the screen
(the phone flat) there is no roll to read and the last one stands. The zero
is the roll at the start of a run and at Recentre; ±30° is full lock; the
hands' smoothing does the rest. Every control owns the
pointer id that took it (`setPointerCapture`, then a map of pointer id to
pedal), so two or three fingers never steal from each other, and anything
that can lose a finger's lift (pointercancel, lostpointercapture, blur, a
hidden tab, orientationchange) lets every control go. The layout is worked
out once per view size by `layoutOf` and drawn by the HUD from the same
numbers. With the arrows the input reports keys (`analog: false`), so
`PlayerDriver` winds the wheel exactly as for A and D.

## The autopilot's speed plan

`AutoDriver` in `src/game/drivers.js`, what `?ap` runs and what the tests lap
with:

1. **The line.** The smoothest path that stays on the pavement, by Rémi
   Coulom's K1999 scheme: each point is moved across the road until the
   curvature through it is the mean of its neighbours', first with points far
   apart (which finds the shape: out, in to the apex, out), then filling in at
   half the spacing down to every sample. A biased driver (split screen) keeps
   the line inside its own part of the road.
2. **The speed at each metre.** From the path's curvature over a car's length
   each way and the grip the car has at that speed (downforce makes it grow
   with v²), counting half of the banking's help (the line is not the centre
   line the banking was laid on), and over the crest the speed that keeps half
   the weight on the wheels, reached before the crest begins. Then backwards
   from every bend, no faster than can be shed before what follows; forwards,
   no faster than the engine's power and the rear tyres can have made it.
   `pace` scales the grip used (its square).
3. **Driving it.** Steer at a point on the line a little ahead, hold the
   speed with throttle and brake.

## The car's skin, paint and probe

In detail in [car.md](car.md). In short: the body is lofted from curves
(`src/assets/car/lines.js`, `spline.js`) into one skin (`skin.js`) whose
uv is the body's own coordinates, so lamps, shut lines, badges and grilles
are a feature atlas (`atlas.js`, `features.js`) drawn on the skin rather than
separate meshes; what must have depth (lamp units, mirrors, wheels) is
modelled. The paint is a standard physical material with a clear coat and a
metallic base with flakes; what it mirrors is the car's reflection probe
(`src/engine/ReflectionProbe.js`, in full in engine.md, "The reflection
probe"): a cube picture of the surroundings round the car, 128 / 256 / 512
texels a face by tier, one or two faces redrawn a frame (the ones that see
the roadside go by first), and filtered into a second cube whose mips hold the
GGX lobe of one roughness each, so that any layer reads its whole glossy
reflection in one lookup at its own roughness and a lamp in it is a soft
lobe, not a blotch; each new picture is eased in over a few frames, so a
refreshed face does not pop. The probes leave out what would only cost (the
start's dressing, the town; on `low` also the rails, the guide posts and the
lamps' glow) and see no further than 260 to 400 m. A face sees the whole world
round the car and costs about half as many triangles as the view; the cube's
resolution costs next to nothing beside that. What is big and far is drawn for
the probes by a cheaper stand-in on `PROBE_LAYER`, a layer only the probes'
cameras have: the massif's grid on every other column and row (a quarter of
its triangles); the full grid sets its draw range to nothing for a probe's
camera. The sky dome draws no sun or moon disc for them (the light's own
highlight is the disc's).

## The trees

`src/assets/world/` treeSpecies.js, treeGeometry.js, forestTextures.js,
treeMaterial.js, impostors.js, forest.js; numbers in design.md, "The forest".

- **A grower.** Each of the variants is grown once at start-up into a
  skeleton: a conifer's trunk with whorls of branches that sag with length;
  a broadleaf's trunk that forks into limbs that turn to the light and stay
  inside an ellipsoid crown. From one skeleton, two meshes: **full** (every
  limb a tube, leaf-cluster cards on the last limbs, turned every way) and
  **reduced** (main limbs, a few big cards; also what the mirror sees).
- **Leaf clusters lit as one body.** A foliage vertex's normal points out of
  the crown, not out of its card, so the crown is shaded like a soft solid;
  light through the leaves (the sun and lamps seen through the crown, and
  the sky behind it) makes a backlit autumn tree glow.
- **Coverage-preserving mips**, made on the CPU (`forestTextures.js`): a
  needle is a texel or two wide and, averaged down, would fall under the
  alpha cut-off, so each level's alpha is scaled until the same share of the
  tile passes the cut as at full size; colours are spread into transparent
  texels first so edges do not filter to black.
- **Impostors.** At start-up every variant is photographed from 8 directions
  at its middle and 8 from above into two atlases: colour and alpha, and the
  normal in the tree's frame with a foliage mask. A far tree is one card
  turned to the eye, shaded by the same code as the real tree, so it changes
  with the time of day and takes the same tint.
- **Levels without dither.** Full, reduced and impostor are chosen per tree
  per view by distance. Where the scene target is multisampled (medium,
  high) the foliage's alpha becomes coverage (alpha to coverage) and two
  levels cross-fade by coverage over 8 m; on low a plain cut against the
  coverage-preserving mips and a hard swap. No hashed or dithered
  transparency anywhere: under the motion blur it smears into noise.
- **Shadows** are impostor cards turned to the sun, on a layer only the sun's
  shadow camera sees: two triangles a tree. The trees that cast are those
  whose crown lies inside the shadow map's box as `sun.prepareView` placed it
  for this view (`sun.box`, forest.js `inBox`), not those near the car: a
  crown 25 m tall under a 17 degree sun or moon shades the road 80 m away,
  and a choice by distance from the car left those out, differently for two
  cars a few metres apart (the two-player "water on the track", tools.md).
  Where no box is placed (the viewer), a tree casts if its shadow comes near
  the car (forest lane): the level segment from its foot to where the shadow
  of its top lands is tested against the circle round the car.
- **Schemes** (forest lane, `schemes.js`): a piece of the plan may name a
  look (`scheme`, trackLayout.js SCHEMES). Everything that reads it asks
  one table per Track sample: which scheme, its weight (1 on its pieces,
  easing to 0 over its `blend` metres either side) and whether the sample
  is on its own pieces. The weight decides gradually (a tree, a tuft, a
  boulder is placed with that probability; the asphalt's tone and the
  concrete strip fade with it); the lines are drawn only on the pieces
  themselves, so they begin and end at a piece's end. Each part plants or
  places what the scheme asks from its own random stream (`fork('scheme')`)
  after everything else is placed, so that the rest of the lap is exactly as
  it was. A scheme may draw the corridor's solid edges differently without
  changing them (`curb`): to the cars the edge stays what the Track says (a
  rail, rock), at the same distance; the world draws a low concrete
  kerbstone there instead of a rail or a cut face (`schemes.js` `curbAt`,
  read by rails.js, terrain.js's cliffs, trackside.js), so the physics and
  its tests are untouched.
- **Where trees stand** is asked of `track.woodAt(s, side)` from 2 m behind
  the barrier, plus the mass of the forest away from the road where the
  terrain says; a keep-out callback keeps the start area and the town free.

## The sky, the clouds and the massif

`sky.js`: one dome round the camera, drawn infinitely far (rotation only,
z = w) without writing depth, so one dome serves every view, the probes and
the environment map. By day a clear-sky gradient (deep blue overhead, paler
the longer the path through the air), the sun's glow (a wide and a tight
lobe) and its disc thousands of times brighter than the blue, unclamped, so
the frame's bloom and flare make the glare from real brightness. Two layers
of cloud lit from the side the light comes from, with grey-blue bases and
silver rims near the sun; at golden hour, lit from below. The cumulus noise is
pushed up round one place in the sky (lighting.js `clouds.group`, placed
against the straight's heading like the sun: 30 degrees left of it, 30 up), so
that D1's group of big heaps over the massif's shoulder is there whatever the
noise does elsewhere; their rims are cut sharp (a 0.07 wide edge).

At dusk the clear sky is not the zenith-to-horizon gradient but a twilight
dome (lighting.js `sky.twilight`, sky.js `twiColumn`): two columns of five
radiances from the horizon up, one under the sun (rose, orange, pale yellow,
turquoise, deep blue) and one opposite it (the blue-violet shadow of the
earth, the pink belt, blue), blended round the sky by how far a direction is
turned towards the sun, with the sun's glow on top. The clouds' light then
gathers on the sun's side (`clouds.sunward`): undersides lit orange-rose
near the sun, dark blue-grey elsewhere; and the first stars show only high
up and away from the sun (`starsAway`). The environment map, the probes and
any water are drawn from the same dome, so they mirror it. By night the same
shader draws the moon, airglow and the Milky Way; stars are points a pixel or
two wide with their brightness spread over the footprint, so they neither
flicker nor change with the picture's size.

`atmosphere.js`: the haze every world material is patched with, in two
layers: the valley haze (density falling with height) and a thin air with a
1.4 km scale height that lifts and blues the far land, warmer towards the
sun.

`far.js`: three rings of ridges 5 to 11 km out, wooded below a ragged tree
line and rock above, and the limestone **massif**: a height field on a polar
grid placed from the Track's start frame and shaped to a skyline profile
measured from the start line (its main peak about 17° left of the straight's
heading and 19° up, the ridge about 9° under the day's sun), with gullies
domain-warped down from each summit and its own baked sun and moon shadows.
They lie beyond the far plane, so their vertex shader puts them at the back
of the depth range; drawn first, depth test always passing, still writing
depth so the sky does not paint over them.

The massif is back-lit, so its faces are in the sky's light and its form is
carried by its albedo and its rim (day lane): limestone of albedo about 0.19,
ribs paler than the gullies between them (a ridged field down the face,
squared), pale fans of scree where the gullies open onto gentler ground near
the tree line, a few great buttresses 600 to 1000 m apart cut into the face
(their flanks turn to the sun or away), gullies that fork and end as they run
down instead of hanging the whole height of the face. The rim: rock seen
edge-on near the skyline, looking towards the sun, sends light forwards
(`uRim`, graze cubed times the view's alignment with the sun to the fourth,
only where the baked sun reaches): a thin bright line along the ridges on the
sun's side, as in D1. Its skyline: the ridge left of the main peak stays about
21 degrees high and the shoulder climbs gently out of the frame.

`far.js` also builds **the far cones** of frame K5 (`K5.cones` in
landmarks.js): across the open sea from K5's place, 14 to 17 km out, a long
low range with three volcano-like cones (1600 to 1800 m: lower ones hid behind the bay's far shore) on it, snow on
their upper flanks, built like a ring (a strip of faces from under the sea's
horizon to the crest, facing the place, drawn first at the back of the depth
range; 90 x 6 cells on low, 220 x 10 otherwise). At dusk they are a dark
blue silhouette under the horizon's band; by day blue in the thin air with
white tops. (The green hill this file built for D3 was taken out: every place
on its line of sight from the ledge lies in K5's view, which is the stricter
spec; `landmarks.js` `inK5View` now keeps the pale hall out of that view too.)

The sun and moon are placed against the straight's heading
(`lighting.js` `PLACES`, `placeLights`), not on the map: move the straight and
the day's sun still stands down it.

The massif's pixels add what its vertices cannot carry (render lane): beds
of limestone about 22 m thick, pale and grey by turns, slightly dipping and
warped; dark streaks where water and scree run down the faces; dark specks
of pine on every ledge gentle enough to hold them; and, on medium and high,
the normal tipped by the slope of a world-space field of buttresses some 60
to 200 m across (finite differences of smooth 3D noise, not screen
derivatives, so it does not speckle), so that under the low sun facets light
up and turn away between the gullies. Each fades out where a pixel covers
more than its scale.

## Frame K5's place

`landmarks.js` `K5` and `k5Site`: the place is a distance into the section
`sweepback` (101 m: where the road, due south off the gully bridge, begins
its right turn), and everything of the frame is placed from it: the drum
tower beyond the right edge, the flags and the chevron beyond the left one
(metres past the place and beyond the solid edge, so a change of the corridor
moves them with it), the far lamps on the low shore below (bearings and
distances from the place, kept where the ground is just above the water),
and the far cones across the sea (far.js). `inK5View` says whether a point of
the map lies in the frame's view (bearings 128 to 238 from the place, within
3 km, or within 260 m of it): the pale hall of D3 is kept out of it.
`k5.js` builds the scenery as one mesh of coloured triangles (the drum in dark
ribbed panels, its walkway, roof and railing, the flags' poles and bowed
sails, the chevron board), one pane for the window and a cloud of points for
the lamps: three draw calls where it is in view, about 1300 triangles on low.
The window and the lamps are emissive, switched by `lamps.windows` and
`lamps.street`; no light is added.

## The sun's shadow

`sun.js`: one directional light, one shadow map that follows each view
(`prepareView`): a square a little ahead of the car along the camera's
heading, moved in whole texels so the edges do not crawl, faded out over the
last 8 % of the square. Under a low sun a square map is mostly wasted: level
ground of the square spans only `reach` x sin(height) in the light's view.
So the map is cut to that plus 14 m (`RECEIVER_HEIGHT`: the car, walls,
boards, the lower crowns) times cos(height): by day (16 degrees) about 27 m
instead of 56 on medium, twice as many texels along the ground towards the
sun; at golden hour (2 degrees) about 16 m, three and a half times. Occluders
need no room of their own: whatever shades a point of the ground lies on the
same line to the sun, so it is in the map wherever the point is. The normal
offset is 0.8 of the larger texel (it was 1.6, which under a 16 degree sun
lifted the road 9 cm into the light and set the car's shadow 30 cm off its
tyres). The filter (three.js's five-tap PCF) is 1.0 / 1.2 / 1.6 texels wide
on low / medium / high (`SHADOW` in sun.js; it was 1.2 / 1.8 / 2.5). The car also lays its own contact shadow (the CAR lane's
`car/shadow.js`), which no map is fine enough to draw.

## Boulders

`boulders.js` (forest lane): a unit icosahedron squashed into an ellipsoid
and lumped by smooth noise of the direction (the same at every copy of a
corner, so the non-indexed facets stay closed), then FRACTURED: three to five
planes, everything beyond a plane pressed back onto it, which leaves the flat
faces and sharp arrises of granite split along its joints. Painted per
vertex: the granite flecked, lichen in pale patches, moss where a face looks
at the sky (the grass's own green), the foot dark where it stands in the
earth. Its corners are then merged and it is shaded smooth (detail 3 on
medium, 4 on high: a facet of a 5 m boulder read as a low-poly model). Where
the ground falls away from the road, a big block reaches up to the road's
level all the same (taller, standing on the ground). Two shapes (a weathered `round` one and a split `block`), each one
instanced mesh, scaled, turned and tilted per boulder. groundCover.js places
each with its middle at least its plan radius (the shape's own widest reach
in plan at the largest scale, plus 15 cm for the tilt) beyond the solid
edge, so no car can touch one; the low tier draws them as its plain rocks in
the granite's tone.

## The asphalt

`road.js`, `roadTextures.js`, `corridor.js`, `roadHistory.js`.

- **The mesh** is the Track sample by sample: every vertex is
  `track.pointAt(s, lat)`, the surface the physics drives on.
- **The stones.** A generated aggregate texture (tone, height, polish, a
  mottle) and a relief texture (normal, and in alpha the variance of the
  normals each mip level averaged away). Looked up twice at shifted places
  and blended, the places changing from one patch to the next, so it never
  repeats.
- **Variance-aware mips.** Far away many polished stones fall into one pixel;
  the averaged normal is flat and would shimmer as a mirror. The shader adds
  the stored variance to the roughness, so single glints near the camera turn
  into a steady satin sheen with distance (the idea of LEAN mapping, with one
  number instead of a covariance matrix).
- **The glare lobe.** A second, anisotropic specular lobe stretched along the
  line of sight lays the low sun's glare along the road as a long streak
  (`ASPHALT_SHEEN`, road.js `SHEEN`: along 0.12, across 0.15, at 0.28 of a plain dielectric), broken up by the stones. Dry asphalt keeps 0.25 of the standard material's own isotropic lobe, so that the streak is the sheen's; under water or paint it keeps all of it. The sky's sheen (`SKY_SHEEN`, gain 0.42) fills the shade at a glancing angle.
- **The tone** (road.js `ASPHALT`, road lane, fitted to frames E2 and E5):
  albedo from 0.11 on the newest surfacing (binder over everything) to
  0.22 a generation old (the binder weathered grey, the stones' tops bare), a
  shade warm, the single stones of the old standing apart by 1.05 times their
  tone about its mean. Sunlit it reads a pale to mid grey, in the woods' shade
  a cooler grey that keeps its stones; wet, its pores full, it keeps 0.25 of
  that (`damp`), so the wet night's road stays dark. The dry road's diffuse
  light from the sky and the fill loses half its colour (`shadeGrey` 0.5):
  in a wood's shade it is lit by the sunlit ground and crowns about it as well
  as by the blue sky, and E2's shade is a cool grey, not blue.
- **Wear** (road.js `WEAR`): each lane's two wheel paths (0.85 m either side
  of the lane's middle) darker by up to 16 % and smoother, the outer metre
  lighter, and faint streaks along the road: the large field stretched about
  three hundred times along it, which changes the tone by 14 % and thins the
  paint where the wheels cross it.
- **Grit** (road.js `GRIT`): small dark stones on a grid of 11 cm cells, one
  per cell at most, odds of 0.05 off the line rising by 0.2 towards each
  edge, none on the wheel paths or the racing line. A pixel that spans many
  cells shows their average darkening instead of single dots, so the grit
  cannot sparkle or crawl; up close each stone stands 3 mm proud.
- **The racing line and the history.** A polished darker band where cars run,
  rubber in the bends and the braking zones; runs of surfacing with joints,
  seams 2 m either side of the middle, patches (about one per 300 m, more on
  old runs), cracks sealed with tar (about one per 90 m), expansion joints on
  the decks, tyre marks before the carousel: single things placed by rule
  along the Track (roadHistory.js, its own `rng` forks) and drawn exactly.
- **Paint** (road.js `PAINT`): a solid white line inside each edge, the start
  line and the grid's boxes, and where a piece carries one a double yellow
  centre line; a few millimetres proud, its edges following the stones it was
  sprayed over by a centimetre or two up close, worn where tyres cross it
  (flecked through along the wheel paths, thinner, the asphalt's grey
  showing) and cut away where the road was patched.
- **The edge:** a thin band of dust and grit along the pavement's own edge
  (`ASPHALT.rim`), then the margin's older, dustier asphalt.
  Where a piece's scheme asks (forest lane, `uScheme`: one texel a metre,
  read nearest so that a line begins exactly at its piece's end) a double
  yellow centre line with short dashes beside it into the bend, the road
  lane's old surface with more sealed cracks and less rubber, and a flush
  precast concrete strip 0.32 m wide along the margin's outer side. All of
  it is paint and tone on the profile: the course is unchanged.
- **Wetness** (one shared uniform, the time of day's `wetness` or `?wet=`):
  water fills the gaps between stones first (the height channel says which),
  puddles stand in the wheel tracks and low spots, the road under the
  tunnel's roof stays dry. On medium and high a **planar mirror**
  (`src/engine/PlanarMirror.js`) is drawn per view about the road's plane
  under the view's car, with an oblique near clip, into a reduced target to a
  short far plane, without redrawing shadow maps; the asphalt reads it
  projectively, pushed by the aggregate's normal, drawn out into a streak
  towards the viewer by roughness, weighted by Fresnel and the wetness. After
  rain the whole surface carries a thin film, not only the puddles: outside
  the standing water the asphalt shows the mirror's streaked copy at 0.55 of
  a puddle's strength (road.js `FILM`), so every lamp, board and window lies
  on the road as a long vertical streak. On low there is no mirror: the
  heads of the six lit lamps nearest the eye (lamps.js fills `road.glints`
  each view) are drawn into the water analytically as the same streaks (a
  lobe about the mirrored view, narrow across the plane of incidence, long in
  it), and on every tier the cars' tail lamps are drawn so too (`TAIL_GLINT`,
  only behind the car), which the mirror cannot show.
- **The tail lamps' pool** (`TAIL_POOL`, dusk lane): on dry asphalt too,
  from dusk on, each lit tail lamp lays red light on the road behind its car
  (falling with the square of the distance, only behind the car, three times
  as much with the brakes on), as the head lamps lay their pool ahead.
- **The canopy** (`src/assets/world/canopy.js`): what the woods beside the road
  hide of the sky, defined once from the Track's `woodAt` and multiplied into
  the baked sky share (`aBake.z`) of the road, the kerbs and the verges, and
  into the car's own sky by the game. A wood is a wall of crowns 16 m
  (broadleaf), 18 (mixed) or 20 (conifer) high plus the hillside's rise under
  it, its face 3.5 m nearer than the first trunks; a wall standing up to an
  angle t hides (1 - cos t) / 2 of a cosine-weighted sky, the low sky it hides
  counts 1.3 times (it is the bright part by day), the leaves stop 0.85 of it,
  averaged 15 m either way along the road, never below 0.3. In a wood on both
  sides the road keeps about 0.35 to 0.45 of the sky; on the ledge, with the
  bank's wood on the right, 0.5 to 0.8; in the open 1. The sun that reaches
  the road there stands out against real shade.

## The frame

In detail in [engine.md](engine.md). One render call per view into a
multisampled half-float target with a depth texture (a second call would draw
over a resolved, discarded buffer); then ambient occlusion at half size
(scalable ambient obscurance, bilateral blur, applied), motion blur from the
depth and the camera's motion with the cars held sharp (their boxes, passed
in, are excluded from the streak: the blur is camera blur round them), a
bloom pyramid with a Karis average on its first halving, a one-pixel flare
source that measures the sun in or just outside the frame for the lens ghosts
and the glare, a star on the glints, and a final pass: exposure, tint,
vignette, a filmic tone curve, saturation, split toning, lift, sRGB, grain and
dither. On low the blur is done inside the final pass and FXAA replaces the
multisampling. Every pattern (blur jitter, AO rotation, dither) is a function
of the pixel, grain of the run's own clock.

## The sea (from demo 01)

`src/engine/waves.js`, `src/assets/world/sea.js`, the coast in
`src/assets/world/terrain.js`. Demo 01's sea brought into this frame: 03
does not import from 01 (each demo builds alone); the port is 03's own, and
inside 03 the sea is defined once: the waves in waves.js, where the water is
in terrain.js (`terrain.sea`), how it looks in sea.js.

**Where it is.** The terrain's height function makes the coast: outside the
loop, at a bearing from the course's middle outside the mainland's
(`SEA.mainland`), the land falls from the road's own height to the water
55 to 170 m beyond the solid edge, steeply at the last (a cliff), and the
seabed shelves away beyond (`coastAt`). Far from the road the valley itself
sinks to the seabed in those bearings. The lake's ellipse, drawn out to the
west, makes the bay. Which low ground is sea is decided by a flood from the
open water over the 16 m field: whatever it does not reach is a hollow,
which `keepDry` holds just above the water, because the water is one level
plane drawn everywhere (the land covers it where it stands higher). Cells of
the grid and the far land wholly 2 m under the water are not drawn (fewer
triangles than the lake's world had, on every tier). At start-up the
terrain also writes the **sea map** (512 x 512 over 4.8 km): the depth, and
two chamfer distance fields (the land's distance from the water, the
water's from the land). The water reads it for the shallows and the surf,
the ground for its coastal colours. Seven sea stacks are bumps in the same
height function, placed by `rng.fork('stacks')` in the open sea 30 to 120 m
off the shore.

**The surface** is 01's: a sum of trochoidal (Gerstner) waves with deep-water
dispersion, the vertex stage moving a camera-centred radial grid (01's, rings
spaced to keep the cells square) and the fragment stage summing the analytic
slopes for the normal. Each wave is dropped from the mesh where the mesh has
fewer than about five vertices per wavelength, and from the normals where it
is smaller than a pixel (01's rule: at sqrt(570 h L) m for an eye h m over a
wave L m long). New here: the slope variance a wave stops drawing is added
to the highlight's (`lost`, alpha^2 = alpha0^2 + 2 sigma^2), and so is the
ripple map's when it fades with the footprint of the pixel. Close to, the
sun breaks into glitter on the facets; far out the same light is a smooth,
wide path: no shimmer, no aliased sparks, with nothing to tune by distance.
The swell is long and soft (150, 98, 63 m), the chop and the short waves are
a light breeze's. (Round 2, frame E1) **Wave groups**: a sum of a few long
trochoids seen from 100 m up reads as ruled lines. Each wave's amplitude is
multiplied by its own slow factor, 1 + 0.65 cos(g . p + phase), with g about
7.5 wavelengths long and turned 65 degrees off the wave (`GROUPS`): sets and
lulls in the swell, rough and calm patches in the chop. The factor is applied
in the mesh's displacement, the normals, the crest test for foam and in
`sampleWaves` alike (the sea is still defined once); its own slope is left
out of the normal (it is a hundredth of the wave's).

**The shading** is a MeshStandardMaterial with the surface written into it
(shading.js `extend`): the sun or moon, the sky's environment map, the fill,
the shadow map and the haze reach the water as they reach the land, and the
time of day's light is all the colour it has. 01's analytic sky becomes the
environment map; 01's rule that a facet tipped past the horizon shows the sky
just over it, not the ground under it, is kept (the normal is bent). The body
is an albedo (what comes back up out of the water: deep blue, greener over
the shallows by the sea map's depth), lighter at the tops of the waves, with
01's light through the wave's top towards the sun as a small added term.
Foam is 01's: the swell's Jacobian now and a moment ago leaves streaks behind
crests; the surf is bands that run in with the swell over the last 14 to
26 m of water (the sea map's distance to land), warped by the lace texture;
far away the lace becomes a share of white. At night the six lamps the wet
road glints with (lamps.js picks them per view) are drawn into the water as
streaks, a lobe about the mirrored view narrow across the plane of
incidence and long in it, widened by the roughness. Far out the water fades
into `hazeColor` of its own direction, which is what the sky dome shows just
under the horizon, so the disc's edge never shows. Not 01's: the wake, the
mirror (a planar reflection would be a scene pass: the sea reflects the
environment map only), caustics and the sandy bed.

**The coast road's cliff** (round 2, `COAST` in terrain.js). The near
profile beyond a sea side's solid edge (`nearAt`) is replaced, by the side's
coast weight eased over 30 m along the road, with `coastCliff`: a lip, then
`top - (top - foot) * smoothstep(t)` down a run of `drop / steep` metres,
then the seabed. Two things would undo it. The 16 m land-shape field is
smoothed three times, which turns a cliff into a 50 m slope: so after the
smoothing each cell off a sea side is pulled down to the same cliff
(`coastCell`), and those cells seed the sea's flood. And the band and the
grid blend the near profile into that field from 10 m out, adding the land's
small hills and `keepDry`'s lift: on a sea side the near profile is kept to
the edge of the road's reach (the last 40 m blend), the hills are left off,
and nothing is lifted (only the sea stacks stand out of it). The spur inside
the carousel (`COAST.knoll`) is a ridge from the hairpin's centre (the
Track's point at the piece's middle, `r` to its inside) down the tongue
between its legs, added after the two legs' grounds are blended, so both
legs see the same hill, and only beyond the cut's top.

**The low crossing and the big waves** (round 2). The causeway is the same
cliff function with other numbers (a 2.5 m lip, a bank 0.6 down per metre),
applied to both sides of a stretch of `back` (`seaSide`: on the inside it
fades out beyond the lagoon's width, so the land comes back), and on the
lagoon side the seabed stops at 9 m. The big swell is a factor on the swell's
amplitudes only, a smoothstep bump round one place (`BOOST`, set by
`waves.setBoost` from `terrain.sea.surf`): in the shader it multiplies the
same `waveGroup` factor that the sets and lulls use, so the mesh, the normals,
the Jacobian foam and `sampleWaves` all see one surface.

**The inner sound and the volcano** (round 3). The water inside the loop is
the same sea plane: the sky road's and the plunge's right sides are coast
sides (their cliff), and a disc round the island drowns the land-shape field
and the near ground alike (`sound`, applied after the coast's override in
the 16 m field, where it also seeds the flood, and in `heightOf` and `land`),
fading out within 60 to 120 m of any solid edge so that the course's own
ground and frame D3's bank stay. The island is a height function taken as a
maximum over everything else (`volcanoAt`), so the cone, its crater and its
gullies are ground like any other: baked, shaded and drawn by the terrain.
The plume (volcano.js) is an open tube bent downwind by the square of its
height in the vertex stage, its alpha broken into wisps by value noise that
rises with the run's clock; the glow is an additive disc whose radiance is
set from the time of day's sun strength, never by name.

**Per-piece road markings** (round 2, road.js `PIECE_MARKS`). A scheme per
piece id, each scheme one channel of a per-metre RGBA texture (`uMarks`,
sampled at s / length like the edge texture), eased over 6 m at its ends.
'coast' (channel r) is a double yellow centre line: two 0.12 m lines 0.12 m
apart, painted with the edge lines' wear and weight but a yellow paint
colour. Channels g, b and a are free for other schemes.

**Per tier**: low a flat disc (32 segments, four rings, 160 triangles) and
the 7 longest waves in the normals; medium 96 segments moved by the swell,
9 waves; high 160 segments, all 11. The clock is the run's (`world.update`),
the eye's height sets the waves' reach in `prepareView`.

## What each pass draws (the budget)

`__dreamcar.stats()` counts the draw calls and triangles of a whole frame:
the scene, the sun's shadow map, the car's probe faces and the wet road's
mirror together, so each of those passes is a share of one budget (spec.md,
"Quality tiers and budgets"). What kept those passes expensive was not the
detail of things but three.js's culling, which tests one sphere per mesh: a
row of posts, a rail or a strip of glow that runs round the whole lap in one
mesh is inside every camera's frustum, so every pass drew all of it. After
the world is built, `chunk` (`src/engine/chunks.js`) cuts every mesh under
the structures, the kerbs and the rock whose sphere is wider than 300 m into
pieces by a 400 m grid on the ground: children of the original that share its
vertex buffers (plain meshes get an index of their own, instanced ones their
cell's matrices and colours) and carry its material, shadows and layers. The
original stays in place, taken off every layer, so lists that hide it (the
mirror's, the probes') still work. Smaller cells cull more but cost draw
calls, of which `low` has 150.

Other passes leave out what cannot show in them: the mirror the lamps' glow
(it lies on the road, which the mirror leaves out) and the rails (30 to 40
thousand triangles of dark lines low beside the road, which its streaks smear
away), the skid marks draw only
the slots some wheel has used (none on a clean run), and the glow under the
lamps is a coarse grid (5 columns, a row every 5 m: the light itself is
worked out per pixel), one mesh per kind of lamp, hidden while that kind is
off (the street lamps by day).

The finish lane's pass on draw calls (each a call in every pass that sees
it), none of it visible at the size a player sees it:

- **One mesh per material per piece.** The lamps' poles, arms and housings
  are one baked geometry, the street lamps' and floodlights' emitters and
  glow one mesh each (lamps.js); the rail posts are in the beams' mesh (their
  texture coordinate v = -1 paints them as the posts' steel); the viaducts'
  abutments are in the deck's mesh and their rail posts in the rails'; the
  walls' runs are one mesh; the dressing's patches are 400 m squares (they
  were 160 m), and on `low` the low dressing is in the same patches as the
  rest. The terrain's band and the road are cut into pieces of `PIECE`
  metres (terrain.js: 400 on low, 240 on medium, 160 on high), the grid into
  squares of about 400 m on low and medium.
- **A draw distance for small things** (`SMALL_REACH` in world/index.js: 300,
  500 and 800 m by tier, twice that for the barriers' beams): a piece of
  kerbs, lamp poles or barrier whose sphere lies wholly beyond it is not
  drawn in any pass of that view. The lamps' heads, cones and glow, the
  boards and the buildings are not in the list.
- **What each pass leaves out.** The mirror: also the viaducts, the lamps'
  cones and their heads (it has their halos). The probe: also the kerbs, the
  ground cover and, on medium, the rails; on low the near trees (the
  impostors stay) and the small things. The tunnels' four veils of daylight
  are culled and not drawn while they add nothing.
- The kerbs' beads and the rails' reflectors answer the head lamps in their
  own shaders (retro.js), with no light and no mesh of their own.

## The lamps at night

`src/assets/world/lamps.js`. 150 lamps: 23 street lamps on the straight
(warm), 69 floodlights 12 m high every 55 m round the rest of the lap (a
cooler white; on the inside of every bend tighter than 1500 m, alternating
elsewhere; none in the tunnels or within 25 m of a portal, none on the ledge's
first bend, frame D3's place; the 47 behind a rail stand 2.5 m back from it,
on the ground there, so that no pole is ever between the chase camera and the
car; one that would stand at a rock face goes to the other side if there is a
rail there; the 4 in rock cuttings and the 18 at parapets stand at the edge),
58 in the tunnel. The scene still has the same
fixed pool of real spot lights (2, 4 or 6 by tier); everything else a lamp
does is drawn: its head (an emitter that blooms), its glow on the ground
(worked out per pixel from the same spot light, darker on wet ground), its
cone in the damp air (lighting.js `lamps.haze`: an open cone from the head to
the ground, additive, as bright as the length of air a ray crosses in it,
fading towards the ground and when the eye comes within 36 to 12 m of it), its
halo in the road's mirror, and its streak in the wet road. How far each lamp
is on and its share of the pool are one texel each of a small texture
(`shares`), read by the glow, the cones, the halos and the tunnel's bore:
150 lamps as two uniform arrays would be more uniforms than a phone's shader
holds.

Drawn as few meshes as there are materials: every pole, arm and housing is
baked into one geometry (`lamp-fittings`; the tunnel's fittings are
tunnel.js's), the street lamps' and floodlights' emitters into one
mesh whose vertex colours carry each kind's colour and radiance, and their
glow into one mesh (they switch together); world/index.js cuts each into the
400 m pieces. A piece of lamps costs a draw call per material, not per part.

What answers the head lamps without a light of its own (retro.js): the road's
lines (road.js), the kerbs' white paint (beaded, in specks, brightest on the
teeth's faces that look at the car) and a reflector painted on the rail's
upper beam over every fourth post. Each is a term in its own shader from the
cars' lamp positions and directions (`beams`, uniforms), sending back towards
the eye what the beam lays on it times a coefficient that falls steeply with
the angle between the lamp and the eye; the reflection probe's faces see none
of it. No light is added and no draw call.

## The tunnel

`src/assets/world/tunnel.js`; the reference is docs/design.md, "The tunnel".
A box swept along the road from one cross-section (`section`: kerb face at the
Track's solid edge, walkway, wall, chamfer, flat ceiling; corners doubled so
the normals stay sharp), a row every 2 m (4 m on low: its faces are flat and
the bend is 1000 m). Each vertex carries where it is in the box (`aLocal`: s
from the portal, lat, h) and its section's normal, and the box's shader paints
from those alone: cast panels 5 m long with fine joints that fade out before
they alias (`fwidth`), the dado's joint, grime at the foot, the ceiling's
slabs and its soot, the walkway and its pale kerb face.

**Its light.** The Track hangs a lamp every 12 m on each side
(`tunnelLamps`), and each lamp carries a `gain`: the entrance zone's lamps are
2.4 times as bright, the exit zone's 1.4. Those are the lamps lamps.js hands
its fixed pool of real spot lights to near the car (so the car and the road
are lit for real; the gain scales a light's intensity) and the lamps the box
bakes: its shader finds the six rows nearest a fragment from s alone (they
are evenly spaced) and sums what each would lay there with the spot light's
own formula (`SPOT_GLSL`), times one minus its share of the pool and its gain
(a texel each in lamps.js `shares`: red on, green share, blue gain / 4), plus a
bounce term. The lamps hang over the shoulders, 0.6 m in from the kerb faces,
leaning across the road: the far wall is lit evenly down to the walkway, the
near wall low and dark high, which is how the video's walls look; hung at the
wall, each lamp laid a hot scallop on the wall beside it. The fittings
themselves are emitters (one mesh of vertex colours with every other thing
in the tunnel that glows: guidance lights, door frames, signs, signals,
arrows), far brighter than what they light (`head`, 60 times the lamps'
colour), so they bloom and the reflection probe sees them; they are not
lights. No light was added to the scene.

**What the road mirrors** (road.js `TUNNEL_SHEEN`). The tunnel's road is
dry, so there is no planar mirror there; the asphalt follows its own mirrored
ray up to the plane of the fittings, finds how far across it passes from
either line and how densely the line is lit where it meets it (the zones), and
adds that as a soft streak, blurred more the further the ray travels, at the
strength of its sky sheen (`roadSkySheen`, falling with the angle). The tail
lamps are the wet road's `wetGlint` lobe made broad and short. The walls'
light falling back onto the road (`bounce`, what the sky's fill is outside)
is added, and both that and the lamps' direct light are shaded under each car
by a soft rounded box round its plan (`shade`): the sun's shadow map does not
reach in, the pool's spot lights cast none, and without it the car floated on
its contact shadow alone.

**The car in it.** What makes the paint and the glass is the probe: inside
the box its faces see only 160 m (`PROBE.tunnelFar`: what lies beyond is
culled) and on medium two faces are redrawn every other frame instead of one
(`tunnelFaces`), so the cube is a tenth of a second old at speed and the lines
of fittings slide over the roof, the shoulders and the glass with the car.
The probe stands at the middle of the car, knows directions only and sees
the fittings as broad stand-ins a fifth of a second old: in the paint they
came out as blotches and broken flecks. So the car draws the two lines of
luminaires itself (car.md, "In the tunnel"): each reflected ray is followed
from the body's own point to the lines' plane, with the rows of bars and their
places read from the tunnel (`BORE_UNIFORMS`, `LUMINAIRE`) and the car's place
in the road's frame handed over by the game each frame (`setBore`); the probe's
read is held to a few times the lining's radiance under the roof, so the
fittings in it do not double them, and box-projected onto the walls and the
ceiling. In the tunnel the probe hands the materials the bore as a box (wall to
wall, road to ceiling, 30 m each way: `probeBox`, GLSL_PROBE_PROXY), and the
car's materials read the probe through it (box projection), so the walls and
the ceiling stand at their true distance in the flanks.

**The portals and the cuttings.** The faces are a rectangle with the mouth
cut out (ShapeGeometry), a reveal, a lintel standing out, a coping. The
entrance (towards the woods) is weathered, with warm lamps under its lintel, a
chevron board and a banner (one of the circuit's made-up boards, signs.js
`paintBoard`, on its own canvas); the exit is pale, with a railing on its
parapet. Out of the exit, upright retaining walls as high as the terrain's
cliff there (the `cutting` preset makes it 5 m) carry the acoustic screens:
one quad from post to post, as high as the lower of its two ends, so the
steps are square; their slats and rails are a shader on world position
(`screenShader`), not geometry. Into the entrance, sloped revetments over the
last 75 m, upright at the face. Both stand where rock.js would put its rock
faces (`concreteCut` tells it where not to), in front of the terrain's own
cliff (never more than 0.7 m behind the solid edge: the cliff's foot is at
0.8 m). Everything of one material is one mesh per tunnel; world/index.js cuts
it into 400 m pieces. On low: no housings, no pipe or tray, a plainer gantry
and railing, the banner as a colour.

## Determinism

- **One fixed step**, 1/120 s, for everything that changes the run: physics,
  rules, the camera's springs, the exposure's eye, the clouds' drift, the
  gantry's lamps, the ghost's recording. The render only interpolates.
- **No `Math.random` and no clock** in `src/` outside the engine's loop and raw
  gesture handling. Random numbers come from `rng.fork('name')` of the run's
  seed (`?seed=`), one named stream per user, so adding a user does not shift
  anyone else's numbers.
- **`?manual`** stops the loop: frames come from the page handle
  (`__dreamcar.advance`, `skip`) and `?t=N` runs N seconds before the first
  frame. Because the steps never depend on whether a frame was drawn,
  fast-forwarding without drawing finds the same run, and `?manual&t=…` is the
  same picture every time. The tests and the screenshot tool rely on it.
- **Laps are integers.** Line crossings are interpolated inside the step and
  rounded to whole milliseconds once; every reader uses that integer.

## The staging camera

`setPhoto` in `src/game/Game.js`, `_photo` in `src/game/Cameras.js`.
`__dreamcar.photo({ back, right, up, yaw, pitch, fov })` (or a name from `PHOTOS` in `config.js`: `d1`, `d3`, `d4`, `e1`, `k5`, `waves`, which also set the moment of the autopilot's run and the time of day) places every view's
camera `back` m behind, `right` m right of and `up` m above the car's origin
in the car's level frame (its heading only, not its pitch or roll), turned
`yaw` degrees left of the heading and `pitch` degrees up, with a lens of
`fov` degrees top to bottom whatever the picture's shape. It reads nothing
but the car's pose, so with `?manual` the same run gives the same picture. The
HUD hides unless `hud: true`; `photo(null)` gives the views back to their
rigs. `?photo=back,right,up,yaw,pitch,fov[,hud]` does the same from the
address. A camera ahead of the car looking back at it has a negative `back`
and a `yaw` near 180. `tools/screenshots.cjs` stages every picture of the
docs with it, at distances along an autopilot run.
