# Breakwater GP

A small, original jet-ski slalom racing demo for the browser, built with
[three.js](https://threejs.org). One island circuit, three laps, four crafts,
a simulated sea that the crafts genuinely ride on. Everything you see is
generated in code: there are no model, texture or audio files.

Race alone against three bots, or against friends: split screen on one
keyboard, or online with up to four players and no game server.

It runs on desktop (keyboard) and on phones (touch), and is written for iPhone Safari.

**▶ Play it: https://coderitual.github.io/ai-lab/01-breakwater-gp/**

![Mid-air over a swell on the home stretch](public/og.jpg)
![Phone layout with thumb controls](docs/race-phone.jpg)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — also served on your LAN, so you can open it from a phone
npm run build      # static site in dist/  (relative paths: host it anywhere)
npm run preview    # serve the production build
```

## How to play

Three ways to race, chosen on the title screen:

- **Solo**: you against three bots.
- **Two players, split screen**: two riders on one keyboard, each with their
  own half of the screen, plus two bots. Player 1 uses `W` `A` `S` `D`,
  player 2 the arrow keys. Each rider's engine, chimes and splashes come from
  their side of the stereo picture (headphones or two speakers help).
- **Online, two to four players**: one rider per device, bots in the empty
  seats, and no game server. See [Online play](#online-play) below.

Solo controls:

|            | Keyboard            | Phone                                   |
| ---------- | ------------------- | --------------------------------------- |
| Steer      | `←` `→` (or `A` `D`) | touch anywhere and drag sideways        |
| Throttle   | `↑` (or `W`)         | automatic                               |
| Brake      | `↓` / `S` / `Space`  | pull that thumb down, or hold a second finger anywhere |
| Start      | `Enter` or the button | tap the button                         |
| Sound      | `M` or the link on the panels | the link on the panels         |

On a phone one thumb is enough: wherever it lands, a stick appears under it.
In multiplayer every other rider carries a name tag with their place, and
online their ping.

The slalom marks follow real lateral marks:

- **Red can** (flat top): ride past on its **right**.
- **Green cone** (pointed top): ride past on its **left**.

Each clean pass adds one level of **power** (up to five) and with it top speed.
A miss drops power to zero and counts toward five allowed misses; the fifth
puts you out. Stay inside the orange floats: after five seconds outside you are
put back on course without power.

The sea is rough on the open-ocean side of the island and calmer in its lee.
Hitting the swell head-on at speed throws the craft into the air; you cannot
steer or drive in the air, and a hard landing costs speed.

## Online play

Up to four players on their own devices, and no game server in between: the
browsers connect straight to each other (WebRTC). All they need from you is
help finding each other, which takes two messages per friend in any chat app.

1. **You** (the host): *2–4 players online → Invite friends*, then send the
   invite link to a friend.
2. **Your friend**: opens the link, gets a reply code, sends it back.
3. **You**: paste the reply code and press *Connect*. Their name appears in
   the seat list, and a fresh invite is ready for the next friend.
4. Repeat for up to three friends, then *Start race*. Bots take the seats
   nobody claimed.

Everyone rides their own craft on their own device, so the controls never wait
for the network. All devices keep one shared clock, so the waves, the start
lights and the timing are the same on every screen. After the flag the host
can start a rematch, or go back to the lobby to invite more players.

### If there is no server, what does the work?

- **GitHub Pages** only hands out the game's files. It never sees a race.
- **You** are the matchmaker. The invite and the reply are each browser's
  "this is how to reach me" note (network addresses and an encryption
  fingerprint), which a signalling server would normally pass along. Here you
  pass them along by chat.
- **STUN servers** (public ones run by Google and Cloudflare) answer one
  question while a note is being written: "what is my address as seen from the
  internet?". No game data goes through them.
- **The host's browser** is the nearest thing to a server once the race is on:
  it runs the bots, starts the races, and passes each guest's position on to
  the other guests. Guests are linked to the host only.
- Everything in a race travels directly between the browsers, encrypted.

Good to know:

- Keep the page open while you swap the two messages. Reloading or closing it
  makes the invite or the reply worthless, and each can be used once.
- The link and the code contain network addresses. Send them to the people you
  are playing with, not to a public channel.
- There is no relay to fall back on, so two devices that both sit behind strict
  networks (some office, campus and mobile-carrier networks) may not be able
  to connect. The game says so after about 25 seconds; home Wi-Fi or a phone
  hotspot usually works.
- If the host leaves, the race is over for everyone; if a guest leaves, the
  others race on.
- Open the game from its public address. Embedded previews that block WebRTC
  cannot connect.

## How it is put together

```
src/
  assets/     everything visible, generated with three.js
    palette.js      colour script + sun direction + team colours
    textures.js     tileable noise / ripple / caustic / label textures (CPU generated)
    sky.js          sky dome shader, shared sky-fog GLSL, PMREM environment
    water.js        ocean mesh (radial grid) + shader (light through the waves, caustics, foam trails, glitter)
    watercraft.js   swept hull, saddle, trim      rider.js   IK-posed rider
    buoys.js        slalom marks, course floats, start arch
    island.js       analytic low-poly islands     scenery.js palms, rocks, lighthouse, pier, sailboats
    geo.js          modelling helpers (loft, merge, facet, two-bone IK)
  engine/     reusable runtime
    Engine.js       renderer, resize, fixed-timestep loop + interpolation, adaptive resolution
    waves.js        THE sea: one Gerstner wave set used by both the shaders and the physics
    ChaseCamera.js  chase / orbit camera        Input.js   keyboard + multi-touch
    Audio.js        synthesised engine, water and cues (Web Audio), one voice per rider
  game/       this particular game
    track.js        centre line, marks, racing line, grid
    World.js        builds the location from the assets, floats the props
    Craft.js        watercraft physics          drivers.js player + bot drivers
    Race.js         rules: marks, power, misses, laps, ranking, respawn
    effects.js      wake field (render-to-texture foam + shadows), spray particles
    Hud.js / hud.css   DOM HUD (one set of readouts per rider), minimap, panels, online lobby
    Game.js         wires it all together: solo, split screen (two viewports), online
  net/        online play
    PeerLink.js     WebRTC data channels joined by hand-carried codes (no signalling server)
    OnlinePlay.js   lobby flow, shared clock, state messages, prediction of remote crafts
tools/        optional dev scripts (need Playwright): screenshots, frame-stepped capture with sound, play and sound tests
```

A few choices worth knowing about:

- **One sea, two consumers.** `engine/waves.js` defines six trochoidal waves and
  an amplitude field (calm near shores and behind the island). The same
  numbers feed the GLSL (vertex displacement, per-pixel analytic normals) and
  `sampleSurface()` on the CPU (buoyancy, pitch/roll, floating props, camera
  clearance). What you see is what the physics rides. A second tier of short,
  steep chop (under 10 cm high) is drawn by the GPU only: it sharpens the
  surface without touching the handling.
- **Water shading** (`assets/water.js`): a deep body that lightens with wave
  height; sunlight coming *through* the water where a wave is thin and where
  you look sunward into its face (the turquoise glow); caustics drifting inside
  that glow, and sharp on the sand where the water is shallow enough to see
  the bottom; foam that is laid where the swell bunches up and then lingers
  behind the moving crest, drawn as lacy threads over a veil of aerated water;
  and sun glitter from a normal-map lookup held at constant size on screen.
- **Caustics made the way they are made** (`assets/textures.js`): a grid of
  rays is bent by the slopes of a periodic ripple field and collected where it
  lands. Where neighbouring rays cross, light piles up into the familiar net.
  Two copies of that texture slide over each other in the shader.
- **The watercraft** (`assets/watercraft.js`) is one cross-section (keel,
  strake, chine, topside, gunwale, footwell, hood) swept from stern to bow and
  split into strips where a real hull has a hard edge, so chines and deck
  edges stay crisp while the rest is smooth. The paint has a clear coat.
- **Craft physics** (`game/Craft.js`) is a one-sided buoyancy spring — water
  pushes up, only gravity pulls down — so jumps fall out of the simulation
  instead of being scripted. Wave faces push the hull downhill, grip and
  thrust fade as the hull leaves the water, and the hull's attitude is fitted
  to four samples of the surface.
- **Fixed 120 Hz simulation, interpolated rendering.** Handling is identical at
  30, 60 or 120 fps.
- **Wake field.** Wakes, hull wash, splash rings and soft craft shadows are drawn
  top-down into a small texture each frame and sampled by the ocean shader, so
  foam lies in the water surface and drifts with it. No geometry floating on top.
- **Cheap to draw.** Static scenery is merged and vertex-coloured, floats are
  instanced, there are no shadow maps or post-processing: about 100 draw calls
  and 170k triangles per frame. Split screen draws the scene twice, each half
  with its own camera, its own dense patch of ocean and its own wake texture.
- **Sound without files.** `engine/Audio.js` synthesises everything: each rider
  on the machine gets a voice (three oscillators through a low-pass that opens
  with the revs, plus filtered noise for the water), and one-off tones and
  noise bursts mark the start, clean passes, misses, laps and landings. In
  split screen the two voices are panned to their rider's half of the screen,
  the second engine runs 7 % higher so the two do not blur into one, and each
  rider's cues are panned with them. The start signals stay in the middle.
- **Online without a server.** `net/PeerLink.js` packs each browser's WebRTC
  session description into a text code (deflate + base64url) that the players
  carry by hand; that replaces the signalling server. `net/OnlinePlay.js` then
  runs the race over two data channels per friend:
  - The links form a star: each guest is linked to the host only (anything
    else would mean swapping codes between every pair of players), and the
    host passes each guest's reports on to the other guests.
  - Each machine simulates only its own rider (the host also the bots) and
    reports those crafts 20 times a second on an unreliable channel, where a
    late update is simply dropped.
  - Both machines read one **sea clock**. The guest sets its clock to the
    host's from ping round trips and keeps trimming it by a few milliseconds
    during the race. While a link is up the clock is tied to real time: a
    machine that drops frames or has its tab hidden loses ground on the water,
    not time on the clock, so the two race clocks cannot drift apart.
  - A remote craft is drawn where it should be *now*: its newest report is
    coasted forward on its speed and turn rate, and each correction is blended
    in over a few frames. Its height, pitch and roll are replayed a moment late
    and set onto the local copy of the shared sea.

## Phones

- Canvas pixel ratio is capped at 2 and steps down (at most twice) if the device
  cannot hold about 45 fps.
- One-hand touch control: the first finger down becomes a stick wherever it
  lands (sideways steers, a pull down brakes, both follow the thumb so a
  change of direction answers at once); a second finger is a brake too.
- Touch input uses Pointer Events with `touch-action: none`; scrolling, pinch
  zoom, double-tap zoom, text selection and long-press callouts are suppressed
  on the game surface. HUD padding respects the safe-area insets.
- Works in both orientations (landscape recommended); the lens widens in portrait.
- Audio starts on the Start tap, as iOS requires, and obeys the ring/silent switch.
- Needs WebGL 2 (iOS 15+).

## Dev tools

These are not part of the build and need Playwright available to Node.

```bash
node tools/shot.cjs --url "http://localhost:5173/viewer.html?asset=craft" --out craft.png   # asset viewer shots
node tools/capture.cjs --url "http://localhost:4173/?auto&ap&manual&dpr=1" --at 9,24,41 --out shots/lap   # stills
node tools/capture.cjs --url "…" --from 46 --seconds 10 --fps 30 --out clip/f                # frames for ffmpeg
node tools/playtest.cjs http://localhost:4173/                                                # solo + split screen: input, rules, panels
node tools/nettest.cjs http://localhost:4173/                                                 # online: two to four pages join and race
node tools/soundtest.cjs http://localhost:4173/ wavs/                                         # sound: every cue, its moment and its side
```

A recording with sound, straight to a file (needs `ffmpeg`):

```bash
node tools/capture.cjs --url "http://localhost:4173/?mode=split&manual&dpr=1" --ride --seconds 40 --out clip/f --sound --mp4 clip/split.mp4
```

Software WebGL draws a frame far slower than it plays, so neither the picture
nor the sound can be recorded in real time. The game is stepped frame by frame
instead, and for the sound the page is handed an `OfflineAudioContext` whose
clock is the game clock (`tools/soundcap.cjs`): the game's audio code runs
unchanged and the whole soundtrack is rendered at the end, in step with the
frames. `--ride` lets bots ride for the riders, who keep their names.

Useful query options: `?auto` (skip the title), `?ap` (a bot rides your craft),
`?mode=split`, `?laps=1`, `?dpr=1`, `?sea=0.8` (wave height), `?manual` (step
with `__bw.advance(seconds)` / `__bw.skip(seconds)`), `?nodraw` (run without
rendering), and for online play `?netlag=80&netjitter=40&netloss=5` (hold back
by 80–120 ms, and drop 5 % of, the updates this page receives).

`viewer.html?asset=sea|craft|crafts|world&az=…&el=…&dist=…` shows single assets
over the real sea and sky.

## What was (and was not) verified

Checked with the scripts in `tools/` in headless Chromium (software WebGL):

- **Solo**: a full three-lap bot race on the bigger sea, the keyboard path,
  the touch path on iPhone-sized viewports in both orientations (the stick
  appears under the thumb anywhere, drag steering, pull-down and second-finger
  braking, panels fit), the rules (clean pass, miss, off-course reset, five
  misses and out), results and restart, a lost and restored WebGL context, and
  the production build.
- **Split screen**: separate keys per rider, rules and readouts per rider,
  results, rematch, back to the menu.
- **Sound**, by measuring the rendered soundtrack rather than by listening:
  every start signal and mark chime the game asks for is found at its moment;
  in split screen each rider's engine, chimes and hard landings sit on their
  side (about 10 dB stronger there) while the start signals are centred; solo
  and stacked split screen are centred; the level is about -18 LUFS with
  nothing clipping; "sound off" is silent.
- **Online**, between pages of one browser on one machine:
  - the whole flow with two players: invite, reply, wrong or mangled pastes,
    race, results, rematch, one side leaving;
  - four players, each joined with their own invite and reply: names and
    seats, every rider drawn where they really are on every machine (guest to
    guest through the host), name tags, one friend leaving mid-race, results,
    back to the lobby and on into the next race;
  - a simulated bad link (80–120 ms each way, 5 % of updates lost): the other
    rider is drawn about 0.1 m from where they really are on average and
    under 1 m at worst, without visible snapping, and a 1.5 s stall on one
    machine leaves both clocks in agreement;
  - both pages running in real time: the two sea clocks stay within a few
    milliseconds of each other, also after a 0.7 s hitch.

Not checked:

- Real Safari/WebKit and real phone hardware (only Chromium was available),
  and frame rate on a device.
- Whether the sound is *pleasant*. The measurements say what is played, when,
  where and how loud; nobody has listened to it on speakers.
- Online play between two real devices across the internet. Whether two
  networks let the browsers reach each other (NAT traversal) cannot be tried
  from one machine, and neither can the system share sheet on a phone.
