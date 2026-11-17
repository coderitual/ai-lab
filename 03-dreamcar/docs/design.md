# Dreamcar: design

What this demo is meant to be. The numbers here are targets; what the build
actually does, number by number, is in [spec.md](spec.md). When the two
disagree, decide which is wrong and fix that one.

## The demo in one paragraph

A silver saloon, a closed mountain road, and a clock. You drive a current
Mercedes-Benz C-Class (the W206 saloon in AMG Line trim, modelled in code from
photographs of one particular car) round a three-kilometre pass: a lakeside
straight, esses through spruce forest, a lit tunnel, a viaduct, three
hairpins, a summit and a fast descent. Three laps against the clock, alone or
against a friend in split screen. The same road exists three times: on a sunlit
afternoon, at dusk after rain, and at night, when the picture is made of
headlights, reflectors, the tunnel's lamps and the moon. It plays in a browser with a keyboard, a
gamepad, or thumbs on a phone.

It is an original demo. Two things were looked at for what "good" looks like
and never for names, tracks, interface or art: an old XNA starter-kit racing
game (the shape of the thing: a time trial on a scenic road with a chase
camera, a speedometer, lap times and a best-times board, heavy motion blur
and glow) and two other racers (how a car should sit in the frame, how a
road is lit by day, and what a wet road does with lights at night). The car is an unofficial model made out of enthusiasm for
the real one; this project is not affiliated with its maker.

## What it is built round

1. **The car is the picture.** The camera sits low and close behind it, so
   most of what you look at is paint, glass, lamps and tyres. The model has to
   survive that: correct proportions, a paint that mirrors the trees going by,
   lamps that are objects with depth and not red rectangles, wheels that
   steer, spin and ride on springs, a body that rolls and squats.
2. **Light is the subject.** Day and night are not a tint. By day: one low sun,
   long tree shadows across the road, haze in the valleys, a sky the paint
   reflects. By night: the car's own lamps do the work. The low beam has a
   shape and a cut-off, roadside posts and chevrons answer it, the tunnel is a
   pool of sodium light you can see from the valley, the tail lamps colour the
   road behind, and the exposure opens up the way eyes do.
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
   has a wetness it does not yet use, the lighting is one table per time of
   day, and the sky, fog and exposure all come from that table.

## The car

The real thing, as the ruler for the model (W206 saloon):

| | |
| --- | --- |
| length / width (body) / height | 4.751 m / 1.820 m / 1.438 m |
| wheelbase | 2.865 m |
| track front / rear | 1.582 m / 1.594 m |
| tyres (AMG Line, 18 inch) | 225/45 R18 front, 245/40 R18 rear |
| kerb weight | about 1 650 kg |
| engine | 2.0 l turbocharged four, 190 kW, 400 N·m, 9-speed automatic, rear-wheel drive |
| 0–100 km/h / top speed | about 6.0 s / 250 km/h (limited) |

The particular car: high-tech silver metallic, AMG Line (star-pattern grille
with one horizontal blade and the large star, sport bumpers with black
intakes, chrome twin tail-pipe trims in a black diffuser), black mirror caps,
dark tinted rear glass, a black panoramic roof, 18-inch five-twin-spoke
wheels in black with machined faces, and the two-piece tail lamps of this
generation. What must read from the chase camera, in order: the stance and
silhouette, the tail lamps and their light signature, the rear screen and
roof, the bumper with its diffuser and tail-pipe trims, the wheels, the
mirrors. From the front (title screen, staged pictures): the grille, the star,
the head lamps with their daytime running "eyebrow", the bonnet's two power
domes.

It carries a number plate. By default the plate is a made-up one; `?plate=`
puts another text on it.

A second car, in a different paint, is the second player's.

## The road

One closed loop, about 3.2 km, driven clockwise on the map, with roughly
85 m between its lowest and highest points. Paved width 8.5 m (two lanes and
two narrow shoulders), then a verge, then something solid: a steel guard rail
on the valley side, rock on the hill side, parapets on the viaduct, walls in
the tunnel. Nothing can be driven off the mountain.

