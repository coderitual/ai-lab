# The car

One car: the owner's silver Mercedes-Benz C-Class saloon (W206, AMG Line), as
seen from a chase camera a few metres behind it, by day and by night.
Everything about it is generated at start-up: the body from a table of lines,
the glass, lamps and shut lines from outlines baked into a texture of
distances, the wheels from a plan measured on a photograph, the plates on a
canvas. There are no model, texture or font files and nothing is fetched.

The measurements are in the modelling sheet (`specs/car-reference.md` in the
build's scratchpad, with its tables as data in `carref-tools/tables.json`);
every number there is marked published, measured or estimated. The viewer
(`viewer.html?asset=car`, parameters at the top of `src/viewer.js`) shows the
car alone under the world's light; `pin=` puts its camera exactly where one of
three photographs was taken from, so a still can be laid over the photograph
pixel on pixel.

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
| `materials.js` | paint (and every flush region it turns into), glass and lenses, trim, emitters, plates, dark insides, ghost |
| `details.js` | the solid small parts: stars, louvre, pipe trims, diffuser fins, mirrors, plates, third brake light, plate lamps, cabin |
| `lamps.js` | the lights the lamps cast: two head-lamp spots with beam pictures, one red spot behind |
| `wheel.js`, `wheelTextures.js` | a corner: tyre, five-twin-spoke 18-inch wheel, brake; the blur shells for a turning wheel |
| `shadow.js` | the contact shadow, laid on the road by the game |
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

`body.js` samples the surface once per tier at an edge length of 85 / 55 /
36 mm (low / medium / high), finer where rails crowd. Normals are the
surface's own, so even the coarse mesh mirrors cleanly. The same vertices are
drawn several times with different index lists: paint, glass, lenses, and a
dark shell (every other vertex, BackSide) that shows through openings.

Small forms a few millimetres high but sharp (the bonnet's power domes, the
door's lower crease, the sill's groove and blade, the band round the arches)
are not geometry: the paint shader tilts the normal (`carForm`).

### The feature atlas

Glass, lamp lenses, the grille, intakes, shut lines and reflectors are flush
with the skin on the real car, so they are outlines (`features.js`), each
given in the view in which it is true (side, top, front, rear or square to a
lens). `atlas.js` projects every texel's skin point into each view and stores
the signed distance to the outline, 8 bits over +-30 mm. Shaders threshold
the distance and antialias it with its own screen derivative, so an edge
stays sharp at any distance. No mip maps on purpose: a mip level would average
a thin line away.

| tier | atlas | bake (desktop) |
| --- | --- | --- |
| low | 512 x 256, x2 RGBA8 (1 MB) | ~110-150 ms |
| medium | 1024 x 512, x2 (4 MB) | ~200 ms |
| high | 1536 x 768, x2 (9 MB) | ~400 ms |

### The paint

`createPaintMaterial` is a `MeshPhysicalMaterial` with `onBeforeCompile`. The
base layer is metal flake (`PAINTS` in `materials.js`: colour, metalness,
roughness, flop, flake); over it a clear coat of roughness 0.03 mirrors the
car's own reflection probe (`setReflections`), scaled by how much sky is
overhead so the car goes dark in a tunnel.

- **Silver** (high-tech silver, this car): linear 0.45 face-on, metal,
  roughness 0.30, falling to 35 % edge-on (flop). That darker face and the
  broad metal highlight are what make it read as metallic paint under a coat
  and not as white plastic; the coat supplies the crisp mirror at grazing
  angles. (It was 0.63 and slightly blue before: white, flat and lilac in low
  sun.)
- **Flake**: below about a pixel per 0.4 mm cell the base normal is jittered
  per cell, so it sparkles close up and fades before it could shimmer.
- **Regions**: from the atlas the same shader turns into gloss black (window
  surround, B-pillar, frit), matte black (front lip, diffuser), bright metal
  (grille frame), red reflectors, the plate carriers and recess, the door
  handles, the rear corner scoops (a shaded triangular recess), and darkens
  the 3 mm shut lines (at least one pixel wide, fainter in proportion when a
  pixel is wider). The fuel flap, on the right only, is analytic.
- The other paints (`graphite`, `blue`, `red`, `white`, `black`) are the
  same material with other numbers: `?paint=NAME`.

Every patched material has its own `customProgramCacheKey`: without it three
handed materials each other's programs (the gloss trim rendered white).

### The glass

The glass and the lenses are the skin again, drawn after the paint at the
same depth with premultiplied alpha, so the reflection (the probe, at
roughness 0.0x) is not dimmed by the transparency. Behind the glass the cabin
is a few dark blocks and two screens (`details.js`), lit only faintly, so the
cabin is neither a black hole nor a glow.

### The lamps and their light

The lamp units are drawn by the paint's shader under the flush lens
(`carLamp`), as parallax layers: the view ray is followed in to each layer's
depth, so the inside moves against the lens as the camera moves.

- **Tail lamp**: two rows of slanted blades 8 mm in, a smooth light guide
  14 mm in, the reversing window by the inner tip, a dark red chrome housing
  25 mm in. Tail lights the blades, brake the guide (and the housing), the
  indicator turns the outer guide amber, reverse lights the window.
- **Head lamp**: a gloss black housing, a projector and a matrix module with
  satin bezels 40 mm in, a small blue accent, and the eyebrow light guide with
  its hook just under the lens. DRL lights the eyebrow (amber when
  indicating), dipped beam the projector, main beam the matrix rows. The
  emission is set for night exposure: the eyebrow at 3.5, the projector at
  0.5 (they were 30 and 1.5 and bloomed into one white blob). The brake
  light guide is 20 and the housing glow 0.6 (were 30 and 1.6: the whole
  tail went red in the bloom).
- **Light cast** (`lamps.js`): two spot lights at 5700 K with a picture of
  the beam (`SpotLight.map`): dipped beam's cut-off with its kick-up to the
  right, main beam's spot added; shadows on the high tier. One red spot at the
  tail lamps' height aimed 5 m back lays a long soft red on the road (tail
  0.06, brake 0.3). Lights are switched by intensity, never `visible`.
