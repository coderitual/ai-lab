// The light, defined once. One table per time of day; everything that shades,
// glows or exposes reads it, and nobody keeps a copy. Weather, when it comes,
// is more tables of the same shape.
//
// Units. Light is in scene units chosen so that an exposure of 1 suits a
// sunlit afternoon:
//   - a light's `intensity` is what it lays on a surface facing it (what
//     THREE.DirectionalLight.intensity means); a matt surface sends back
//     albedo * intensity / PI. The day's sun is 10: a white wall square to it
//     shows about 3, sunlit asphalt about 0.2.
//   - sky and fog colours are what a camera pointed at them sees, before
//     exposure.
//   - the frame pipeline multiplies everything by `exposure` and then applies
//     the tone curve, which turns about 0.18 into middle grey.
// Night is not day tinted blue. Its light really is a few hundred times
// weaker (the moon is 0.03 against the sun's 10) and the exposure opens five
// stops (x32) to look at it. A lamp does not change with the time of day, so
// the same lamp that is a pale dot at noon glares at night, as it does to a
// camera. (The true gap between sun and moon is nearer twenty stops; five is
// what leaves the road readable on a screen.)
//
// Directions are unit vectors from the ground towards the light, in world
// space (+Y up).

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
 * @property {object} sky what the sky dome and the environment map are drawn from
 * @property {Rgb} sky.zenith straight up
 * @property {Rgb} sky.horizon at the horizon, away from the sun
 * @property {Rgb} sky.ground what the dome shows below the horizon (distant land, for reflections)
 * @property {number} sky.glow how much the sky brightens towards the sun or moon (times the light's colour)
 * @property {number} sky.discSize angular radius of the sun's or moon's disc, degrees
 * @property {number} sky.disc brightness of the disc (times the light's colour)
 * @property {number} sky.stars brightness of the stars (0: none)
 *
 * @property {object} ambient fill light from all round: the sky above, light bounced off the land below
 * @property {Rgb} ambient.sky
 * @property {Rgb} ambient.ground
 * @property {number} ambient.intensity
 *
 * @property {object} fog haze: the colour distance fades to, and how fast
 * @property {Rgb} fog.color
 * @property {number} fog.density per metre, at the level of the lake
 * @property {number} fog.heightFalloff per metre of height: how quickly the haze thins above the valleys
 *
 * @property {number} exposure under the open sky
 * @property {number} tunnelExposure inside the tunnel; the game eases between the two with track.sky
 *
 * @property {import('../../engine/FramePipeline.js').Look} look the grade of the finished picture
 *
 * @property {{ street: number, tunnel: number, windows: number }} lamps how far each kind of lamp is turned up, 0..1
 * @property {'drl'|'low'} carLights what a car's automatic lamps do under the open sky (in the tunnel: always low)
 */

const DEG = Math.PI / 180;

/** A unit vector from a compass bearing (0 = +Z, 90 = +X) and a height above the horizon, both in degrees. */
function towards(bearing, elevation) {
  const c = Math.cos(elevation * DEG);
  return [Math.sin(bearing * DEG) * c, Math.sin(elevation * DEG), Math.cos(bearing * DEG) * c];
}

/** @type {{ day: TimeOfDay, night: TimeOfDay }} */
export const TIMES = {
  // A clear afternoon late in the year: the sun 24 degrees up, warm, well to one side; long soft shadows.
  day: {
    name: 'day',
    sun: { dir: towards(125, 24), color: [1.0, 0.86, 0.68], intensity: 10 },
    sky: {
      zenith: [0.11, 0.25, 0.62],
      horizon: [0.78, 0.9, 1.05],
      ground: [0.16, 0.17, 0.15],
      glow: 0.9,
      discSize: 0.6,
      disc: 4000,
      stars: 0,
    },
    ambient: { sky: [0.5, 0.66, 1.0], ground: [0.42, 0.38, 0.3], intensity: 0.7 },
    fog: { color: [0.6, 0.72, 0.88], density: 0.0011, heightFalloff: 0.02 },
    exposure: 1,
    // about two and a half stops more inside, where only the lamps and the portals' daylight reach
    tunnelExposure: 5.6,
    look: { toe: 0.012, shoulder: 1.6, contrast: 1.08, saturation: 1.06, tint: [1.0, 0.99, 0.965], vignette: 0.22, grain: 0.6, bloom: 0.06 },
    lamps: { street: 0, tunnel: 1, windows: 0 },
    carLights: 'drl',
  },

  // A clear night under a three-quarter moon, high on the other side. The moon draws the ridges and the edges
  // of the road; everything else is lamps.
  night: {
    name: 'night',
    sun: { dir: towards(305, 58), color: [0.62, 0.76, 1.0], intensity: 0.03 },
    sky: {
      zenith: [0.0005, 0.001, 0.0026],
      horizon: [0.0016, 0.0023, 0.0042],
      ground: [0.0004, 0.0005, 0.0007],
      glow: 0.012,
      discSize: 0.7,
      disc: 2.5,
      stars: 0.05,
    },
    ambient: { sky: [0.4, 0.56, 1.0], ground: [0.2, 0.22, 0.28], intensity: 0.0035 },
    fog: { color: [0.0011, 0.0016, 0.003], density: 0.0013, heightFalloff: 0.02 },
    // five stops above day
    exposure: 32,
    // the lit tunnel is two stops brighter than the moonlit road outside
    tunnelExposure: 8,
    look: { toe: 0.03, shoulder: 1.5, contrast: 1.12, saturation: 0.94, tint: [0.95, 0.985, 1.05], vignette: 0.32, grain: 1.2, bloom: 0.1 },
    lamps: { street: 1, tunnel: 1, windows: 1 },
    carLights: 'low',
  },
};

export const TIME_NAMES = Object.keys(TIMES);