| stretch | what it is for |
| --- | --- |
| Lakeside straight, start and finish | speed, the gantry, and the town: a street front with lit windows on one side, palms and the lake on the other |
| The sweeper and the esses, climbing through spruce | rhythm; tree shadows by day, a corridor of trunks in the beams by night |
| The tunnel, about 250 m, gently curved | light: the exposure closes down by day and the lamps slide over the paint |
| The viaduct | the view, the wind, the sky in the paint |
| Three hairpins | braking, weight transfer, the handbrake, chevrons lighting up |
| The summit | the far mountains; the moon |
| The descent along the rock face | speed with consequences: rock on one side, rail on the other |
| The hook, back onto the straight | a late apex to finish the lap |

Road furniture is that of a Central European mountain road, drawn from
scratch: white guide posts with reflectors every 50 m (closer in bends),
red-and-white chevron boards on the hairpins, steel rails on posts, concrete
portals.

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
- **Speed is seen, not only read.** The lens widens a little, the verge
  streaks, the camera settles lower and shakes with the surface, guide posts
  tick past.
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
- **Day:** sun about 24° above the horizon and well to one side of the
  straight, warm; sky fill cool; long soft shadows; haze that thickens with
  distance and in the valleys. Exposure for sunlit asphalt, closing by about
  2.5 stops inside the tunnel and recovering over a second on the way out.
- **Night:** a three-quarter moon high on the opposite side, enough to draw
  the ridges and the edges of the road; stars; the low beam reaching about
  65 m with a sharp cut-off rising to the right, high beam about 150 m; LED
  daytime running lamps always on; tail lamps red with a hot core; brake lamps
  three times brighter; warm tunnel lamps; lit windows at the chalet by the
  start. Exposure about 4 stops above day (lighting.js: 18 against 1; at 5
  stops the moonlit land read as dusk and anything facing a head lamp within
  30 m burnt white). Lens ghosts are off at night.
- **Night is the night after rain.** The asphalt is wet (lighting.js
  `wetness`: day 0, night 0.65; `?wet=` overrides): dark, glossy, with
  broken puddles in the wheel tracks and low spots, dry under the tunnel's
  roof. On the medium and high tiers it mirrors what stands on it through a
  planar reflection drawn per view about the road's plane under the view's
  car (engine/PlanarMirror.js; a third of the view's height on medium, half
  on high; nothing on low, which keeps the speculars): the tail lamps, the
  car, the lamps, the studs and posts, the tree line and the sky, each light
  drawn out into a streak towards the viewer. The head lamps lay a cool pool
  on the road ahead through the asphalt's own backscatter (road.js), while
  their beam keeps light off what is close and high.
- Lit studs (studs.js) on the centre line and both edge lines through every
  bend and the tunnel (amber centre, white edges, red seen the wrong way)
  answer the head lamps and glow faintly on their own at night: the next bend
  reads from 150 m. A town of about 330 lamps (high tier) lies on the lake's
  far shore and the slope behind it, mirrored in the lake, with a soft warm
  glow on the haze above it, a radio mast's red lamps and a hamlet high on
  the slope beyond; it is in the frame from the descent and the hook (the
  summit's hills and the viaduct's heading hide it from the rest of the lap).
- **Dusk, the hour the demo opens in.** The sun is down; the sky runs from a
  dusty rose band on the horizon through mauve to slate violet overhead, and
  everything is lit by it: soft, cool, low in contrast. The road is wet and
  carries that sky, the roofs' silhouettes and every lamp as long streaks.
  Windows, street lamps and signals are on and glow gently. Nothing is
  exaggerated: it should pass for a photograph of a wet evening.
- **Day has the sun in it.** Heading into the low sun the picture is washed
  by its glare, lens ghosts lie across the frame, and the road goes pale
  towards the light.
- The paint is a metallic silver under a clear coat: a sharp mirror image of
  the real surroundings over a soft, flake-sparkling base.

## Left out on purpose (for now)

- **Weather.** Rain, spray, fog and a wet road that changes the grip are the
  planned next step. (The wet road at night is a look, not weather: it is
  always there at night and the tyres do not notice it.)
- **Opponents driven by the computer**, damage, a career, more tracks, more
  cars, tuning.
- **Online play.** Demo 01 has it; this one does not need it.
- **A cockpit view.** The cabin is modelled only as far as it shows through
  the glass.
