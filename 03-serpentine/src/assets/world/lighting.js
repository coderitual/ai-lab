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
// By day the flat ground gets about 2.2 from the sun (5.4 on a surface facing
// it, times the sine of 24 degrees) and about 0.9 from the sky: 3.1 in all,
// PI within a hair, so an 18 % grey card in the sun reads 0.18 and lands on
// middle grey, and in open shade it is 1.8 stops down and blue.
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
 *
 * @property {number} exposure under the open sky
 * @property {number} tunnelExposure inside the tunnel; the game eases between the two with track.sky
 *
 * @property {import('../../engine/FramePipeline.js').Look} look the grade of the finished picture
 *
 * @property {{ street: number, tunnel: number, windows: number }} lamps how far each kind of lamp is turned up, 0..1
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
 * Where the sun stands, chosen on the track map (look lane, day stage; was bearing 150, 24 degrees up, which left
 * most of the lap in the mountain's and the forest's shade: the lap read as dusk). Surveyed with the land AND the
 * forest in the way (scratchpad lookday/sun2.mjs: a march from each point of the road towards the sun, shaded by
 * the ground or by trees about 22 m tall within 120 m): 73 % of the open road is in direct sun (it was 54 %).
 *   lakeside straight, start  in full sun from behind and to the left, over the lake
 *   sweeper, esses            the spruces lay their shadows across the road, bend after bend (555..765 m)
 *   viaduct                   in the ridge's shadow at its start
 *   hairpins                  in and out of the wood's shadow
 *   descent                   INTO THE SUN on its two long straights (2060..2345 m and 2685..2935 m) at 110 to
 *                             150 km/h: the road ahead glares, the sun stands just over the top of the far chase
 *                             view and flares (look.flare), dropping into it where the road levels out
 * The height is a compromise: the far chase camera sees up to about 26 degrees above level, so a sun higher than
 * that is never in its frame; the 35..45 degrees that would light the whole lap would never flare at all. At 30
 * the disc stands just over the frame on the descent and the lens still takes its glare (FramePipeline's flare
 * source follows a light up to a quarter of the view's height outside the frame).
 */
const SUN = towards(-120, 30);

/**
 * The moon: opposite the sun on the map and high. On the straight it is behind and to the right, over the wood,
 * so the tail of the car is moonlit and the moon rides in the rear screen; over the viaduct it is dead ahead; on
 * the descent it lights the rock face that the afternoon leaves in shade.
 */
const MOON = towards(330, 50);

/** @type {{ day: TimeOfDay, night: TimeOfDay }} */
export const TIMES = {
  // A clear afternoon late in the year: the sun 24 degrees up, warm, well to one side; long shadows; haze in the
  // valleys; a few clouds that catch the light.
  day: {
    name: 'day',
    sun: { dir: SUN, color: [1.0, 0.86, 0.68], intensity: 6.2 },
    sky: {
      zenith: [0.04, 0.15, 0.5],
      horizon: [0.23, 0.37, 0.62],
      falloff: 0.15,
      phase: 0.4,
      // (look lane: the aureole, `tight`, was 7: now a white-hot halo about four times the disc's radius, which is
      // what the bloom and the glare of the frame spread over the top of the picture)
      glow: { color: [1.0, 0.9, 0.74], wide: [0.9, 0.74], tight: [40, 0.965] },
      disc: { size: 0.4, radiance: 3000, limb: 0.6, phase: 1, tilt: 0, seas: 0 },
      // grass, rock and forest of albedo 0.11 under the 3.1 the sun and sky lay on them
      ground: [0.105, 0.112, 0.09],
      stars: 0,
      milkyWay: 0,
      airglow: [0, 0, 0],
      clouds: { cover: 0.44, wisps: 0.6, lit: 0.2, silver: 1.6, shade: [0.27, 0.31, 0.39], drift: [0.0011, 0.0004] },
    },
    // (look lane, day: 0.72, so that shade sits nearly three stops under sun as in reference A)
    env: { intensity: 0.72 },
    // the sky itself lays about 0.9 on level ground through the environment map; this is the little that comes
    // back off sunlit land
    ambient: { sky: [0.6, 0.72, 1.0], ground: [1.0, 0.86, 0.62], intensity: 0.06 },
    fog: { color: [0.36, 0.46, 0.62], sun: [0.6, 0.42, 0.24], sunLobe: 8, density: 0.0003, heightFalloff: 0.011 },
    exposure: 1.1,
    // two and a half stops more inside, where only the lamps and the portals' daylight reach
    tunnelExposure: 5.6,
    // (look lane: reference A's glare: a stronger veil, the lens's own glare round the sun and its ghosts)
    // flare: the sun's light as the flare source measures the disc in the frame, so that it glares from just outside too
    look: { flare: { dir: SUN, light: 1.0, reach: 0.6, sky: 0.3 }, contrast: 1.16, saturation: 1.14, tint: [1.0, 0.99, 0.965], lift: [0, 0, 0], vignette: 0.3, chroma: 0.0012, grain: 0.6, bloom: 0.12, ghosts: 0.008, glare: 0.3 },
    lamps: { street: 0, tunnel: 1, windows: 0 },
    wetness: 0,
    carLights: 'drl',
  },

  // A clear night under a three-quarter moon. The moon draws the ridges, the edges of the road and the car's
  // outline; everything else is lamps.
  night: {
    name: 'night',
    sun: { dir: MOON, color: [0.6, 0.75, 1.0], intensity: 0.08 },
    sky: {
      zenith: [0.00045, 0.00085, 0.0021],
      horizon: [0.0016, 0.0025, 0.0046],
      falloff: 0.12,
      phase: 0.25,
      glow: { color: [0.62, 0.77, 1.0], wide: [0.002, 0.7], tight: [0.012, 0.95] },
      disc: { size: 0.9, radiance: 0.055, limb: 0.1, phase: 0.75, tilt: -25, seas: 0.5 },
      ground: [0.0007, 0.0009, 0.0014],
      stars: 1.5e-6,
      milkyWay: 0.0005,
      airglow: [0.0003, 0.00055, 0.0004],
      clouds: { cover: 0.44, wisps: 0.6, lit: 0.2, silver: 2.2, shade: [0.0004, 0.00055, 0.001], drift: [0.0011, 0.0004] },
    },
    env: { intensity: 1 },
    // the night sky lays only about a tenth of the moon's light on the ground; this keeps the moon's shadows
    // from being holes
    ambient: { sky: [0.45, 0.6, 1.0], ground: [0.3, 0.36, 0.5], intensity: 0.009 },
    // (look lane: the haze halved, the far ranges were pale grey behind black hills; reference B's are near black)
    fog: { color: [0.0008, 0.0011, 0.0019], sun: [0.0004, 0.0005, 0.0008], sunLobe: 4, density: 0.00042, heightFalloff: 0.011 },
    // four stops above day (look lane: was five; at 32 the moonlit land read as dusk and everything that faces a head
    // lamp within 30 m burnt to white; reference B is darker, its lights brighter against it)
    // (look lane, day stage: the lead found night far darker than reference B, where nothing is black but the far
    // hills: the moon x2.2, the sky x2 and the fill x3 instead of more exposure, so the lamps do not burn)
    exposure: 18,
    // the lit tunnel is two stops brighter than the moonlit road outside
    tunnelExposure: 8,
    look: { contrast: 1.12, saturation: 0.94, tint: [0.95, 0.985, 1.05], lift: [0.0006, 0.0009, 0.0018], vignette: 0.32, chroma: 0.0012, grain: 1.2, bloom: 0.15, ghosts: 0 },
    lamps: { street: 1, tunnel: 1, windows: 1 },
    // the night after rain (look reference B): wet asphalt, water standing in the ruts
    wetness: 0.65,
    carLights: 'low',
  },
};

export const TIME_NAMES = Object.keys(TIMES);
