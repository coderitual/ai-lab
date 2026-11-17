# Dreamcar: ideas

What to do next. First what still falls short of the owner's reference frames
(the five frames described in [design.md](design.md#the-reference-frames):
they are the spec, and none of them is matched yet), then the natural
extensions. The shortfalls are the lists each lane wrote after putting its
stills beside the frame they answer to, most visible first; they are as of
the end of the rework and some may have been fixed since. Re-stage the
comparison stills and strike what is done.

## Short of the references

### Day (frames D1, D3 and the old open racing sample's frame)

- **The middle distance between the road and the massif** reads as smooth
  pale slopes: the far rings and the terrain's low hills in haze, where D1
  has sunlit trees and bushes in front of a back-lit massif. The massif's
  foot is hidden behind snowy beige hills of the terrain.
- **The ground beside the sky road** reads from above as a pale, rippled
  bare slope (`docs/images/sky-road.jpg`), not the wooded valley under the
  columns of frame A.
- **Rock faces** beside the road are bedded limestone but repeat; the far
  mountains are a smooth mottle since their per-pixel relief was removed
  (it made speckle at golden hour).
- **The sun's disc** is not in the far chase camera's frame on the stretches
  that drive into it (the frame's top edge is lower than the sun); the flare
  source makes the glare from just outside, but frame A has the disc itself.
- **Crowns between 30 and 80 m** are still somewhat painterly; D3's trees
  show limbs and dappled shade on the road at that distance.
- **The tyre walls** stand behind the rail (the Track puts them inside the
  edge, the rail is drawn at the edge) and barely show.
- **Streaks of speed**: the blur is strong at the edges at 250 km/h but has
  not been measured against frame A's streak lengths.

### Golden hour (frames D4 and D2)

- **The grid is not in shade.** D4's road lies in the shadow of the trees
  while the crowns and the gantry glow; ours needs something tall on the lake
  side of the straight to throw that shadow at 3.5° of sun.
- **The autumn crowns' glow** is limited by the low sun's direction; fallen
  leaves under turned trees are not done.
- **The paint's mirror** is only as sharp as the reflection probe (256 per
  face standing still on medium); D2's paint shows the evening sky in detail.

### The wet night (the night references)

- **The lamps' streaks on the wet asphalt are weak** and puddles can read as
  dark blots rather than mirrors; bright verges can make the wet streaks
  speckled.
- **The town** across the lake is smaller and dimmer than the reference's
  city, and the terrain hides it from much of the lap.
- **A red pool behind a braking car** is still strong (the tail lamps'
  specular on the rough wet asphalt), and the bloom round the brake lamps
  tints the boot lid red.
- **A thin dotted red line** runs straight down the picture from the car's
  tail on the wet road in the chase view at speed (`docs/images/night.jpg`):
  the tail lamps' reflection drawn as a row of samples rather than a smooth
  streak.
- **Trackside boards have no lamps of their own**; at night they are dark.
- **The car's paint is dark** where nothing bright is near it.
- **The tunnel's exit** at night and by day (the bloom of the portal) has not
  been judged.

### The car

[car.md](car.md#what-is-still-not-right-next-to-the-real-car) keeps the list:
the rear bumper's corner scoops, the head lamps' modules, calm reflections
from straight behind, the silver going warm in a low sun.

### Phones

- The low tier was over its budget (draw calls and triangles) at the merged
  head. The biggest shares were the terrain, the rails, the lamps, the
  ghost car and the far mountains: cut those first.
- Nobody has played it on a phone. Do that before anything else on this
  list.

## Next steps

- **Weather.** Rain that falls, spray from the tyres on a wet road by day,
  fog, and grip that follows the wetness (today the wet night is a look:
  the tyres do not notice it). The lighting table already carries a
  `wetness` per time of day and every material that rain changes reads one
  shared uniform.
- **More times of day.** Code iterates over `TIMES`; a fourth (an overcast
  morning, a blue hour) is a table, a bake channel and a medal check.
- **More cars and paints.** `?paint=` already changes the first car's paint;
  a garage on the title, more paints, and other bodies lofted the same way
  (the skin and feature atlas are general).
- **More circuits.** The Track takes any closed layout of straights and arcs;
  the world builds from it. A second layout, or the same circuit reversed,
  is mostly data and a new set of medal times from the autopilot.
- **A photo mode.** The staging camera (`__dreamcar.photo`) already exists;
  it needs a pause-sheet entry, a free orbit with touch and stick, and a
  high-tier render at a larger size.
- **Online ghosts.** The ghost is a small deterministic recording (10 Hz,
  rounded); sharing one is a matter of a URL or a service, and of checking
  that it was set on this road (its length is already stored with it).
- **Music.** There is none. A synthesised score in the spirit of the engine
  (generated, no recordings), quiet under the engine, would suit the title
  and the results.
- **Computer opponents.** The autopilot with a bias already races beside a
  second car in split screen without touching it; a field of them with
  overtaking is the next step.
- **Replays.** The run is deterministic from its inputs: recording the
  inputs is enough to replay it from any camera.
