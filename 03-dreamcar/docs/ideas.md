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
- **D3's road has no sun on it.** The night lane's canopy term (canopy.js)
  darkens the sky's fill under the bank's wood (road at D3 from (42, 44, 50)
  to (36, 38, 43), a little less blue), but the frame's warm light road with
  patches of sun needs sun on the road, and there is none: the ledge is
  banked away from the fixed 16° sun and the bank's own crowns shade the
  road and the wall (with the crowns' casters off, only the wall and the
  verge come into the sun). Gaps cut into the impostor casters' shadow were
  tried and changed nothing visible there (the shade is the near trees'
  full geometry). What would: a sun a little higher for that place (not
  allowed: the sun is fixed), crowns that overhang the road, or a gap in the
  bank's planting where the sun comes through.
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

- **Wet streaks** (night lane): every lamp, board and window now lies on the
  road as a long streak (the mirror's streaked copy, the film over the whole
  road) and the tail lamps as two red streaks; the head lamps' own
  reflections from a car ahead, and the kerbs and rails sparkling in the
  beam, are not done. The car's body in the mirror is dark: seen from under
  the road it is its underside.
- **The town** across the lake is smaller and dimmer than the reference's
  city, and the terrain hides it from much of the lap.
- **A red pool behind a braking car** is still strong (the tail lamps'
  specular on the rough wet asphalt), and the bloom round the brake lamps
  tints the boot lid red.
- **The floodlights' cones** are drawn as surfaces of a cone, faded out
  within 36 to 12 m of the eye; the poles behind rails stand 2.5 m back and
  12 m high. At the sky road's parapets and at rock faces they still stand
  at the edge: from close beside one there a pole can still come near the
  frame's edge (not seen in the finish lane's stills).
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
