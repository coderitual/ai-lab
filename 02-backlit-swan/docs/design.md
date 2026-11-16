# Backlit Swan: design

What this demo is meant to be, and the measurements it is built from. The
numbers here are targets taken from a reference film; what the build actually
does is in [spec.md](spec.md).

## What it is

A real-time recreation of an eleven-second piece of film: a mute swan on a
small, very dark forest pond, lit from behind by low sun. It shakes water off
its bill, turns through the light, dunks its bill, lifts it dripping, and
reaches down again. The picture is nearly all black; what is not black is a
cream rim, a teal shadow side, a rippled mirror image, a handful of hot
glints, and a scatter of bright specks on the water.

It is a tech demo, not a game: you look, you move the camera, you ask the
swan to do things, you touch the water. It opens by playing the film's
performance with the film's camera, on a phone held upright, and then it is
yours.

It is not a copy of the film's frames. Everything is generated in code and
simulated: the bird is a model with a skeleton in its neck, the water is a
simulated surface, the reflection is a real mirror image, the glow is light
going through feathers. So it can be seen from angles the film never showed.
No text, names or interface from the recording are reproduced.

## The measurements

All of this was measured from the film (1206 x 2370 px picture, 60 frames a
second) with frame-by-frame tracking, pixel statistics and fitted curves.
`L` is the swan's length at the waterline, the ruler for everything else.

### Scale and time

- **It is real time.** Drops falling from the bill accelerate at 17.8 L/s².
  With true gravity that makes L about 0.55 m; a mute swan's waterline is
  0.55 to 0.65 m. We use **L = 0.60 m** and real gravity. Slow motion is an
  option, not the default.
- **The camera is close and low**: about 5 m from the swan at the start and
  3.7 m at the end (the swan swims a U-turn toward it; there is no zoom),
  0.87 m above the water, so it looks down at the swan's waterline by 10
  degrees at the start and 13 at the end. An upright phone picture spans about
  37 degrees top to bottom. The swan's waterline sits 67 % of the way down the
  picture and its body is about 36 % of the picture's width.
- **The pond is small**: the bank to the east is about 12 m from the camera.

### The light

- One low sun behind the swan and above it, slightly to the right of the
  picture. Up-facing edges carry the widest rim.
- A blue fill from the open sky behind the camera. In linear light a white
  feather lit only by the sky is about 0.15, with R:G:B about 0.3 : 0.6 : 1.
- The sun reaches the swan and the water in front of it. The far water and
  the wood behind are in shade: there is a soft tonal step on the water 1.2
  to 2 m behind the swan.
- Exposure is fixed for the whole film. Linear scene values to aim at:
  sky-lit feather 0.14 to 0.17; sunlit translucent body 0.6 to 0.8; rim 1.5
  and up; glints 4 and up.

### The print (colour grade)

Hue follows brightness and nothing else. Sorted by brightness, the film's
pixels have these mean colours (8-bit sRGB):

| brightness | colour | reads as |
| --- | --- | --- |
| 14 | 13, 14, 16 | blue-black (black is lifted: nothing is below 10) |
| 26 | 22, 27, 28 | teal-black |
| 37 | 32, 39, 36 | teal |
| 57 | 51, 60, 46 | olive |
| 89 | 82, 94, 69 | olive |
| 137 | 134, 141, 108 | pale olive |
| 187 | 200, 188, 146 | warm |
| 228 | 245, 227, 184 | cream |
| 248 | 250, 250, 222 | cream-white (blue never reaches 255) |

Three fitted curves reproduce that table to within 1 to 4 code values and are
the grade (`printCurve` in `engine/PostChain.js`). So the scene itself is lit
almost neutrally: a sun of about 1 : 0.95 : 0.86, a blue sky, yellow-green
leaves. Dim warm light comes out olive and bright warm light cream, which is
why the glow round the rim shades from cream to olive.

- No vignette, no chromatic aberration, no streaks or stars on highlights, no
  film grain (only compression mottle, which is not copied).
- About 80 % of the picture is below code 40 and 1.2 to 2.5 % above 200.
- Edges are crisp (the rim rises in about 2 px of 1206) and interiors very
  soft.

### The glow

