# Ideas

What could come next, grouped by what it would improve, with a note on how
each fits the code as it stands. Roughly in order of value within a group.
When one is done, delete it here and describe it in [spec.md](spec.md) and
[techniques.md](techniques.md).

## First: find out how it runs on real devices

Nothing here has been seen on a phone or in Safari (see
[tools.md](tools.md#what-has-not)). Before adding anything costly:

- Play it on two or three phones and note the frame rate and which quality
  step each settles on (`__bw.game.engine._qualitySteps` in the console).
- If phones sit at step 2 all the time, the static phone settings are too
  ambitious: lower them rather than relying on the fall-back.
- Add a small on-screen frame-time graph behind a query option (`?fps`).

## The race

- **A second course.** `game/track.js` is already data: ten control points and
  a list of marks. A course needs its own islands (`game/World.js`), and
  ideally its own sea (`SEA` in `engine/waves.js` is global today: seven
  numbers and a seed; make it a property of the course).
- **Time trial with a ghost.** The network code already records and replays a
  boat's state 20 times a second (`OnlinePlay._store`, `applyRemote`). Save
  the best lap to `localStorage` and feed it through the same path.
- **Bots that race each other.** Today each follows a line and avoids sterns.
  Give them a notion of the inside line at a mark and of defending it.
- **Difficulty.** The catch-up is a hidden ±4 %; expose three settings that
  change `pace` and the cap on power.
- **Weather.** `sea.scale` already exists (`?sea=`). A calm race and a rough
  race are one number apart; a squall that passes over mid-race would be a
  slow ramp of it plus a darker sky. A different *kind* of sea (short and
  steep, or a long oily swell) is a different `SEA`: `peakLength`, `tail` and
  `chop`, measured with `tools/sea.mjs` and raced before it is believed.
- **Seeing over the waves.** The open sea now stands 4 to 6 m from trough to
  crest and a mark's sign 4.2 m, so a mark a hundred metres off can be hidden
  for a second or two. If that costs races, raise the signs or the chase
  camera in a trough, or draw the next mark's arrow through the water.

## The boat and the driving

- **Bite at each end.** The hulls' sideways grip is one curve for the whole
  boat (`game/Craft.js`). Split it between bow and stern and a boat that
  lifts its tails spins, and one that digs its bows trips.
- **Air under the tunnel.** At speed the tunnel packs air and lifts the bows;
  too much trim into a headwind and the boat blows over. A trim control
  (two keys, or the vertical axis of the touch stick while not braking) would
  give the driver something to manage on the straights.
- **Liveries chosen by the player.** `paintLivery` takes any two colours, one
  of four designs and a number; add a picker to the title screen and the
  lobby, and send the choice in the `hello` message.
- **Wear the race.** Salt streaks and spray marks accumulating on the paint
  (another layer in the roughness sheet, built up per boat).
- **Propeller blur.** Swap the blades for a translucent disc above a certain
  speed instead of spinning them at a rate chosen to look right.

## The picture

- **The hull's shadow on the water from the shadow map.** The water shader
  could sample the sun's shadow map directly instead of the soft blob in the
  wake field (`assets/water.js`, `environment.shadowAt`).
- **Clouds in the water.** The cloud layer is a formula in `assets/sky.js`;
  the water could evaluate it in the reflected direction as it does the sky.
- **Soft particles.** Spray and mist cut hard where they cross a hull. With a
  depth texture they could fade there.
- **Whitecaps to the horizon.** Beyond 430 m the sea is flat water with
  ripples: the tables have no smaller copies of themselves, so reading them
  that far off would flicker. Mip levels for the 3D textures (they need the
  float colour-buffer extension to be generated) or a second, coarse table
  for the far field would carry the big waves and their foam all the way out.
- **Spray off the crests.** The tables know where a crest is breaking
  (`squeeze`); the fixed step could throw particles from those places near
  the boats, as it does from the hulls.
- **Smoother time.** The tables are blended in a straight line between
  frames. A curve through four frames would let them hold a longer period in
  the same memory, at four lookups instead of one.
- **A sea that is computed, not stored.** The alternative that was weighed:
  transform the spectrum a few times a second while the game runs (in a
  worker) and blend between snapshots. No repeat in time and any weather at
  will, for a few milliseconds a snapshot and a harder time keeping every
  machine's sea the same.
- **A bow wave you can see.** Write displacement into a fourth channel of the
  wake field and add it in the ocean's vertex shader.
- **A second reflection probe** for the other split-screen player (today both
  boats mirror the map taken at player one's boat).
- **Step back up.** Quality only ever steps down. Step up again after a
  minute of fast frames.
- **Motion blur at the edges of the frame** at full power, cheaply, by
  stretching the lens pass's copy of the frame radially.
- **A float target for the lens pass**, so the glow knows how bright the sun
  on the water really was before tone mapping (`game/Lens.js`).
- **A waterfall off the main crag**, falling into the thicket, and cloud
  caught on the peak: the two things a painted island has that this one
  does not yet (`assets/rocks.js`, `game/World.js`).
- **The island's shadow on the lagoon**: let the water shader read the main
  island's baked shadow map (`engine/BakedShadow.js`).
- **Palms that bend**, and a cheaper far model for the ones on the horizon.

## Multiplayer

- **A QR code for the invite**, so a phone can join a desktop host by
  pointing its camera at the screen.
- **Host migration.** If the host leaves, the race ends. The guests already
  know the roster and each other's states; the lowest surviving seat could
  take over the bots and the relaying. (Guests are not linked to each other,
  so this needs them to connect first: pre-exchange codes through the host.)
- **Spectating** for a player who has retired or finished: cycle the camera
  through the boats still racing.
- **Rooms that remember.** Keep the invite alive across a reload of the
  host's page (store the peer connection's description; not possible for the
  connection itself).

## Sound

- **Listen to it.** Nobody has (see [tools.md](tools.md#what-has-not)).
- **Engines of the other boats**, quieter and panned by where they are.
- **Water under the hull changing with the sea**: slap on landing is there;
  add the hiss of spray and the hollow sound of a tunnel in the air.

## Housekeeping

- **A CI job** that builds and runs `playtest.cjs` on every push (the tests
  are already headless).
- **Type checking.** The code is plain JavaScript with JSDoc types; `tsc
  --checkJs` would catch the renames that tests currently catch late.
- **Split `Game.js`.** It wires everything and has grown: the effects
  emission (`_effects`) and the draw loop (`draw`) could each be a module.
