// The light, defined once. One table per time of day; the sky, the haze, the
// sun's shadow, the environment map, the lamps, the cars' automatic lights and
// the frame's grade all read it, and nobody keeps a copy. Weather, when it
// comes, is more tables of the same shape.
//
// UNITS. Light is in scene units chosen so that an exposure of 1 suits the
// afternoon: a sheet of white paper lying in the open sun sends back about 1.
//   - An `intensity` is what a light lays on a surface facing it (irradiance;
//     what THREE.DirectionalLight.intensity means). A matt surface of albedo a
//     sends back a * E / PI.
//   - A radiance (every sky, haze, cloud, disc and ground colour here) is what
//     a camera pointed at the thing records before exposure. A whole sky of
//     radiance L lays PI * L on the ground.
//   - The frame pipeline multiplies by `exposure` and applies the tone curve,
//     which leaves 0.18 at middle grey.
// By day (sky lane) the flat ground gets about 2.1 from the sun (7.5 on a surface facing it, times the sine of 16
// degrees) and about 0.6 from the sky and the fill: some 2.7 in all, and the exposure (0.72) puts sunlit asphalt a
// little under white's knee; in open shade the ground is a little over 2 stops down and blue.
//
// NIGHT is not day tinted blue. Its light really is a few hundred times
// weaker and the exposure opens five stops (x32) to look at it. Lamps do not
// change with the time of day, so the lamp that is a pale dot in the afternoon
// glares at night, as it does to a camera. (The true gap between sun and moon
// is nearer twenty stops; eight is what leaves a moonlit road readable on a
// screen, and five of them are taken up by the exposure.)
//
// THE DISCS are the one place the ratios are not real. A sun true to its
// light would be about 90 000 here, beyond what a half-float target holds,
// and a moon true to its light would be a white hole with no phase. Both are
// set to what a camera with some highlight recovery shows: the sun still
// thousands of times brighter than paper, so that it blooms.
//
// Directions are unit vectors from the ground towards the light, in world
// space (+Y up). On the track map (+Z up the page, +X to the left) the
// lakeside straight is driven towards +X.

