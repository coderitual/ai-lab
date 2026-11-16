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
  sunColor: [9.0, 6.6, 3.4], // low warm sun, straight
  skyColor: [0.07, 0.145, 0.16], // cool light from the open sky behind the camera
  bounceColor: [0.012, 0.02, 0.014], // what comes back up from water and wood
  ambient: 0.012,

  // Lens
  aperture: 0.55, // 0..1: how far out of focus the background is
  bokehMax: 0.034, // blur disc radius at aperture 1, as a fraction of the picture height
  farClear: [0.002, 0.0036, 0.004], // what shows between the trees

  // Bloom
  bloomStrength: 0.9,
  bloomThreshold: 0.9, // only light brighter than this blooms...
  bloomKnee: 0.6, // ...fading in over this range below it
  bloomFirefly: 0.12, // 0: plain average; higher: single very bright pixels count less
  bloomTight: 0.55, // weight of the narrow glow
  bloomWide: 0.45, // weight of the wide veil
  bloomTint: [1.0, 0.82, 0.55], // colour of the wide veil
  bloomRadius: 1.0,

  // Film
  exposure: 1.0,
  toe: 0.02, // larger: blacker blacks
  shoulder: 1.5, // 1 soft .. 3 hard roll-off into white
  contrast: 1.08,
  shadowTint: [0.88, 1.0, 1.04], // teal
  highlightTint: [1.07, 1.0, 0.86], // gold
  splitBalance: 0.3, // brightness (0..1, after the curve) where the two meet
  lift: [0.0045, 0.0055, 0.0068], // colour of black
  saturation: 1.06,
  vignette: 0.42,
  vignetteStart: 0.25, // 0: darkening starts at the centre, 1: only in the corners
  fxaaSubpixel: 0.3, // 0..1: how much a single odd pixel (a speck) is softened by the edge smoothing
  fxaaThreshold: 0.12, // contrast, relative to the local brightness, below which edges are left alone
  grain: 0.035,
  grainSize: 1.25, // in CSS pixels
  chroma: 0.0, // 0.002 is already visible

  // Water
  waterColor: [0.0015, 0.004, 0.0045], // what is seen looking down into it
  ambientRipple: 0.007, // slope of the always-present tiny ripples
};

/** The default view and what the camera may do. Angles as in OrbitRig.js. */
export const CAMERA = {
  az: 0,
  el: 5.5,
  dist: 20,
  fov: 11.5,
  target: [0, 0.32, 0],
  // Where the swan sits in the picture (in half-pictures from the centre, y
  // up). Below the middle in both layouts: the wood needs the room above, and
  // the far bank should not sit on the picture's upper edge.
  offsetPortrait: [0, -0.16],
  offsetLandscape: [0, -0.16],
  near: 0.5,
  far: 400,
  limits: { minEl: 1.5, maxEl: 40, minDist: 5, maxDist: 45, minFov: 4, maxFov: 40, minHeight: 0.12 },
  drift: { az: 0.35, el: 0.12, period: 46 },
};

/** Time and water. */
export const SIM = {
  timeScale: 0.4, // the film is slow motion
  rippleExtent: 12, // metres of water round the swan that are simulated
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