A screen-space lens glow with a long faint skirt, not one blur. Fitted as four
Gaussians of sigma 0.21, 0.42, 0.84 and 1.7 % of the picture height with
weights 0.038, 0.076, 0.065 and 0.052 of the display-clipped source. In code
values above a background of about 18: +40 at 3 px from a thin rim, +25 at
10 px, +12 at 20 px, +5 at 40 px, nothing by 96 px; off the broad body top
+60, +45, +25, +12, +5 at the same distances. Tiny specks have no halo.

## The swan

### Form (in L)

- **Neck**: a tube 0.13 across for most of its length, 0.95 long, flaring
  smoothly to 0.21 to 0.25 where it enters the water. There is no separate
  breast: the flared neck base is the bow. Upright, the crown of its arch is
  the highest point of the bird, 0.95 to 0.99 above the water, and brighter
  than the head.
- **Head**: just the tapered end of the tube, 0.13 to 0.15 deep and 0.26 to
  0.32 long with the bill, no wider than the neck. A wedge bill 0.17 long
  pointing down. In this light the bill, the knob at its base and the lores
  are black against black; they show as two thin lit lines (the top of the
  bill and the jaw) and one small glint on the knob. A bead of water hangs
  from the tip.
- **Body**: fat and tall. Highest point 0.47 to 0.50 above the water, two
  thirds of the way back; a long convex slope forward of it; behind it a
  steep drop to a saddle at 0.33, then a sharply upturned pointed tail whose
  tip is at 1.125 along and 0.425 up. From the front it is wider than tall
  (0.66 across), widest just above the water, with two wing lobes either
  side of the neck and a valley 0.05 deep along the spine. The folded wings
  are puffed up but not raised into full sails.
- **Feathers as shapes** only where the film shows them: three or four
  saw-tooth tips at the tail's point, two rounded lobes on its rear edge, one
  rounded wing-tip lobe with two dark slits over the tail base, a few crossed
  white tips on the crest, and one upright tuft on the back. Everywhere else
  the shadow side reads as soft billows 0.08 to 0.18 across, 15 to 25 %
  lighter on their upper edges, with no feather-scale detail.
- **The fuzzy edge**: along the neck and head the rim is the down itself.
  Beaded on straight runs (bumps every 2 to 3 % of L), breaking into
  saw-tooth tufts on the outside of a bend.

### How it takes the light

The glow depends on how much bird the light has to cross. Thin parts (tail,
wing tips, the taper of the bow, the tops of the wing lobes, the gap between
wing and neck) transmit: cream where thinnest, amber where a little thicker
(the amber under the wing tip is the most saturated colour on the bird). The
thick middle of the body facing the camera gets no sun at all and is lit by
the sky: teal. The change from cream to teal takes 0.10 to 0.14 L. The inside
of the neck is olive, warmer toward the top.

Targets on screen (sRGB): rim core 250, 236, 196; warm glow 235, 209, 163;
amber 243, 202, 112; lightest teal 118, 154, 144; typical teal 80, 121, 113;
darkest teal 42, 69, 64; neck interior 110, 109, 72 to 56, 70, 54; bill 40,
39, 42.

### The performance

Clip seconds are real seconds. Heading: 0 is side-on facing the left of the
picture, 90 facing the camera, 180 facing right.

| time | what happens |
| --- | --- |
| 0.0 | Heading 10, gliding at 0.16 L/s. Proud S-neck, bill pointing 62 degrees down, just drunk: drops fall from the bill tip in pairs (0.0, 0.35, 0.58 s), each landing with a glint. |
| 0.87 | The neck stretches (head top from 0.84 to 0.93 L) and the bill comes up to level. |
| 0.90 to 1.47 | **The shake**: two full left-right turns of the head about the neck's axis at 3.6 Hz, about 170 degrees of swing, peak 1600 degrees a second. Beads leave the bill tip tangentially in five bursts (8, 15, 65, 45 and 8 of them), at 1.1 to 5.6 L/s, and fly clean parabolas; about 120 are in the air at 1.4 s. They are neutral white dots of 0.8 % of L, not streaks. |
| 1.4 to 2.2 | The beads land in a band along the swan's waterline up to 1.1 L either side. Each landing is a pale gold patch five times wider than tall that lasts 0.2 to 0.4 s and decays into thin horizontal lines, gone by 2.5 s. |
| 1.5 to 3.0 | Bill back down (75 degrees), neck a straight column. Heading 32 to 55. |
| 3.4 to 4.1 | The fast part of the turn, 50 to 60 degrees a second, through head-on at 3.75 s. |
| 4.62 to 4.90 | **The dunk**: the neck curls over into a tight hook and the bill goes in 0.05 L ahead of the breast, in 0.3 s. |
| 4.9 to 5.7 | Bill in the water; the head sinks to eye level and drifts forward. A warm glint cluster at the entry point. |
| 5.7 to 7.0 | Out, hovering; a brief second touch near 6.2; rises to a bowed upright pose by 7.0. A string of 3 to 7 beads hangs under the bill, thinning to single drops until 8.1. |
| 7 to 8 | Heading 148 to 162, speed rising to 0.35 L/s. The wings have relaxed: the back is 14 % lower and the bird up to 20 % longer than at the start. |
| 8.4 to 9.9 | **The reach**: a slow, eased bow forward; the bill touches 0.47 L ahead of the breast. |
| 9.9 on | The bill stays where it is in the water while the body glides up to it and the neck folds into a low arch (reach 0.46 to 0.34 L). |

