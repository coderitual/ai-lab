// What is drawn on the body, and what is cut out of it.
//
// The skin (skin.js) is one smooth surface. Glass, lamp lenses, shut lines,
// the grille and the intakes are flush with it on the real car, so they are
// not modelled: each is an outline here, given in the view in which it is
// true (the side, the top, the front, the rear), and atlas.js turns the
// outlines into a texture of distances over the skin that the shaders
// threshold. Numbers are from the modelling sheet (docs/car.md), left side;
// the right side is the mirror image unless a feature says otherwise.

/**
 * The wheel-arch openings: in side view a half ellipse (half-width `a`, height `b` above the wheel's centre at
 * `z`, `y`) standing on two upright edges that run `drop` below the centre to the body's lower edge. The hole is
 * cut through the body from x = `inner` outwards (the wheel housing's inner wall).
 */
export const ARCHES = {
  front: { z: 1.4325, y: 0.32, a: 0.385, b: 0.372, drop: 0.16, inner: 0.56 },
  rear: { z: -1.4325, y: 0.315, a: 0.39, b: 0.355, drop: 0.16, inner: 0.58 },
};
