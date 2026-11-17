# Serpentine: design

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

- **Title.** The car parked on the grid, the camera circling it slowly. Choose
  one driver or two, day or night.
- **Start.** The camera sweeps from the car's nose to its place behind the
  boot while the gantry's lamps count down. Lights out, go.
- **Three laps.** Each lap is cut into three sectors; crossing a sector line
  flashes the gap to your best lap (green ahead, amber behind). The lap
  counter, the running and best times, the five best laps on this device and
  a rev counter with the gear and the speed are on screen throughout, and a
  faint ghost of your best lap drives with you.
- **Results.** Lap times, the best lap, a medal against three target times,
  and the five best laps set on this device for that time of day.
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

- **Chase (default):** about 5.7 m behind the car's middle and 1.45 m up,
  lens about 50° top to bottom widening to about 58° at speed. The car sits
  in the lower middle third of the frame and is about a third of the frame
  wide on a 16:9 screen; on an upright phone the camera backs off and lifts so
  the same road is in view. It looks ahead into the bend, follows gradient
  lazily, never goes through a tunnel wall or under the road.
- **Far chase**, **bonnet** and **bumper** views, changed with a key or a
  button; **look back** while a key is held.
- **Title orbit** and **start sweep** as above.

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
