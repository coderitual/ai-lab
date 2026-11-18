# The car

One car: the owner's silver Mercedes-Benz C-Class saloon (W206, AMG Line), as
seen from a chase camera a few metres behind it, circled on the title screen,
and from a metre and a half in a close-up, by day and by night. Everything
about it is generated at start-up: the body from a table of lines, the glass,
lenses and shut lines from outlines baked into a texture of distances, the
lamp units, grille and cabin as small solid parts placed by rays at the skin,
the wheels from a plan measured on a photograph, the plates and the tyres'
size marking with a pen of its own on a canvas. There are no model, texture
or font files and nothing is fetched.

The measurements are in the modelling sheet (`specs/car-reference.md` in the
build's scratchpad, with its tables as data in `carref-tools/tables.json`);
every number there is marked published, measured or estimated. The viewer
(`viewer.html?asset=car`, parameters at the top of `src/viewer.js`) shows the
car alone under the world's light; `pin=` puts its camera exactly where one of
three photographs was taken from, so a still can be laid over the photograph
pixel on pixel; `studio=1` stands it in a plain studio and `stripes=1` in a
light tunnel (with `mirror=1`: the paint as a plain mirror), for judging
surfaces.

Axes (car space, `spec.js`): origin on the ground, on the centre line, midway
between the axles; +Z forward, +Y up, +X the car's left. Metres.

## Files

| file | holds |
| --- | --- |
| `spec.js` | the dimensions, hard points, wheel and lamp positions; read by the model, the physics, the cameras and the effects |
| `lines.js` | the body's shape as tables: the lower edge, widest line, shoulder, centre profile, glasshouse lines, section fullness |
| `spline.js` | curves through those tables |
| `skin.js` | one bicubic B-spline surface S(u, v) over the left half, lofted through the lines |
| `body.js` | the skin sampled into a mesh (per tier), the atlas layout, wheel-arch holes, lips and liners |
| `features.js` | outlines of everything flush with the skin: glass, lenses, grille, intakes, shut lines, reflectors, arches |
| `atlas.js` | bakes those outlines into two RGBA8 textures of signed distances over the skin |
| `materials.js` | paint (and every flush region it turns into), glass and lenses, trim, lamp parts, plates, dark insides, ghost; how every car material reads the reflection probe |
| `parts.js` | the tools for small solid parts: rays at the skin, a list of triangles per material |
| `details.js` | the solid small parts: stars, grille pins and louvre, intake slats, pipe trims, diffuser fins, mirrors, handle grips, wipers, plates and their frames, third brake light, plate lamps, cabin |
| `lampUnits.js` | the head and tail lamp units behind their lenses, as geometry |
| `plate.js` | the Polish number plate's picture, and the stroke characters it (and the tyres' marking) are written with |
| `lamps.js` | the lights the lamps cast: two head-lamp spots with beam pictures, one red spot behind |
| `wheel.js`, `wheelTextures.js` | a corner: tyre, five-twin-spoke 19-inch wheel, brake; the blur shells for a turning wheel |
| `shadow.js` | the contact shadow, laid on the road by the game |
| `studio.js` | dev only: the studio and the light tunnel of the viewer |
| `index.js` | `createCar()`: assembles it all and returns the handle (`CarModel`, see the build contract) |

## How it is made

### The skin and its curves

