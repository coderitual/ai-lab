// The numbers that decide how the scene looks and moves, in one place.
//
// These objects are live: World.js copies them into the shaders every frame,
// so changing a value (from code, or with __swan.set('look.exposure', 1.2) in
// the console) shows on the next frame. Colours are linear RGB, not sRGB, and
// may be brighter than 1.

/** The picture: light, lens and film. */
export const LOOK = {
  // Light. Compass degrees: 0 is north (-Z), 90 is east (+X). The default
  // camera looks north, so a sun a little east of north is behind the swan
  // and slightly to the right of the picture.
  sunAzimuth: 14,
  sunElevation: 32, // high enough that calm water never throws the sun at a low camera, and up-facing edges carry the widest rim
  // Nearly neutral on purpose: the warmth and the teal of the picture come
  // from the print curve (LOOK.print), which was measured from the film.
  sunColor: [4.2, 4.0, 3.6], // a white surface facing the sun; far over the exposure
  skyColor: [0.1, 0.2, 0.33], // blue light from the open sky behind the camera
  bounceColor: [0.012, 0.02, 0.014], // what comes back up from water and wood
  ambient: 0.012,
  // The shadow of the wood on the pond (lighting.js, sunReach): it begins
  // this many metres from the pond's centre toward the sun, with a soft edge
  // this wide, wandering by this much over this length.
  shadeStart: 1.6,
  shadeSoftness: 0.9,
  shadeWander: 0.5,
  shadeWanderLength: 2.9,

  // Lens
  aperture: 0.08, // 0..1: how far out of focus the background is (the film's is only a little: its lit leaves are dapples a few pixels across)
  bokehMax: 0.034, // blur disc radius at aperture 1, as a fraction of the picture height
  farClear: [0.0004, 0.0005, 0.0011], // what shows between the trees: nothing

  // Bloom
  bloomStrength: 0.22,
  bloomThreshold: 0.0, // only light brighter than this blooms (0: everything, as a lens does)...
  bloomKnee: 0.05, // ...fading in over this range below it
  bloomFirefly: 0.12, // 0: plain average; higher: single very bright pixels count less
  bloomTight: 0.55, // weight of the narrow glow
  bloomWide: 0.45, // weight of the wide veil
  bloomTint: [1.0, 1.0, 1.0], // colour of the wide veil (neutral: the print curve colours the glow)
  bloomRadius: 1.0,

  // Film
  exposure: 1.0,
  toe: 0.008, // larger: blacker blacks
  shoulder: 3.0, // 1 soft .. 3 hard roll-off into white (the film is linear up to about half of white)
  contrast: 1.0,
  print: 1.0, // 0 neutral .. 1 the measured grade of the film (PostChain.js, printCurve)
  // Extra split toning on top of the print; neutral by default.
  shadowTint: [1.0, 1.0, 1.0],
  highlightTint: [1.0, 1.0, 1.0],
  splitBalance: 0.3, // brightness (0..1, after the curve) where the two meet
  lift: [0.0, 0.0, 0.0], // extra colour of black (the print already lifts it)
  saturation: 1.0,
  vignette: 0.0, // the film has none
  vignetteStart: 0.25, // 0: darkening starts at the centre, 1: only in the corners
  fxaaSubpixel: 0.3, // 0..1: how much a single odd pixel (a speck) is softened by the edge smoothing
  fxaaThreshold: 0.12, // contrast, relative to the local brightness, below which edges are left alone
  grain: 0.0, // the film has none (only compression mottle); dither alone hides banding
  grainSize: 1.25, // in CSS pixels
  chroma: 0.0, // 0.002 is already visible

  // Water (assets/pond/Water.js)
  waterColor: [0.005, 0.0055, 0.009], // what is seen looking down into it where the sun does not reach
  waterSunColor: [0.006, 0.0065, 0.008], // added to that where it does
  waterLowAngle: 0.4, // exponent by which that colour fades as the view flattens, on top of what the mirror takes (measured)
  ambientRipple: 0.0075, // slope (root mean square) of the fine ripples on calm water
  agitatedRipple: 0.07, // slope they gain per unit of agitation (RippleField.js)
  mirrorTint: [0.93, 1.0, 0.79], // a reflection loses a little blue (measured)
  mirrorBase: 0.02, // share of light mirrored looking straight down
  mirrorRise: 2.6, // exponent of its rise toward grazing; 5 is the textbook, 2.6 gives the film's 0.57 at 10 to 13 degrees
  mirrorFarDistance: 14, // metres along a reflected ray to the surroundings
  mirrorSoftness: 0.3, // the mirror image of the surroundings is at least as soft as this aperture would make them
  glintStrength: 4.5, // the sun in the water, as a multiple of what sunColor alone would give
  glintCalm: 0.008, // roughness (spread of slopes) of calm water, the sun's own size included
  glintSteep: 1.2, // roughness added per unit of simulated slope
  glintSun: 0.2, // how far leaves and haze spread the sun (as a roughness): bounds how bright its own image in calm water is
  glintMax: 40, // brightest a glint may be
  // What floats on it (assets/pond/Specks.js)
  speckBrightness: 0.4, // the middle speck, in the sun
  speckShade: 0.04, // share of that left where the sun does not reach
  speckColor: [0.7, 0.76, 1.0], // cool white: the print warms it to the film's neutral
  leafColor: [0.26, 0.19, 0.11], // share of the sun a floating leaf lets through

  // The swan (assets/swan/). How its feathers take the light; shapes and sizes are in assets/swan/anatomy.js.
  swanAlbedo: [0.93, 0.92, 0.9], // white feather
  swanStain: [0.92, 0.86, 0.72], // head and upper neck, as stained as a mute swan's usually are
  swanFreePath: 0.034, // metres of plain feather that take red light down to 1/e (0.057 L)
  swanAbsorb: [1.0, 1.12, 1.4], // green and blue are taken faster than red by these factors: thin is cream, thicker a dimmer, slightly warmer cream (in the film the edge from cream to teal is pale olive, not amber)
  swanThrough: 0.32, // share of the light inside the plumage that leaves through a surface facing away from the sun
  swanWrap: 0.12, // how far direct sun creeps past the terminator on something this soft
  swanNeckDensity: 3.0, // the neck and head, relative to plain feather
  swanNeckThrough: 0.16, // the same share as swanThrough, for the neck and head: their feathering is close and dense
  swanNeckSky: 0.1, // share of the sky's light the neck and head get (the film's neck is olive inside, not teal)
  swanNeckAround: 0.0065, // share of the sun that gets round the neck and head in their down and out on the shadow side, however thick they are
  swanSkyAtWater: 0.5, // share of the sky's light that reaches the skin at the waterline...
  swanSkyHeight: 0.2, // ...rising to all of it this many metres up
  swanSkyTilt: [0.05, 0.27, 1.0, 0.45], // share of it on surfaces facing down, facing the horizon, tilted up; the tilt (normal's y) that gets it all
  swanFringe: 0.0036, // metres the down stands off the neck on a straight run (0.006 L)
  swanFringeBend: 2.2, // how much taller it stands on the outside of a tight bend
  swanBill: [0.8, 0.24, 0.035], // orange; black parts are fixed
};

