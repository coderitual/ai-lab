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
the loop, falling towards the lake and the valleys, a ridge over the tunnel,
a ravine under the sky road), with ridged noise on top; far away, mountains.

It is drawn in three pieces that meet without cracks: a **band** that follows
the road row by row with the Track's samples, its columns on the corridor's
own kinks (so it is exact where the eye is closest); a **grid** of square
cells over the course with the band's cells dropped; the **far land** in
100 m cells. The road's outermost vertices are the band's innermost ones.

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

On a touch screen the thumb is read against a fixed slider
(`src/engine/Input.js`): the steering is the thumb's distance from the
slider's centre over its half travel, worked out in the pointer handlers and
stored, so the fixed step only reads a number. The slider itself is linear;
the curve that makes small corrections easy at speed is the hands'
(`HANDS.thumb.expo`, the same place as a stick's). Every control owns the
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
(`src/engine/ReflectionProbe.js`): a cube picture of the surroundings round
the car, a face or two a frame at speed, a larger cube redrawn whole while the
car is still (the title, the grid), sizes in `PROBE` per tier. The probes
leave out what would only cost (the start's dressing, the town; on `low`
also the rails, the guide posts and the lamps' glow, which are less than a
texel of its 64-texel faces). A face sees the whole world round the car and
costs about as many triangles as the view, so on `medium` one face is
redrawn every other frame at speed and two every third frame standing still
(`PROBE.every`, `stillEvery`). What is big and far is drawn for the probes by
a cheaper stand-in on `PROBE_LAYER`, a layer only the probes' cameras have:
the massif's grid on every other column and row (a quarter of its triangles);
the full grid sets its draw range to nothing for a probe's camera.

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
  shadow camera sees: two triangles a tree.
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
silver rims near the sun; at golden hour, lit from below. By night the same
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
  (`ASPHALT_SHEEN`: along 0.45, across 0.06), broken up by the stones. Dry asphalt keeps 0.3 of the standard material's own isotropic lobe, so that the streak is the sheen's; under water or paint it keeps all of it.
- **The racing line and the history.** A polished darker band where cars run,
  rubber in the bends and the braking zones; runs of surfacing with joints,
  seams 2 m either side of the middle, patches, sealed cracks, expansion
  joints on the decks, tyre marks before the carousel: single things placed
  by rule along the Track and drawn exactly.
- **Paint:** a solid white line inside each edge, the start line and the
  grid's boxes, a few millimetres proud, worn where tyres cross it.
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

## The lamps at night

`src/assets/world/lamps.js`. 150 lamps: 23 street lamps on the straight
(warm), 69 floodlights 10 m high every 55 m round the rest of the lap (a
cooler white; on the inside of every bend tighter than 1500 m, alternating
elsewhere; none in the tunnels or within 25 m of a portal, none on the ledge's
first bend, frame D3's place), 58 in the tunnel. The scene still has the same
fixed pool of real spot lights (2, 4 or 6 by tier); everything else a lamp
does is drawn: its head (an emitter that blooms), its glow on the ground
(worked out per pixel from the same spot light, darker on wet ground), its
cone in the damp air (lighting.js `lamps.haze`: an open cone from the head to
the ground, additive, as bright as the length of air a ray crosses in it,
fading towards the ground and when the eye comes within 6 to 24 m of it), its
halo in the road's mirror, and its streak in the wet road. How far each lamp
is on and its share of the pool are one texel each of a small texture
(`shares`), read by the glow, the cones, the halos and the tunnel's bore:
150 lamps as two uniform arrays would be more uniforms than a phone's shader
holds.

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
`__dreamcar.photo({ back, right, up, yaw, pitch, fov })` (or a name from `PHOTOS` in `config.js`: `d1`, `d3`, `d4`, which also set the moment of the autopilot's run and the time of day) places every view's
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
