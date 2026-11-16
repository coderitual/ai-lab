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
  sunElevation: 20,
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
  aperture: 0.55, // 0..1: how far out of focus the background is
  bokehMax: 0.034, // blur disc radius at aperture 1, as a fraction of the picture height
  farClear: [0.002, 0.0036, 0.004], // what shows between the trees

  // Bloom
  bloomStrength: 0.1,
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

  // Water
  waterColor: [0.0015, 0.004, 0.0045], // what is seen looking down into it
  ambientRipple: 0.007, // slope of the always-present tiny ripples
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
  offsetPortrait: [0, -0.24],
  offsetLandscape: [0, -0.2],
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
 */
export const TIERS = {
  low: {
    pixelRatio: 1.5,
    msaa: 0,
    mirrorMsaa: 0,
    farScale: 0.4,
    farMirrorScale: 0.25,
    mirrorScale: 0.4,
    blurTaps: 12,
    blurFillTaps: 6,
    bloomLevels: 5,
    fxaaSteps: 5,
    rippleSize: 128,
    counts: { specks: 1500, leaves: 2500, trunks: 80, droplets: 192, featherDetail: 0 },
  },
  medium: {
    pixelRatio: 2,
    msaa: 4,
    mirrorMsaa: 4,
    farScale: 0.5,
    farMirrorScale: 0.3,
    mirrorScale: 0.5,
    blurTaps: 16,
    blurFillTaps: 8,
    bloomLevels: 6,
    fxaaSteps: 7,
    rippleSize: 256,
    counts: { specks: 3500, leaves: 5000, trunks: 140, droplets: 384, featherDetail: 1 },
  },
  high: {
    pixelRatio: 2,
    msaa: 4,
    mirrorMsaa: 4,
    farScale: 0.5,
    farMirrorScale: 0.4,
    mirrorScale: 0.6,
    blurTaps: 24,
    blurFillTaps: 10,
    bloomLevels: 7,
    fxaaSteps: 10,
    rippleSize: 512,
    counts: { specks: 7000, leaves: 9000, trunks: 220, droplets: 768, featherDetail: 2 },
  },
};