/**
 * @typedef {[number, number, number]} Rgb linear, scene units
 *
 * @typedef {object} TimeOfDay
 * @property {'day'|'night'} name
 *
 * @property {object} sun the one light that casts the long shadows: the sun, or the moon at night
 * @property {[number, number, number]} sun.dir unit vector towards it
 * @property {Rgb} sun.color its colour (the brightest channel is 1)
 * @property {number} sun.intensity what it lays on a surface facing it
 *
 * @property {object} sky what the dome draws, and with it the environment map that lights the scene from all round
 * @property {Rgb} sky.zenith radiance straight up
 * @property {Rgb} sky.horizon radiance of clear air at the horizon, a right angle away from the sun (the haze of
 *   `fog` is laid over it, so the very horizon shows the haze's colour, not this one)
 * @property {number} sky.falloff how quickly the zenith's colour gives way to the horizon's as the path through the
 *   air lengthens (per air mass: 0.15 keeps the blue down to about 20 degrees)
 * @property {number} sky.phase 0..1 how much darker the sky is at a right angle to the sun than towards and away
 *   from it (the shape of Rayleigh scattering)
 * @property {object} sky.glow the brightening round the sun or moon: light scattered forwards by haze
 * @property {Rgb} sky.glow.color
 * @property {[number, number]} sky.glow.wide radiance added at the sun itself, and how tight the lobe is (0..1;
 *   0.7 has fallen to half about 16 degrees out)
 * @property {[number, number]} sky.glow.tight the aureole: the same, for the few degrees round the disc
 * @property {object} sky.disc the sun's or the moon's disc
 * @property {number} sky.disc.size angular radius, degrees (both are drawn larger than life: 0.27 is true)
 * @property {number} sky.disc.radiance brightness at its centre, times `sun.color`
 * @property {number} sky.disc.limb how much darker its rim is than its centre (the sun), 0..1
 * @property {number} sky.disc.phase the lit share of its width, 0..1 (1: a full disc; the moon: 0.75)
 * @property {number} sky.disc.tilt degrees the lit side is turned from "towards the horizon below it"
 * @property {number} sky.disc.seas 0..1 how dark the moon's seas are
 * @property {Rgb} sky.ground what the dome shows below the horizon: distant land in this light, for reflections
 * @property {number} sky.stars what a star of magnitude 0 lays on the lens (0: no stars); the faintest drawn are
 *   about 1/400 of it
 * @property {number} sky.milkyWay radiance of the brightest part of the band of unresolved stars
 * @property {Rgb} sky.airglow radiance added low in the sky by the upper air's own faint light
 * @property {object} sky.clouds
 * @property {number} sky.clouds.cover 0..1 share of the sky the cumulus layer covers
 * @property {number} sky.clouds.wisps 0..1 how strong the high streaks are
 * @property {number} sky.clouds.lit share of the sun's light a cloud facing it sends on (times sun colour and
 *   intensity): what the bright edges are made of
 * @property {number} sky.clouds.silver how much brighter those edges get when the sun is behind the cloud
 * @property {Rgb} sky.clouds.shade radiance of a cloud's body where the sun does not reach
 * @property {[number, number]} sky.clouds.drift how fast they move, in sky widths per second (x, z): a few
 *   thousandths at most, or the environment map made at start-up shows clouds that have left
 * @property {{ dir: number[], size: number, amount: number }} [sky.clouds.group] a group of heaps the noise is pushed
 *   towards round one direction (`dir`, unit, towards it): `size` its radius on the cloud sheet (1 is about 25 degrees
 *   of sky at 25 degrees up), `amount` how much it adds to the noise there (0.4: a sure cloud)
 *
 * @property {object} env the environment map made from the sky
 * @property {number} env.intensity 1: surfaces are lit by the sky exactly as it is drawn
 *
 * @property {object} ambient a fill on top of the sky's own light (a HemisphereLight): light bounced about by the
 *   land, and a floor under the shadows. Where a device cannot make an environment map it also stands in for it.
 * @property {Rgb} ambient.sky colour of the fill from above
 * @property {Rgb} ambient.ground colour of the fill from below
 * @property {number} ambient.intensity what the fill from above lays on level ground
 *
 * @property {object} fog haze: what distance fades to, and how fast
 * @property {Rgb} fog.color radiance of deep haze seen away from the sun: the colour of the horizon
 * @property {Rgb} fog.sun radiance added to it looking straight at the sun
 * @property {number} fog.sunLobe how tightly that is gathered round the sun (a power of the cosine: 4 is broad)
 * @property {number} fog.density share of light lost per metre at the level of the lake (y = 0)
 * @property {number} fog.heightFalloff per metre of height: how quickly the haze thins above the valleys
 * @property {number} [fog.air] share of light lost per metre at the lake's level in the thin air above the haze (scale
 *   height 1400 m, atmosphere.js): the aerial perspective of the far land, kilometres away
 *
 * @property {number} exposure under the open sky
 * @property {number} tunnelExposure inside the tunnel; the game eases between the two with track.sky
 * @property {number} [shadeEv] stops the exposure opens under the densest roadside wood (canopy.js says how dense)
 *
 * @property {import('../../engine/FramePipeline.js').Look} look the grade of the finished picture
 *
 * @property {{ street: number, tunnel: number, windows: number, haze?: number, entrance?: number }} lamps how far each kind
 *   of lamp is turned up, 0..1 (the floodlights round the lap go with the street lamps); `haze`: how much of their
 *   light the air shows as a cone under each lamp on a pole (0: none; the damp night after rain: 1); `entrance`: how
 *   much of the tunnel's entrance and exit zones' extra light is on (the Track's lamp gains: by day all of it, at night
 *   none, as a real tunnel's are dimmed to the interior's level after dark)
 * @property {number} wetness 0..1 how wet the road is (world.wetness defaults to it; ?wet= overrides): the night
 *   is the night after rain, the road a dark mirror with puddles in the wheel tracks and low spots
 * @property {'drl'|'low'} carLights what a car's automatic lamps do under the open sky (in the tunnel: always low)
 */

const DEG = Math.PI / 180;

/**
 * A unit vector from a bearing on the track map and a height above the horizon, both in degrees. Bearing 0 is +Z
 * (up the map), 90 is +X (the way the lakeside straight is driven), 180 is -Z (out over the lake).
 */
export function towards(bearing, elevation) {
  const c = Math.cos(elevation * DEG);
  return [Math.sin(bearing * DEG) * c, Math.sin(elevation * DEG), Math.cos(bearing * DEG) * c];
}

