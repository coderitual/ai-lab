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
  ideally its own sea (the wave table in `engine/waves.js` is global today;
  make it a property of the course).
- **Time trial with a ghost.** The network code already records and replays a
  boat's state 20 times a second (`OnlinePlay._store`, `applyRemote`). Save
  the best lap to `localStorage` and feed it through the same path.
- **Bots that race each other.** Today each follows a line and avoids sterns.
  Give them a notion of the inside line at a mark and of defending it.
- **Difficulty.** The catch-up is a hidden ±4 %; expose three settings that
  change `pace` and the cap on power.
- **Weather.** `sea.scale` already exists (`?sea=`). A calm race and a rough
  race are one number apart; a squall that passes over mid-race would be a
  slow ramp of it plus a darker sky.

## The boat and the driving

- **Two floats instead of one.** Give each sponson its own buoyancy sample
  and force (`game/Craft.js` treats the hull as one point with an attitude).
  Real roll, hooking a sponson in a turn, landing on one side.
- **Air under the tunnel.** At speed the tunnel packs air and lifts the bows;
  too much trim into a headwind and the boat blows over. A trim control
  (two keys, or the vertical axis of the touch stick while not braking) would
  give the driver something to manage on the straights.
- **Liveries chosen by the player.** `paintLivery` takes any two colours and a
  number; add a colour picker to the title screen and the lobby, and send the
  choice in the `hello` message.
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
- **A bow wave you can see.** Write displacement into a fourth channel of the
  wake field and add it in the ocean's vertex shader.
- **A second reflection probe** for the other split-screen player (today both
  boats mirror the map taken at player one's boat).
- **Step back up.** Quality only ever steps down. Step up again after a
  minute of fast frames.
- **Motion blur at the edges of the frame** at full power, cheaply, by
  stretching the lens-drop copy of the frame radially.

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