- The third brake light and plate lamps are emitters in `details.js`.

### The wheels and their blur

`wheel.js`: the tyre (225/45 R18 front, 245/40 R18 rear) with a tread and sidewall height field, the
five-twin-spoke wheel from a plan measured on a rectified photograph (black
with machined faces), and the brake. At rest the real spokes are drawn; as
`omega` rises (0.5 to 5 rad/s) three thin shells fade in carrying the spokes'
coverage averaged over exactly the angle turned while the shutter is open
(two texture reads), and the real spokes fade out. Nothing strobes. The tyre
blends its tread into its average the same way. Parts deep in the wheel see
only 0.3 of the sky (`INNER_SKY`), so the disc does not shine white.

### The plates

Both plates are white EU plates with the blue band, drawn on a canvas at
start-up with condensed characters from `plate` (default `AI LAB03`), and an
embossed normal map. The front leans back 6 degrees under the grille; the
rear stands upright in its recess. Each sits on a black carrier drawn by the
paint.

### The contact shadow

`shadow.js` bakes a small picture from the body's plan outline: densest under
the sills and between the wheels, a darker pad under each tyre, fading over a
hand's width outside the body. It is not a child of the car: the game adds
`car.shadow` to the scene and `car.poseShadow(point, normal, yaw, strength)`
lays it flat on the road while the body rolls and pitches above it.

### The ghost

`createCar({ ghost: true })`: the skin and arch lips with one translucent,
rim-lit material, low-tier wheels reduced to tyre and spokes, no lights, no
shadow, no atlas. About 92k triangles, 10 draw calls, 140 ms. `?ghost=1` in
the viewer.

## How to change it

| to change | edit |
| --- | --- |
| a dimension, wheel position, lamp position | `spec.js` (the physics reads it too) |
| the body's shape | the tables in `lines.js`; check with `pin=` against the photographs |
| how fine the mesh is | `MESH_EDGE` in `body.js` |
| where a window, lens, shut line or opening is | its outline in `features.js` |
| atlas resolution | `ATLAS_SIZE` in `atlas.js` |
| a paint, or add one | `PAINTS` in `materials.js` |
| the black trims, handles, scoops, plate carriers | the region block in `createPaintMaterial` (`materials.js`) |
| what the lamps look like inside, how bright | `carLamp` in `materials.js` |
| how far and how bright the lamps throw | `THROW`, the beam pictures and the tail spot in `lamps.js` |
| stars, mirrors, pipe trims, plates, cabin | `details.js` |
| the wheel's design, tyre, blur speeds | `WHEEL`, `DETAIL`, `FADE` in `wheel.js`; textures in `wheelTextures.js` |
| the contact shadow | `shadow.js` |
| what the ghost shows | the ghost branch in `index.js` |

## What each tier costs

Measured in the viewer, one page at a time (headless Chromium on a 4-core
desktop, software WebGL; build time is `car.stats.buildMs`: everything from
`createCar()` to the returned handle, shader compilation not included):

| tier | triangles | draw calls (at rest) | build |
| --- | --- | --- | --- |
| low | 49.4k | 28 (24) | ~480 ms |
| medium | 102.6k | 30 (26) | ~620 ms |
| high | 178.3k | 30 (26) | ~730 ms |
| ghost | 92.5k | 10 | ~140 ms |

The atlas bake is most of the difference between tiers; the wheels are about
150 ms of every build (their textures are shared by the four corners).
Plus one draw call for the contact shadow. The wheels are about 15k
triangles each on high; the blur shells replace the spokes once the wheel
turns, so the count stays the same at speed.

## What is still not right next to the real car

Most visible first:

- **Reflections from straight behind** are calm: the boot lid mirrors the sky
  and the bumper the road, both fairly even in this world, so the paint moves
  most visibly on the flanks and the C-pillars, less on the tail.
- **The rear tyres** show only as a few centimetres under the bumper corners
  from the chase camera's height (true to the car's 1.09 m rear overhang, but
  a lower camera shows more of them).
- **The front intakes** are black openings with a dark recess, without the
  real car's horizontal slats.
- **At night the paint is dark** where nothing bright is near: it mirrors
  what the probe sees (street lamps show as sharp highlights with a soft
  metal glow round them), but the placeholder world gives it little to
  mirror; the glossy, saturated car of the owner's night reference needs the
  wet road and the town.
- **By day in low sun** the silver goes warm (beige) in the game's grade; it
  reads silver under a higher sun.
- **Bloom** round the brake lamps is the frame pipeline's; with the lamps'
  emission lowered it no longer swallows the tail, but at night it still
  tints the boot lid red.
- The rear-screen heating lines, the shark fin (this car has none) and badge
  lettering are not modelled.
- Untested: real phones, Safari, real device frame rates. Everything above
  was judged in headless Chromium on software WebGL.