/**
 * (sky lane, R0 addendum 2) The sun, the moon and the low golden-hour sun are placed against the start straight's
 * heading (degrees, + to the LEFT of it, towards the lake), not on the map: the heading is the Track's, and
 * createWorld hands it over through placeLights() before anything reads these directions. Until then they assume
 * the straight runs towards +X (bearing 90).
 *   day    3 degrees RIGHT of the heading, 16 up: straight down the road, as in D1 and A. The chase view drives
 *          into it, its glare lies along the asphalt, shadows fall straight back and a little left, and nothing
 *          beside the road hides the disc. The massif (far.js) stands under it, back-lit.
 *   dusk   125 degrees left of the heading (out over the lake, behind the driver's left shoulder), 2 up.
 *   moon   8 degrees left of the heading, 17 up, beside the massif's main peak.
 */
export const PLACES = { day: { left: -3, up: 16 }, dusk: { left: 125, up: 2 }, moon: { left: 8, up: 17 }, clouds: { left: 30, up: 30 } };
const SUN = towards(90 - PLACES.day.left, PLACES.day.up);
/**
 * (day lane) Where the group of cumulus stands (sky.js `group`): over the massif's great shoulder, left of its main
 * peak, as in D1, where a few big heaps with crisp white tops and soft grey bases sit some 18 to 32 degrees up between
 * 18 and 42 degrees left of the road. The rest of the sky keeps the noise's few scattered clouds.
 */
const CLOUD_GROUP = towards(90 + PLACES.clouds.left, PLACES.clouds.up);

/**
 * (sky lane) The moon: low, ahead and a little left of the start straight, beside the massif, so that the massif stands
 * as a silhouette with moonlit edges, the moon itself rides in the chase view down the straight, and the car is
 * rim-lit from ahead (its lamps and the street lamps light what faces the camera).
 */
const MOON = towards(90 + PLACES.moon.left, PLACES.moon.up);

/**
 * (sky lane) GOLDEN HOUR (references D4 and D2): the sun 3.5 degrees up at bearing 215, out over the lake and behind
 * the left shoulder of a car on the start straight. Its light crosses the straight from the lake side almost level:
 * the low wall and the lake-side lamps and trees throw shadows 15 to 20 m long that put the grid in shade or half
 * shade, while the trees, the gantry and the buildings on the land side, ahead and to the right, stand in full
 * orange light (D4). Ahead lies the sky opposite the sun: blue overhead, rose low down, with clouds lit from below.
 */
const DUSK_SUN = towards(90 + PLACES.dusk.left, PLACES.dusk.up);

/**
 * Turns the sun, the moon and the golden-hour sun to the start straight's real heading (a bearing on the map, in
 * degrees: 0 is +Z, 90 is +X). The arrays are changed in place, so every table that holds them (look.flare too)
 * follows. Bearing "left" of a heading is a larger bearing.
 * @param {number} heading
 */
export function placeLights(heading) {
  SUN.splice(0, 3, ...towards(heading + PLACES.day.left, PLACES.day.up));
  DUSK_SUN.splice(0, 3, ...towards(heading + PLACES.dusk.left, PLACES.dusk.up));
  MOON.splice(0, 3, ...towards(heading + PLACES.moon.left, PLACES.moon.up));
  CLOUD_GROUP.splice(0, 3, ...towards(heading + PLACES.clouds.left, PLACES.clouds.up));
}