No paddling surge, bobbing, roll or tail wag is visible: it glides.

## The water

- **A mirror, kept sharp.** The reflection is 0.57 of the swan in linear
  light, tinted slightly olive (0.93, 1.0, 0.79), exactly as tall as the
  swan, never blurred: all softness is displacement.
- **Displaced far more vertically than sideways** (5 to 10 times), and more
  the further below the waterline: the lower edge frays by 15 % of the
  distance, and past 0.8 of the swan's height the image breaks into detached
  horizontal slivers and closed loops.
- **Two ripple scales**: fine, 4 to 5 cm long; and long-crested, about 10 cm
  with crests 0.2 to 0.4 m long. Slopes of 0.006 to 0.01 when calm, 0.02
  near disturbances. They travel away from the swan, toward the camera, at
  about 0.08 m/s.
- **Colour**: teal-green near-black over a blue-black floor, 2.5 times
  brighter near the camera than far away (linear 0.004 to 0.010).
- **Glints only where the surface is disturbed**: under falling drops, at the
  bill's entry, along the breast on the sunny side, in the wake. Pale gold
  cores (248, 238, 190) far over the exposure, ragged and wider than tall.
  Calm water has none. The wake is a band of stacked horizontal dashes
  behind the tail, growing to over 1 L; there is no visible V.
- **Specks**: about 900 in view, floating on the surface (they have no mirror
  image and drift as one rigid sheet). About 110 per square metre in the
  sunlit water in front of the swan, almost none in the shade behind it.
  Sharp neutral-white points, a fifth of them short dashes; steady, not
  twinkling. A few golden floating leaves.
- **At the waterline**: a soft dark band under the bird, no hard line; a thin
  bright contact line on the sunny side only when it moves.
- **Drops in the air are mirrored; specks are not.**

## The surroundings

Out of focus, as one layer. From the film:

- **Behind the swan**: dark wood. Thick dark trunks; between them a soft,
  hazy shaft of blue-teal light coming down from the top of the picture,
  brightening and greening slowly over the film.
- **Up left and up right**: clumps of sun-dappled foliage, yellow-olive
  (156, 157, 72 up to 195, 186, 96 on screen), as soft blobs rather than
  hard discs, with a few small bright points among them.
- **To the east** (it enters the picture as the camera follows the swan
  right): a sunlit meadow bank, saturated yellow (234, 209, 57), a path of
  red-brown earth, a wooden post-and-rail fence in silhouette with lit top
  edges, framed by a big dark trunk. Its reflection lies in the water as
  olive-gold vertical stripes crossed by fine ripple lines.
- The far shore is not drawn as a line anywhere.

## Controls

- **Drag** to move the camera round the swan; **pinch or wheel** to come
  closer or back off; **double tap** to return to the film's view.
- **Touch the water** and a drop falls there: rings, a glint, and the swan
  comes over and feeds.
- Buttons for what the swan does in the film: **shake**, **dunk**, **reach**;
  and **replay** for the whole performance with the film's camera.
- A panel for the picture: sun direction and height, aperture, glow,
  exposure, the print, slow motion, sound, quality.
- Keys on a desktop; everything reachable with one thumb on a phone, in
  either orientation.

## Left out on purpose

- Taking off, flapping, walking, other birds.
- A day and night cycle: the look is one light.
- The film's compression artefacts, its caption and its interface.
