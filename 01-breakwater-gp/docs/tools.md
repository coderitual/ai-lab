# Tools, tests and what has been verified

Everything in `tools/` is a development script. None of it is part of the
build, and all of it needs [Playwright](https://playwright.dev) available to
Node (it is not a project dependency); recording video also needs `ffmpeg`.

They share one idea: the game can be *stepped* instead of run (`?manual`,
`__bw.advance`, `__bw.skip`), so a result does not depend on how fast the
machine draws. See [techniques.md](techniques.md#16-tests-and-pictures-that-do-not-depend-on-the-clock).

## Servers

```bash
npm run dev        # http://localhost:5173   the game, and viewer.html
npm run build && npm run preview   # http://localhost:4173   the production build
```

Tests run against the build (4173). The screenshot tool needs the dev server
(5173), because the asset viewer is not part of the build. Do not rebuild
while a test is running against the preview.

## The scripts

| script | what it does |
| --- | --- |
| `tools/playtest.cjs URL` | Solo and split screen through the real input paths: keys, touch on phone-sized viewports in both orientations, rules, panels, a lost WebGL context. 71 checks. |
| `tools/soundtest.cjs URL [dir]` | Renders the soundtrack offline and looks for every cue: moment, side, level. 16 checks. With `dir`, keeps the WAV files. |
| `tools/nettest.cjs URL [dir] [--only=a\|b\|c\|d]` | Online play between pages of one browser: A the whole two-player flow, B a slow lossy link, C real time, D four players. 61 checks. |
| `tools/screenshots.cjs` | Regenerates every picture in the README and these documents. `--list`, `--only a,b`. |
| `tools/capture.cjs` | Stills (`--at 9,24`) or a frame-accurate recording (`--from --seconds --fps`), optionally with sound (`--sound --mp4 file`). `--drive` lets bots drive for the players. |
| `tools/shot.cjs` | One screenshot of any URL (used with `viewer.html`). |
| `tools/soundcap.cjs` | The offline-audio rig the two tools above share. |

Typical session before a push:

```bash
npm run build && npm run preview &
node tools/playtest.cjs http://localhost:4173/
node tools/soundtest.cjs http://localhost:4173/
node tools/nettest.cjs http://localhost:4173/
npm run dev &
node tools/screenshots.cjs          # if anything visible changed
```

A recording with sound:

```bash
node tools/capture.cjs --url "http://localhost:4173/?mode=split&manual&dpr=1" --drive --seconds 40 --out clip/f --sound --mp4 clip/split.mp4
```

## The viewer

`viewer.html` shows one asset over the real sea and sky:

```
viewer.html?asset=craft&team=0&flat&sea=0.05&az=250&el=17&dist=8.5&fov=40&ty=0.45
```

`asset` is `sea`, `craft`, `crafts` (the four liveries) or `world`. `az`, `el`
and `dist` place the camera round the target (`tx`, `ty`, `tz`); `az=270` is
astern, `az=90` ahead of the bow. `flat` holds a boat level, `sea` scales the
waves, `manual` stops the loop (step with `__viewer.frames(n)`).

## What has been verified

With the scripts above, in headless Chromium on software WebGL.

- **Solo.** A full three-lap bot race (about 2 min 40 s, no missed marks,
  hulls in the water except for the sixth of the time they are in the air).
  The keyboard path. The touch path on iPhone-sized viewports in both
  orientations: the stick appears under the thumb, drag steering, pull-down
  and second-finger braking, panels fit. The rules: clean pass, miss,
  off-course reset, five misses and out. Results and restart. A lost and
  restored WebGL context. The production build.
- **Split screen.** Separate keys, rules and readouts per driver; results,
  rematch, back to the menu.
- **Drawing.** Solo, split screen and a phone-sized view draw all their
  passes (reflection map, sun shadows, a mirror image per view, lens drops)
  without WebGL errors or console warnings.
- **Sound**, by measurement: every start signal and mark chime is found at
  its moment; in split screen each driver's engines, chimes and hard landings
  sit on their side (about 10 dB stronger there) while start signals are
  centred; solo is centred; nothing clips; "sound off" is silent.
- **Online**, between pages of one browser on one machine: the whole
  two-player flow (invite, reply, wrong or mangled pastes, race, results,
  rematch, one side leaving); four players (names, seats, positions relayed
  through the host, name tags, a friend leaving mid-race, back to the lobby,
  the next race); a simulated bad link (80–120 ms each way, 5 % lost: the
  other boat is drawn about 0.1 m from where it really is on average and
  under 1 m at worst, and a 1.5 s stall on one machine leaves both clocks in
  agreement); both pages in real time (the two sea clocks stay within a few
  milliseconds of each other).

## What has not

- **Real Safari/WebKit and real phones.** Only Chromium was available. The
  game is written for iPhone Safari (WebGL 2, pointer events, audio started
  from a tap), but none of that has been seen on a device.
- **Frame rate on a device.** A frame is several passes and a costly water
  shader. Everything expensive is scaled down on phones and given up when
  frames run long, but what a given phone actually manages is not known.
- **Whether it sounds good.** The measurements say what is played, when,
  where and how loud. Nobody has listened to it.
- **Online between two real devices.** Whether two networks let the browsers
  reach each other cannot be tried from one machine; nor can the system share
  sheet on a phone.