/** The default view and what the camera may do. Angles as in OrbitRig.js. */
export const CAMERA = {
  // Measured from the reference film: the camera is about 5 m from the swan
  // and under a metre above the water (10 degrees), and an upright phone
  // picture spans about 37 degrees top to bottom (28 for a square of the same
  // area, see OrbitRig.js). Not a long lens: the pond is small.
  az: 0,
  el: 10,
  dist: 5,
  fov: 28,
  target: [0, 0.18, 0],
  // Where the swan sits in the picture (in half-pictures from the centre, y
  // up). Below the middle in both layouts: the wood needs the room above, and
  // the far bank should not sit on the picture's upper edge.
  offsetPortrait: [0.1, -0.24],
  offsetLandscape: [0.04, -0.44],
  near: 0.5,
  far: 400,
  limits: { minEl: 2, maxEl: 35, minDist: 2.2, maxDist: 9, minFov: 9, maxFov: 46, minHeight: 0.12 },
  drift: { az: 0.35, el: 0.12, period: 46 },
};

/** Time and water. */
export const SIM = {
  timeScale: 1, // the film plays in real time (measured from falling drops); below 1 is slow motion
  rippleExtent: 8, // metres of water round the swan that are simulated
  rippleSpeed: 0.42, // m/s
  rippleDamping: 0.35, // 1/s
};

/**
 * What each quality tier costs. `counts` are read by the assets.
 * Scales are relative to the scene target (which is the canvas times the
 * adaptive render scale).
 *
 * `pixelRatio` caps the canvas's device pixels per CSS pixel and `maxPixels`
 * its device pixels in all (Engine.js lowers the ratio to fit). The budgets
 * leave phones alone (430 x 932 at ratio 2 is 1.6 million) and a 2560 x 1440
 * desktop window at ratio 1 (3.7 million); they are there for tablets and
 * high-density desktop screens, where the ratio cap alone would allocate
 * half a gigabyte or more of multisampled half-float targets.
 */
export const TIERS = {
  low: {
    pixelRatio: 1.5,
    maxPixels: 1.2e6,
    msaa: 0,
    mirrorMsaa: 0,
    farScale: 0.4,
    farMirrorScale: 0.25,
    mirrorScale: 0.5,
    blurTaps: 12,
    blurFillTaps: 6,
    bloomLevels: 5,
    fxaaSteps: 5,
    rippleSize: 256,
    waterDetail: 0, // 0..2: how many ripple trains the water sums, and whether its mirror is read twice
    counts: { specks: 7000, leaves: 4800, trunks: 80, droplets: 192, featherDetail: 0 },
  },
  medium: {
    pixelRatio: 2,
    maxPixels: 2.2e6,
    msaa: 4,
    mirrorMsaa: 4,
    farScale: 0.5,
    farMirrorScale: 0.3,
    mirrorScale: 0.75,
    blurTaps: 16,
    blurFillTaps: 8,
    bloomLevels: 6,
    fxaaSteps: 7,
    rippleSize: 384,
    waterDetail: 1, // 0..2: how many ripple trains the water sums, and whether its mirror is read twice
    counts: { specks: 13000, leaves: 9000, trunks: 140, droplets: 384, featherDetail: 1 },
  },
  high: {
    pixelRatio: 2,
    maxPixels: 4e6,
    msaa: 4,
    mirrorMsaa: 4,
    farScale: 0.5,
    farMirrorScale: 0.4,
    mirrorScale: 1,
    blurTaps: 24,
    blurFillTaps: 10,
    bloomLevels: 7,
    fxaaSteps: 10,
    rippleSize: 512,
    waterDetail: 2, // 0..2: how many ripple trains the water sums, and whether its mirror is read twice
    counts: { specks: 16000, leaves: 13500, trunks: 220, droplets: 768, featherDetail: 2 },
  },
};