/** @type {{ day: TimeOfDay, dusk: TimeOfDay, night: TimeOfDay }} */
export const TIMES = {
  // A clear autumn afternoon (D1): the sun 16 degrees up, straight down the start straight; long shadows; haze in
  // the valleys and thin air over the far land; small cumulus that catch the light.
  day: {
    name: 'day',
    sun: { dir: SUN, color: [1.0, 0.86, 0.68], intensity: 7.5 },
    sky: {
      // (day lane) bluer, as D1's sky is between its clouds: (100, 142, 192) high on the left, (152, 180, 228) to the
      // right of the sun, (195, 212, 240) in the haze round it; the drawn sky was (141, 159, 190), (139, 162, 193), (178, 190, 210)
      zenith: [0.15, 0.33, 0.86],
      horizon: [0.5, 0.65, 0.92],
      falloff: 0.15,
      phase: 0.4,
      // (look lane: the aureole, `tight`, was 7: now a white-hot halo about four times the disc's radius, which is
      // what the bloom and the glare of the frame spread over the top of the picture)
      glow: { color: [1.0, 0.92, 0.8], wide: [0.42, 0.8], tight: [40, 0.988] },
      disc: { size: 0.4, radiance: 3000, limb: 0.6, phase: 1, tilt: 0, seas: 0 },
      // grass, rock and forest of albedo 0.11 under the 3.1 the sun and sky lay on them
      ground: [0.105, 0.112, 0.09],
      stars: 0,
      milkyWay: 0,
      airglow: [0, 0, 0],
      // (day lane) D1's cumulus: crisp white tops (the frame clips them), soft grey bases, a group of big heaps
      // over the massif's shoulder and a few small ones by the sun; the rest of the sky clear
      clouds: { cover: 0.36, wisps: 0.2, lit: 0.3, silver: 1.6, shade: [0.3, 0.34, 0.42], drift: [0.0011, 0.0004], group: { dir: CLOUD_GROUP, size: 0.55, amount: 0.42 } },
    },
    // (look lane, day: 0.72, so that shade sits nearly three stops under sun as in reference A)
    // (round three) the drawn sky was raised to the frames' brightness; its light on the scene is kept where it was
    // (picture lane) less fill (was 0.72 and 0.16) and more contrast: the shade stood about a stop under the
    // sunlit ground and D1's blacks were grey (p1 30 levels against the frame's 10)
    env: { intensity: 0.6 },
    // the sky itself lays about 0.9 on level ground through the environment map; this is the little that comes
    // back off sunlit land
    // (lead) 0.13 left the shade of a forest road at a tenth of the sunlit road and black in the picture; a real
    // road in open shade keeps a fifth
    ambient: { sky: [0.6, 0.72, 1.0], ground: [1.0, 0.86, 0.62], intensity: 0.3 },
    fog: { color: [0.26, 0.35, 0.52], sun: [0.06, 0.04, 0.02], sunLobe: 16, density: 0.0001, heightFalloff: 0.011, air: 0.00006 },
    exposure: 0.68,
    // two and a half stops more inside, where only the lamps and the portals' daylight reach
    tunnelExposure: 5.6,
    shadeEv: 1.0,
    // (look lane: reference A's glare: a stronger veil, the lens's own glare round the sun and its ghosts)
    // flare: the sun's light as the flare source measures the disc in the frame, so that it glares from just outside too
    look: { flare: { dir: SUN, light: 1.0, reach: 0.6, sky: 0.3 }, contrast: 1.09, saturation: 1.18, tint: [1.0, 0.99, 0.965], lift: [0.0004, 0.0006, 0.001], vignette: 0.28, chroma: 0.0012, grain: 0.5, bloom: 0.05, ghosts: 0.00015, glare: 0.015, ao: 0.8, star: 0.02 },
    lamps: { street: 0, tunnel: 1, windows: 0, entrance: 1 },
    wetness: 0,
    carLights: 'drl',
  },

  // (sky lane) GOLDEN HOUR, late (D4): dry, the sun 2 degrees up and red-orange; the fill low, so that the lit
  // crowns and the lamps carry the picture. The lamps and windows are on.
  // (render lane) golden, not violet: D4 is warm gold light on everything and deep WARM shade. The sky is a gold
  // haze low down (the band) paling through a soft warm white into a clear, light blue overhead, never violet; the
  // haze the far land fades into is gold-brown; the fill from the sky is warm (the sky's own light comes through
  // the environment map, which is drawn from this sky); the grade warms the white balance and puts rust in the
  // shadows and gold in the highlights.
  dusk: {
    name: 'dusk',
    sun: { dir: DUSK_SUN, color: [1.0, 0.56, 0.24], intensity: 2.8 },
    sky: {
      zenith: [0.02, 0.034, 0.068],
      horizon: [0.17, 0.11, 0.06],
      falloff: 0.2,
      phase: 0.3,
      glow: { color: [1.0, 0.58, 0.26], wide: [0.55, 0.55], tight: [18, 0.985] },
      disc: { size: 0.45, radiance: 600, limb: 0.6, phase: 1, tilt: 0, seas: 0 },
      // the gold belt low all round, deeper under the sun (sky.js: radiance at the horizon, height)
      band: { color: [0.15, 0.085, 0.036], height: 0.16 },
      ground: [0.036, 0.027, 0.018],
      stars: 0,
      milkyWay: 0,
      airglow: [0, 0, 0],
      clouds: { cover: 0.45, wisps: 0.4, lit: 0.09, silver: 1.6, shade: [0.032, 0.024, 0.024], drift: [0.0011, 0.0004], group: { dir: CLOUD_GROUP, size: 0.42, amount: 0.3 } },
    },
    env: { intensity: 0.6 },
    ambient: { sky: [0.95, 0.78, 0.6], ground: [1.0, 0.62, 0.34], intensity: 0.014 },
    fog: { color: [0.1, 0.068, 0.042], sun: [0.4, 0.19, 0.06], sunLobe: 6, density: 0.00025, heightFalloff: 0.011, air: 0.00008 },
    exposure: 4.2,
    tunnelExposure: 6,
    shadeEv: 0.6,
    look: {
      flare: { dir: DUSK_SUN, light: 0.6, reach: 0.5, sky: 0.1 },
      contrast: 1.2,
      saturation: 1.16,
      tint: [1.05, 1.0, 0.9],
      lift: [0.0004, 0.00025, 0.0001],
      vignette: 0.3,
      chroma: 0.001,
      grain: 0.6,
      bloom: 0.09,
      ghosts: 0.0002,
      glare: 0.03,
      ao: 1.0,
      star: 0.015,
      halo: 0.05,
      splitShadows: [1.06, 0.98, 0.9],
      splitHighlights: [1.05, 1.0, 0.88],
      splitBalance: 0.45,
    },
    lamps: { street: 1, tunnel: 1, windows: 0.7, entrance: 0.5 },
    wetness: 0,
    carLights: 'low',
  },

  // A clear night under a three-quarter moon. The moon draws the ridges, the edges of the road and the car's
  // outline; everything else is lamps.
  night: {
    name: 'night',
    // (night lane) the moon x1.5 and the sky about x1.6 and bluer: the owner's night was black beyond the head lamps.
    // The sky is now a deep blue that the massif stands against as a silhouette, and its light (the environment
    // map) and the moon's make the forest and the mountain readable; the lamps still burn far above it.
    sun: { dir: MOON, color: [0.6, 0.75, 1.0], intensity: 0.12 },
    sky: {
      zenith: [0.0007, 0.0014, 0.0038],
      horizon: [0.0024, 0.0038, 0.0072],
      falloff: 0.12,
      phase: 0.25,
      glow: { color: [0.62, 0.77, 1.0], wide: [0.002, 0.7], tight: [0.012, 0.95] },
      disc: { size: 0.9, radiance: 0.055, limb: 0.1, phase: 0.75, tilt: -25, seas: 0.5 },
      ground: [0.0009, 0.0012, 0.0019],
      stars: 1.5e-6,
      milkyWay: 0.0005,
      airglow: [0.0003, 0.00055, 0.0004],
      clouds: { cover: 0.3, wisps: 0.25, lit: 0.12, silver: 2.2, shade: [0.0003, 0.00042, 0.0008], drift: [0.0011, 0.0004], group: { dir: CLOUD_GROUP, size: 0.42, amount: 0.3 } },
    },
    env: { intensity: 1 },
    // the night sky lays only about a tenth of the moon's light on the ground; this keeps the moon's shadows
    // from being holes
    ambient: { sky: [0.45, 0.6, 1.0], ground: [0.3, 0.36, 0.5], intensity: 0.013 },
    // (look lane: the haze halved, the far ranges were pale grey behind black hills; reference B's are near black)
    fog: { color: [0.0008, 0.0011, 0.0019], sun: [0.0004, 0.0005, 0.0008], sunLobe: 4, density: 0.00042, heightFalloff: 0.011, air: 0.00006 },
    // four stops above day (look lane: was five; at 32 the moonlit land read as dusk and everything that faces a head
    // lamp within 30 m burnt to white; reference B is darker, its lights brighter against it)
    // (look lane, day stage: the lead found night far darker than reference B, where nothing is black but the far
    // hills: the moon x2.2, the sky x2 and the fill x3 instead of more exposure, so the lamps do not burn)
    // (picture lane) was 18: away from the lamps the lower half of the frame was black (p10 of 4 levels)
    exposure: 22,
    // the lit tunnel is two stops brighter than the moonlit road outside
    // (tunnel lane) the box is lit as by day inside (its entrance zone at the interior's level): was 8, a white glare
    tunnelExposure: 5,
    look: { contrast: 1.12, saturation: 0.94, tint: [0.95, 0.985, 1.05], lift: [0.0006, 0.0009, 0.0018], vignette: 0.32, chroma: 0.0012, grain: 1.2, bloom: 0.15, ghosts: 0, ao: 0.9, star: 0.015, halo: 0.15 },
    lamps: { street: 1, tunnel: 1, windows: 1, haze: 1, entrance: 0 },
    // the night after rain (look reference B): wet asphalt, water standing in the ruts and the dips
    // (night lane: was 0.65, water only in the deepest dips; the references' road is a dark mirror)
    wetness: 0.8,
    carLights: 'low',
  },
};

export const TIME_NAMES = Object.keys(TIMES);
