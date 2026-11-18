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
The swell is long and soft (150, 98, 63 m; seen from 30 to 80 m up its lines
are what reads), the chop and the short waves are a light breeze's.

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
The probe stands at the middle of the car and knows directions only: a line 5
to 6 m overhead is mirrored almost where it should be on the roof and the
glass, and a little wide on the flanks. A correction for the ceiling's plane in
the car's materials, as `carGround` corrects for the road's, would put them
exactly; it has not been made.

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