The body is one smooth surface. `lines.js` holds a few lines that run the
whole way round the half car (lower edge, widest line, shoulder), the centre
profile over bonnet, roof and boot, and the glasshouse lines (belt, top of
the side glass, where the screens end). `skin.js` builds a control net of 42
by 25 points from them and evaluates a bicubic B-spline: it never overshoots
and is curvature-continuous, which a mirror-like paint needs. Creases (the
shoulder, the boot lid's lip, the foot of each screen) are rails placed close
together, not kinks. The net is reflected in the centre plane, so the halves
meet without a seam.

Round the tail the sections fan from the last main section to the centre
plane. That is where the surface is hardest to keep fair, and the game shows
the tail all the time, so it follows four rules:

- Every fan section stands in one upright plane through an axis on the centre
  line (where the main sections end): the widest line is divided evenly, the
  lower edge and the shoulder are cut by that plane.
- The three lines it is cut from are smooth corners there: Lame curves,
  sampled every 5 cm or so into the tables. Their plan curvature falls
  steadily from the hip to the centre line; the earlier hand-placed points
  changed its sign four times and every reflection in the tail wobbled.
- The rails between the lines keep the proportions they have at the hip all
  the way round. Proportions that changed round the fan gave every section a
  different profile: dents beside the plate, a fold at the bumper's corner.
- The boot lid's top is one height over the plan (`lidY` in `skin.js`: the
  centre profile's height, crowned down to the lip by `SHAPE.lidCrown`), and
  the lid's sections end on the centre line along `SECTIONS.lidCentre` to the
  lip, not at one point. Crowned per section and all meeting at the lip's
  centre, they made two dents and a crease from the star outwards.

The lip itself is level across (0.925 at the corner to 1.008 on the centre
line), with the lamps below it, as on the car; it used to dip 0.1 m to the
lamps' upper edge, and the lamps stood on the crease like fins.

To judge a change to the surface without a browser, the lane's tools render
the skin alone in Node as a zebra (reflection bands) and as maps of its
curvature along and across, where any concave patch shows at once.

`body.js` samples the surface once per tier at an edge length of 95 / 56 /
36 mm (low / medium / high), finer where rails crowd. Normals are the
surface's own, so even the coarse mesh mirrors cleanly. The same vertices are
drawn several times with different index lists: paint, glass, lenses, and a
dark shell (every other vertex, BackSide) that shows through openings.

The front wings and the rear hips flare out over the tyres (`SHAPE.flare` in
`lines.js`, added to the flank's rails in `skin.js` by `flareAt`): an
outward step of a few centimetres over each arch, rising and falling as a
smootherstep along the car and weighted per rail, highest at the widest line
and the rails just above it (the front has a second, higher step over its
forward half, where the wing falls away to the head lamp). With it each
tyre's outer face sits 9 to 15 mm inside its arch lip over the part of the
lip that stands over the tyre (45 to 135 degrees round the arch; measured
with `skin.sideX` along the lip's outline).

Small forms a few millimetres high but sharp are not geometry; the paint
shader shades them. The bonnet's power domes, the door's lower crease, the
sill's groove and blade and the band round the arches are tilts of the normal
(`carForm`); the plate's dish, the dishes behind the door handles, the rear
corner scoops and the apron's wing are heights over the skin, turned into a
slope by `carBump` from the height's own screen derivatives. A height must
run out smoothly at the edge of the region it is defined in: a cut-off height
is a crease, and a crease shaded from derivatives is a staircase.

### The feature atlas

Glass, lamp lenses, the grille, intakes, shut lines and reflectors are flush
with the skin on the real car, so they are outlines (`features.js`), each
given in the view in which it is true (side, top, front, rear or square to a
lens). `atlas.js` projects every texel's skin point into each view and stores
the signed distance to the outline, 8 bits over +-30 mm. Shaders threshold
the distance and antialias it with its own screen derivative, so an edge
stays sharp at any distance. No mip maps on purpose: a mip level would average
a thin line away. Nothing can be asked of the atlas beyond its 30 mm: a band
wider than that inside a pane covers the whole pane (the rear screen's black
band was 35 mm, and the screen was opaque).

The shut lines are kept twice: unsigned (channel 2) and signed by the side of
the nearest line (channel 6). Interpolated between texels, an unsigned
distance only dips towards zero on a line, by as much as the texels happen
to straddle it, so at the high tier the 3 mm gap came out as a row of dots
at the texel pitch; the signed one passes through zero wherever the line is.
The paint draws `max(|signed|, unsigned - 0.8 texel)`: where the sign flips
away from any line (between two lines, past a line's end) the unsigned
distance keeps the false zero away.

| tier | atlas | bake (desktop) |
| --- | --- | --- |
| low | 512 x 256, x2 RGBA8 (1 MB) | ~110-150 ms |
| medium | 1024 x 512, x2 (4 MB) | ~200 ms |
| high | 1536 x 768, x2 (9 MB) | ~400 ms |

### The paint

`createPaintMaterial` is a `MeshPhysicalMaterial` with `onBeforeCompile`: a
layer of metal flake under a clear coat.

- **Base** (`PAINTS`: colour, metalness, roughness, flop, flake). Silver, this
  car's high-tech silver: linear 0.60 / 0.62 / 0.665 (cool), metalness 0.82,
  roughness 0.42, falling to 40 % edge-on (flop). A metallic paint, not
  polished metal: the flake layer shades softly from light to dark across a
  panel, light silver in the sun and mid grey turned away from it, and takes
  the sun as a colour of its own as well as a broad sheen. Round 4's 0.92 /
  0.27 mirrored everything, and next to the photographs the car read as
  chrome; at 0.6 / 0.5 and a brighter base it read as white plastic.
- **The flake layer's read of the probe** (`carSoftProbe`): a rough read is a
  read of a coarse mip, and the mips are plain 2x2 averages, so at these
  roughnesses a 128 or 256 cube is a few texels a face; filtered between
  them, the wood's autumn crowns came out as large blocky yellow patches on
  the bonnet and roof. The layer reads instead nine taps in a cone as wide as
  its highlight, at a mip four times finer: a smooth bell of the
  surroundings, no blocks, no face seams. What it shows is held to 65 % of
  its colour, and the probe's average round that direction still caps a
  small fierce thing in it (the sun's glare on the road behind the car, a
  lamp) at five times, so that it makes a highlight, not a burnt-out panel.
- **Clear coat**, roughness 0.03, a plain lacquer's reflectance (4 % face on,
  `COAT_GAIN` 1): the only crisp reflection, strong only at grazing angles.
  Its image is held to 45 % of its colour: at a grazing angle the nearly flat
  bonnet magnified the wood's bright yellow crowns at the horizon into a
  saturated yellow band across it (round 4 had the coat at 1.6 times, in full
  colour). Both layers read the car's own reflection probe
  (`setReflections`).
- **Flake**. The flakes are far smaller than a pixel; together they are the
  sheen. But each is a small mirror, and one that happens to send the sun to
  the eye flashes. The surface is cut into cells never smaller than a pixel
  (two octaves blended, so nothing crawls), each with a tilt and a brightness
  of its own; most lie nearly flat, so the glitter is dense in the sun's
  highlight and thins out round it. Strongest within arm's reach, gone by
  about four metres: the chase camera never sees glitter. (The cells must be
  `floor`ed: hashed per pixel they were salt all over the car.)
- **Orange peel**: a ripple a third of a degree steep on the coat's normal,
  only within about two metres.
- **Occlusion** (`carOcclusion` and the regions): the probe is drawn without
  the car, so by itself the paint would mirror a sunlit road under the floor.
  The underside, the door's shoulder under the mirror, the arch lips, the
  band under the boot lid's lip, the plate's dish, the handle dishes, the
  scoops and both sides of every shut line take less of the indirect light.
- **Shut lines** (from the signed channel, see the atlas): a 3 mm dark gap (at least one pixel wide, fainter in
  proportion when a pixel is wider) with a little shade either side and a
  catch-light on the rounded far edge: the direction of the fall comes from
  the atlas, its steepness is set in the shader.
- **Regions**: from the atlas the same shader turns into gloss black (window
  surround, B-pillar, the band under the glass's edge), the matte rubber seal
  round each pane, matte black (front lip, diffuser), bright metal (grille
  frame), the grille's field (matte-ish black, coat 0.3: as a lacquered sheet
  it mirrored the sky and the grille read grey) with its diamond relief and,
  on the low tier, its stars (`GRILLE_STARS`, shared with `details.js`), red reflectors, the
  plate carriers, the parking sensors. The fuel flap, on the right only, is
  analytic.
- The other paints (`graphite`, `blue`, `red`, `white`, `black`) are the
  same material with other numbers: `?paint=NAME`.

Every patched material has its own `customProgramCacheKey`: without it three
handed materials each other's programs (the gloss trim rendered white).

### The reflection probe, and what the game should give the car

Every car material reads the probe itself (`GLSL_PROBE`, by roughness), not
through three.js's `envMap`: given a cube render target as `envMap`, three.js
makes one prefiltered copy at first use and never looks again (the wheels,
which did that, mirrored the start line for the whole lap). Materials built
outside `materials.js` use `mirrorProbe()` from it.

A mirror that curves makes the picture in it small: neighbouring pixels then
look at directions several texels apart, and a sharp read aliases (the wood's
needles were a hatching all over the paint). So the probe is never read
sharper than the pixel's own footprint in it (`FOOTPRINT`): crisp on the flat
of a door, smooth round a corner, nothing crawling.

What that leaves visible is the cube's own size. A texel of a 256 cube is
0.35 degrees; a pixel of a 1280-wide picture looking at a door from five
metres is about 0.06. So:

| | cube | refresh |
| --- | --- | --- |
| title orbit, high | 512 (17 MB half float with its mips) | all six faces once, then one face every few frames: the car stands still |
| title orbit, medium / low | 256 / 128 | the same |
| the run, high / medium / low | 256, 2 faces a frame / 128, 1 face / 64, every other frame (as `TIERS` has it) | speed and motion blur hide the rest |

The coat's roughness of 0.03 reads mip 0 of cubes up to about 670 texels; a
1024 cube would need `clearcoatRoughness` 0.02 to show more than a 512 one.
`probesize=N` in the viewer tries any size.

Two guards on every probe read (`REFLECTIONS` in `materials.js`):

- `carSane`: a texel that is not a number, or overflowed half float, is
  replaced by the sky's radiance. At night the probe held NaN (written by the
  road's asphalt shader where the road is seen exactly edge on from the probe;
  see below), the mips spread it, and the paint sampled it: black here, a
  screen-filling white bloom on other GPUs.
- `carGround` (written, switched off: `REFLECTIONS(..., ground)` defaults to
  false): a parallax correction for the road's plane. On a 64 to 256 cube it
  magnified the road's few texels into dark blotches on the bumper.

### The glass

The glass and the lenses are the skin again, drawn after the paint at the
same depth with premultiplied alpha, so the reflection (the probe, at
roughness 0.02) is not dimmed by the transparency. Windscreen and front door
glass pass about half the light (55 % and 50 %: the photographs show dark
glass), the rear doors, quarter lights
and rear screen 15 % (privacy glass, as on this car), the roof 6 %. Each pane
has its black band under the edge (25 mm on the windscreen, 28 on the rear
screen); the rear screen carries its fourteen heating lines, drawn only where they
stand eight pixels or more apart (closer, at a phone's reduced resolution,
they beat into a banded moire over the screen). Behind it are
the cabin (`details.js`: seats with head restraints and bolsters, the rear
bench, dash and cowl, console, door cards, steering wheel, interior mirror,
parcel shelf, all black and lit by what sun comes through; under the roof
they see only 0.3 of the sky, or the seats shine grey through the side glass), the two displays
and the third brake light, 14 mm inside the rear screen below its band.

### The lamps and their light

The lamp units are geometry behind their lenses (`lampUnits.js`), placed by
rays at the skin so that they keep their depth whatever the mesh. All of both
lamps of both sides is one mesh with one material (`createLampPartMaterial`):
each vertex carries a function number (`LAMP_FN`) that decides its colour,
metalness and roughness unlit and what it emits when `setLights` switches
its function on. The paint discards under the lenses; the lens is the glass
material over the same skin.

- **Head lamp**: a gloss black housing let in behind the lens's outline (unlit,
  the daylight photographs show the inside nearly black: the bezels are a dark
  satin, the unlit brow a grey frosted bar); the
  eyebrow light guide with its hook just under the lens (daytime running
  light, position light, amber when indicating); the projection module (a
  glass dome in a satin bezel: dipped beam), the matrix module (main beam),
  a small auxiliary reflector and the small blue accent, in a row 45 mm in.
- **Tail lamp**: its outline was redrawn from the daylight photograph straight
  on the tail: a long wedge from an inner tip 0.325 off the centre line, its
  upper edge rising to a rounded outer end 0.2 high that wraps round the
  corner, the lower edge nearly level (`TAIL_LENS`; the unit's edges are read
  from the same outline). Unlit it is a clear cherry red, not smoked: a clear
  red lens over a red mirror of a housing, as a trough from the lens's
  edges; two rows of slanted blades (tail light), the smooth band between
  them (brake light; the outer piece's band is also the indicator), the
  reversing window by the inner tip.
- **Emission** is the same by day and at night, when the exposure is about 30
  times higher. The tail light's blades are 0.4: at night only the red
  channel clips and they stay red (at 7 they were white dashes). The brake
  band is 9: lit under the sun, a white core in a red glow at night, as in a
  photograph. The third brake light is 18, the eyebrow 3.5, the projector's
  dome 0.5.
- **Light cast** (`lamps.js`): two spot lights at 5700 K with a picture of
  the beam (`SpotLight.map`): dipped beam's cut-off with its kick-up to the
  right, main beam's spot added; shadows on the high tier. One red spot at the
  tail lamps' height aimed 5 m back lays a long soft red on the road. Lights
  are switched by intensity, never `visible`. On the car's own materials a
  spot light begins to count 0.35 m ahead of where it stands (`SPOT_NEAR`),
  so the lamps do not light their own housings.
- The third brake light, the plate lamps and the displays are lamp parts in
  `details.js`.

### The wheels and their blur

`wheel.js`: the tyre (225/40 R19 front, 255/35 R19 rear) with a tread and
sidewall height field (shoulder blocks, raised rings, panels of hatching, the
rim protector), the five-twin-spoke wheel from a plan measured on a rectified
photograph (black with machined faces), and the brake. The plan was measured
as an 18-inch wheel; the daylight photographs show the rim's edge at 0.78 of the
tyre's diameter, which only a 19-inch wheel gives, so the face, barrel and
brake are built from the plan and grown in the wheel's plane by `RIM_SCALE`
(19/18), the tyre's bead following. The same photographs show the bright bars
nearly twice as wide as first measured, and the pocket between them narrower
(`edgeHalf`, `slotHalf`) (plain disc with the
pads' marks, silver-grey floating caliper, dust shield). On the medium and
high tiers the outer sidewall carries the tyre's size twice round as raised
characters, drawn with the plate's stroke pen into a small map of its own
(400 x 64, one for each axle; the tread's map repeats nine times round the
tyre and could not hold it). The machined faces are turned and lacquered:
close by, concentric rings each tilt the metal a little under a smooth coat
(`patchSpokes`); a ring is never narrower than two pixels and being rings
they look the same however the wheel has turned.

At rest the real spokes are drawn; as `omega` rises (0.5 to 5 rad/s) three
thin shells fade in carrying the spokes' coverage averaged over exactly the
angle turned while the shutter is open (two texture reads), and the real
spokes fade out. Nothing strobes. The tyre blends its tread (and its marking)
into its average the same way. Parts deep in the wheel see only 0.3 of their
surroundings (`INNER_SKY`), so the disc does not shine white; the arch liners
and the intakes' recesses likewise see a share of the sky
(`createDarkMaterial({ sky })`: at 1 the liners glowed sky-blue round the
tyres).

### The plates

Both plates are Polish plates, 520 x 114 mm: white and reflective, black
characters, the blue band with the ring of twelve stars and PL, a thin black
rim, in a black frame on a black carrier. `plate.js` draws them on a canvas
(1040 x 228, with an embossed normal map at half that) with characters of its
own: each a few strokes on a 4 x 7 grid, one pen, corners rounded where a
letter turns. No font is used, so the plate reads the same on every machine.
The text is `plate` (default `K1 DOMI`); it is squeezed if it would not fit.
The front leans back 6 degrees under the grille; the rear stands upright in
its dish.

### The contact shadow

`shadow.js` bakes a small picture (64 x 128 on the low tier, 128 x 256
above, over 2.9 x 6.0 m) from the body's plan outline: 0.86 to 0.97 under the
car, and outside it two scales, a tight dark edge falling over 4 cm (from
0.6) and a soft spread over 22 cm (from 0.26) for the sky the car hides; each
tyre stands on a near-black patch as wide as its tread, reaching 2.5 cm past
it, inside a softer pad. Round 3 had one 6 cm falloff from 0.68 (after a soft
blob with no contact on the owner's phone); staged by day on the road
(`?manual&auto&ap&q=medium&time=day&t=45`, 393 x 700 at 2x, and `&photo=d4`)
the car still floated in a grey film. The road is dark asphalt, so even a
near-black shadow on it is a modest change of tone. It is not a child of the car: the game adds
`car.shadow` to the scene and `car.poseShadow(point, normal, yaw, strength)`
lays it flat on the road while the body rolls and pitches above it.

### The ghost

`createCar({ ghost: true })`: the skin and arch lips with one translucent,
rim-lit material, low-tier wheels reduced to tyre and spokes, no lights, no
shadow, no atlas. About 92k triangles, 10 draw calls, 150-190 ms. `?ghost=1`
in the viewer.

## How to change it

| to change | edit |
| --- | --- |
| a dimension, wheel position, lamp position | `spec.js` (the physics reads it too) |
| the body's shape | the tables in `lines.js`; check with `pin=` against the photographs |
| how far the wings and hips stand out over the tyres | `SHAPE.flare` in `lines.js` |
| how fine the mesh is | `MESH_EDGE` in `body.js` |
| where a window, lens, shut line or opening is | its outline in `features.js` |
| atlas resolution | `ATLAS_SIZE` in `atlas.js` |
| a paint, or add one | `PAINTS` in `materials.js` |
| flake, orange peel, the coat's strength | `carFlake`, the glint after `lights_fragment_end`, `COAT_GAIN` in `materials.js` |
| how the paint blurs and tints what it mirrors | `GLSL_SOFT_PROBE` and the `soft` branch of `REFLECTIONS` in `materials.js` |
| the black trims, seals, scoops, plate carriers, dishes, what is shaded | the region block and `carOcclusion` in `createPaintMaterial` |
| the glass's tint, bands, heating lines | `createGlassMaterial` |
| what a lamp is built of | `lampUnits.js`; how each part looks and how bright it is lit: `carLampPart` in `materials.js` |
| how far and how bright the lamps throw | `THROW`, the beam pictures and the tail spot in `lamps.js` |
| stars, grille pins, slats, mirrors, handles, wipers, pipe trims, cabin | `details.js` |
| the plate's layout or a character's shape | `plate.js` (`GLYPHS`) |
| the wheel's design, tyre, blur speeds | `WHEEL`, `DETAIL`, `FADE` in `wheel.js`; textures, finishes and the size marking in `wheelTextures.js` |
| the contact shadow | `shadow.js` |
| what the ghost shows | the ghost branch in `index.js` |

## Checked against the daylight photographs

Four photographs of the car in flat overcast light: straight on the tail
(from above eye height), straight on the nose, and two from ahead and to the
right (the side with the fuel flap), from above. Each was staged in the viewer
(`viewer.html?asset=car&q=low&carq=medium&sun=0&lights=off&pin=...`: the day
sky with the sun switched off and two stops more exposure; `carq` builds the
car at its own tier in a quick world) through a pinhole camera fitted by least
squares to points of known place on the car (the plate, the star, the screens'
corners, the trims, the wheels' rims, the door handles; the phone's wide lens,
f = 1933 px on 2576 x 1932), 5 to 11 px of residual, and laid beside it at
1600 px. What they changed:

| what | before | after (from which photograph) |
| --- | --- | --- |
| wheels | 18-inch, 225/45 and 245/40, narrow bright bars | 19-inch, 225/40 and 255/35, bars nearly twice as wide (both from ahead and to the side) |
| tail lamp, unlit | dark smoked maroon | clear cherry red (tail) |
| tail lamp's outline | a leaf, deepest mid-way, pointed outer end, inner tip 0.37 | tallest at a rounded outer end, level lower edge, inner tip 0.325 (tail) |
| boot lid's lower cut | a shallow smile | steeper sides, x 0.50 at y 0.67 (tail) |
| head lamps, unlit | bright chrome bezels and a white brow | dark inside (nose) |
| door mirrors | 0.135 high, 0.11 deep | 0.16 high, 0.13 deep (nose, and from the side) |
| cabin through the glass | light grey seats | dark (from the side) |

### Round two: the shape, against all six pictures

The four photographs and the owner's two press-style pictures (front-left
three-quarter in a studio and outdoors, the car's left side) were staged
again, the press cameras fitted the same way with the focal length free (9
points each: the star, both wheels' centres and rims, both door handles;
under 1.2 px of residual), and our render's edges were laid in red over each
picture (`edges.py` in the lane's tools) to read the silhouette. The front
outlines were also projected onto the photograph straight on the nose as
car-space polylines on the skin, with a grid of x and y, and redrawn there.

| what | before | after (from which picture) |
| --- | --- | --- |
| side intakes | tall trapezoids from under the grille's corner down to the lip (y 0.23 to 0.46) | wedges under the grille's outer corners, tallest at the bumper's corner, the lower edge rising inwards (y 0.28 to 0.47) (nose) |
| lower intake | a lozenge under the plate, 0.84 wide | a black band 1.36 wide from 0.22 to 0.28, so the painted blade sweeps between it and the side intakes (nose, both press pictures) |
| grille's stars | 12 mm across on a 34 x 22 mm lattice: a sparse sprinkle | 23 mm across on 40 x 30 mm (`GRILLE_STARS`), as dense as the pictures show; fewer triangles |
| grille's field | gloss black, mirrored the sky grey | black, coat 0.3 (nose; the "grille reads grey" fault) |
| power domes | 9 mm, fading out at z 1.6 to 1.95 | 14 mm, running on to the bonnet's front edge (both press pictures) |
| door mirror housing | a box (squareness 0.45), 0.16 high | rounded (0.68), 0.15 high (both press pictures) |
| boot lid's rear face and the bumper below | vertical face over a 24 degree shelf: a dark band and a dent beside the plate | one gently curved face from the lip to the bumper's widest line (rails at q -2.75 and the tail's end) (tail) |
| rear quarter under the tail lamp | an S in section (concave under the lamp): a dark crescent in every reflection | convex all the way down (rails at q -1.955 and -2.3) (tail, studio light) |
| rear valance's lower edge | 0.26 to 0.35 up: the pipe trims hung below the body | 0.25 to 0.29: the trims sit inside the black valance (tail) |
| pipe trims | bright sides 33 mm deep, standing off the bumper | bright only on the face and the first 8 mm; turned 14 degrees out, not 22 (tail) |
| shade under the boot lid's lip | half the light over 6 cm | a quarter over 2.5 cm (tail) |
| diffuser fins | sloping tops shaded as if facing the sky: a row of white ticks (tail, tunnel) | tops shaded as the face behind them |

What still differs: the head lamps' insides are brighter and simpler than the
real units; the slats in the side intakes catch the light more than the
pictures' black intakes; the press cars' wheels (multi-spoke) and their front
plate (none) are another trim of the same car and were not followed; from the
low studio camera the front tyres look a little proud of the arches; the
blade between the intakes has no sharp lower edge as on the car.

What agreed and was left alone: the silhouette and the glasshouse, the rear
screen (its lower edge only seemed higher: the glass mirrors the sky there),
the grille and its star, the bonnet's badge ahead of its shut line, the plate
recess, the reflectors, the trims and the black valance, the window surrounds
(gloss black) and the mirror caps (gloss black), the ride height and the gap
over the tyres. Smaller than what the method can show at that size, or left:
the brake discs are drilled on the car (plain here), the calipers larger;
the side intake's inner detail; the shape of the mirror's foot.

### Round five: the tail, the paint, the nose

The owner's verdict on round four: the tail (what the game shows all the time)
wobbled like dented foil, the paint read as chrome, yellow blotches sat on the
bonnet, the grille was large and glittering. Staged again against the
photographs (straight on the tail and the nose, the press picture outdoors,
the studio one), each with the same fitted cameras:

| what | before | after (from which picture) |
| --- | --- | --- |
| tail's surfaces | dents beside the plate, a fold at the bumper's corner, a crease from the star to the lamp | fair: convex both ways everywhere but the lip's fillet (see "The skin and its curves") (tail, striped studio) |
| boot lid's lip | dipping 0.1 m to the lamps' upper edge: the lamps stood on the crease like fins | level across, the lamps below it (tail) |
| widest line behind the hips | pinched in to 0.872 before the bumper's corner | carried at 0.898 into the corner: the bumper is the widest thing at the back (tail) |
| paint | metalness 0.92, roughness 0.27, coat 1.6 times a lacquer: chrome | 0.82, 0.42, a plain lacquer; soft probe read (see "The paint") (press, studio, tail) |
| grille's stars | 23 mm, 4 mm proud, on 40 x 30 mm: glitter | 16 mm, 2.5 mm proud, on 32 x 24 mm: fine dull points on black (nose) |
| front bumper's corners | 0.84 to 0.88 wide: the front tyres showed outside the body from straight ahead | 0.86 to 0.90: hidden, as on the car (nose) |

The grille's opening, the head lamps' outline, the tail lamps' outline and
the front ride height were checked and agree with the photographs to a few
pixels; they were left alone.

What still differs:

- The front apron under the grille is simpler than the car's (deep black side
  intakes framed by a painted wing): ours has slatted intakes and a plain
  blade.
- By day the coat still mirrors the wood's crowns at the horizon as a muted
  olive band across the bonnet from low three-quarter views; the crowns in
  the probe are brighter and more yellow than the dark trees of the press
  picture.

### Round six: the arches, the roof glass, the lamps, the apron

| what | before | after |
| --- | --- | --- |
| wheel arches | body 0.902 wide (half) by the front arch, 0.909 by the rear: both tyres' faces (0.9075, 0.917) stood outside their lips by up to 34 mm | wings and hips flared (`SHAPE.flare`): 0.932 / 0.933, each tyre 9 to 15 mm inside its lip; the plan line falls smoothly from the hip into the bumper, which stays the widest thing below the lamps |

The tracks (1.590 / 1.579, `spec.js`) and the tyres were left as they are.
With them the body is 1.866 over the flares, 46 mm more than the published
1.820: a 255 rear tyre on a 1.579 track is 1.834 over its faces, so the
published width and the tracks cannot both be right. `DIMS.width` (read by
the physics) keeps the published figure.

## What each tier costs

Re-measured after round five (the tail's new corners and the finer grille
stars cost about 1.3k triangles on the medium tier, which went over its
113k budget; its edge length went from 55 to 56 mm). Measured in the viewer,
one page at a time (headless Chromium on a 4-core machine, software WebGL;
build time is `car.stats.buildMs`: everything from `createCar()` to the
returned handle, shader compilation not included):

| tier | triangles | draw calls (at rest) | build |
| --- | --- | --- | --- |
| low | 49.7k | 29 (25) | ~430 ms |
| medium | 111.0k | 31 (27) | ~680-870 ms |
| high | 185.0k | 31 (27) | ~990 ms |
| ghost (not re-measured since round two) | 92.5k | 10 | ~150-190 ms |

Plus one draw call for the contact shadow. The four blur shells are hidden at
rest and the spokes at speed, so the count on the road is the smaller one.
The atlas bake is most of the difference between tiers; the wheels are about
150 ms of every build (their textures are shared by the four corners); the
plates' canvas about 15 ms, the tyres' two markings a few. The low tier
leaves out the cabin's blocks, the grille's pins as geometry (the paint draws
them), the tyres' marking, the wheels' clear coat and turned faces.

## What is still not right next to the real car

Most visible first:

- **NaN in the probe at night** comes from the road (`assets/world/road.js`,
  the bump's gradient divides by `sign(det)`); the car is guarded against it,
  but the road's reflection in the paint is lost where it happens.
- **Pink on the boot lid under lit red start lamps** (seen when the car stood
  right under the gantry): the lamps' radiance (about 45 times white by day) is
  spread by the paint's rough metal layer into a broad highlight. Energy-
  correct for that radiance; switching the lamps off changed the lid by 3 % in
  the grid view. Seen from above, the glass roof shows each lamp as a small
  crisp red dot, as it should.
- **Wheels at speed** are an even grey disc (the blur shells' average); the
  brake discs are plain where the car's are drilled.
- **The mirror image is only as sharp as the probe.** With the run's 256
  cube the flat of a door or the bonnet shows the wood as soft shapes; see
  the table above for what the title orbit should use.
- **The rear bumper's corner scoops** are a shaded triangular dish with a
  black slit; the real ones are a deeper scallop with a bright lower edge.
- **Head lamps from a metre and a half** show their modules at depth behind
  the lens, but the modules themselves are simple (a dome in a bezel, a
  dotted block); the real units have many more facets.
- **Reflections from straight behind** are calm: the boot lid mirrors the sky
  and the bumper the road.
- **At night the paint is dark** where nothing bright is near: it mirrors
  what the probe sees, and needs the wet road and the town to be the glossy
  car of the owner's night reference.
- **By day in low sun** the silver goes warm in the game's grade; it reads
  silver under a higher sun.
- **Bloom** round the brake lamps is the frame pipeline's; at night it still
  tints the boot lid red.
- **Tunnel lamp streaks**: the probe does see the tunnel's luminous panels
  (they are ordinary meshes of the world, not in `probeHidden`); in a viewer
  still in the bore (`s=1641`) they show as bright spots on the roof and the
  glass. Whether they stretch into streaks at speed is the probe's refresh
  and the frame's motion blur, not the car's.
- In the light tunnel (`stripes=1&mirror=1`) the stripes pinch a little at
  the tail lamp's outer tip, where the shoulder, the lid's lip and the wing
  meet; the handle dishes' edges are slightly ragged as a plain mirror.
- The brake discs are plain (as the sheet has them); badge lettering and the
  shark fin (this car has none) are not modelled.
- Untested: real phones, Safari, real device frame rates. Everything above
  was judged in headless Chromium on software WebGL.
