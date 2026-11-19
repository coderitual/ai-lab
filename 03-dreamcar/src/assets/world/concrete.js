// (nearfield lane) Cast concrete, one look for every wall, parapet, pier and
// cutting beside the road: a finish added to a MeshStandardMaterial.
//
// The style is the trees' and the rock's: clear forms and a limited palette,
// not photographic grime. A wall is read as it streams past by its rhythm:
// panels at a regular pitch with a dark joint and a pale arris on one side of
// it, each panel its own shade (three steps, not noise); lifts of the
// formwork, faint board marks and rows of tie holes; a cap that is a lighter
// band with a dark drip line under it, and rain streaks hanging from the
// joints below it; a damp darker foot with moss in it; and, now and then, a
// drain outlet with a stain, a pair of bolt plates, a painted band, or a
// stencilled panel number (plain digits drawn as seven bars: no lettering).
//
// It needs to know where on the wall a point is: `vConc` = (metres along,
// metres up from the foot, metres down from the top, 2 when the three are
// known). Geometry built for it carries that as the attribute `aConc`; a
// material can instead work it out in its vertex shader (`vertex`). Where
// `vConc.w` is not 2 (parts that do not carry it), the world's axes stand in
// and the foot, the top and the decorations are left out.
//
// Everything finer than a few pixels fades to its average with distance
// (fwidth), so a wall at speed does not shimmer.

import { extend } from './shading.js';

/** The finish's numbers per kind of concrete (m; colours linear, multiplied onto the material's colour). */
export const CONCRETE = {
  /** the retaining walls and revetments at the tunnel, and the portals */
  wall: { panel: 4.5, lift: 1.5, ties: 0.75, cap: 0.32, band: [0.06, 0.16, 0.17], numbers: 1, drains: 0.25 },
  /** the bridges' parapets, edge beams and abutments */
  parapet: { panel: 3.0, lift: 0.9, ties: 0, cap: 0.12, band: null, numbers: 0, drains: 0.3 },
  /** the piers */
  pier: { panel: 0, lift: 2.4, ties: 0.6, cap: 0, band: null, numbers: 0, drains: 0 },
};

/**
 * @template {import('three').Material} T
 * @param {T} material
 * @param {{ key: string, kind?: keyof typeof CONCRETE, vertex?: string, varyings?: string, conc?: string }} options
 *   vertex: GLSL in the vertex shader after begin_vertex that sets `vConc` (default: from the attribute aConc);
 *   varyings: declared in both shaders, for `vertex` to set; conc: the fragment's vec4 (default `vConc`)
 * @returns {T}
 */
export function concreteFinish(material, { key, kind = 'wall', vertex = null, varyings = '', conc = 'vConc' }) {
  const k = CONCRETE[kind];
  const f = (v) => Number(v).toFixed(3);
  return extend(material, `concrete-${key}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${vertex ? '' : 'attribute vec4 aConc;'}\n${varyings}\nvarying vec4 vConc;\nvarying vec3 vConcWorld;\nvarying vec3 vConcN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${vertex ?? 'vConc = aConc;'}
#ifdef USE_INSTANCING
vConcWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vConcN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
#else
vConcWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vConcN = normalize( mat3( modelMatrix ) * objectNormal );
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}\n${CONCRETE_PARS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  const float PANEL = ${f(k.panel)};
  const float LIFT = ${f(k.lift)};
  const float TIES = ${f(k.ties)};
  const float CAP = ${f(k.cap)};
  diffuseColor.rgb *= concreteColour( diffuseColor.rgb, ${conc}, vConcWorld, normalize( vConcN ), PANEL, LIFT, TIES, CAP, ${k.band ? `vec3( ${k.band.map(f).join(', ')} )` : 'vec3( -1.0 )'}, ${k.numbers ? 'true' : 'false'}, ${f(k.drains)} );
}`,
      );
  });
}

const CONCRETE_PARS = /* glsl */ `
varying vec4 vConc;
varying vec3 vConcWorld;
varying vec3 vConcN;
float concHash( vec2 p ) {
  uvec2 q = uvec2( ivec2( floor( p ) ) );
  uint h = q.x * 0x27d4eb2du ^ ( q.y * 0x165667b1u + 0x9e3779b9u );
  h = ( h ^ ( h >> 15u ) ) * 0x2c1b3c6du;
  h = ( h ^ ( h >> 12u ) ) * 0x297a2d39u;
  h ^= h >> 15u;
  return float( h >> 8u ) / 16777216.0;
}
float concNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 u = fract( p );
  u = u * u * ( 3.0 - 2.0 * u );
  return mix( mix( concHash( i ), concHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( concHash( i + vec2( 0.0, 1.0 ) ), concHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// a box's coverage, antialiased: p inside [lo, hi]
float concBox( vec2 p, vec2 lo, vec2 hi, float aa ) {
  vec2 d = max( lo - p, p - hi );
  return 1.0 - smoothstep( -aa, aa, max( d.x, d.y ) );
}
// a digit in seven bars, in a box 1 wide and 2 tall (p from its bottom left)
float concDigit( vec2 p, int n, float aa ) {
  int bits = n == 0 ? 0x3F : n == 1 ? 0x06 : n == 2 ? 0x5B : n == 3 ? 0x4F : n == 4 ? 0x66 : n == 5 ? 0x6D : n == 6 ? 0x7D : n == 7 ? 0x07 : n == 8 ? 0x7F : 0x6F;
  float c = 0.0;
  if ( ( bits & 1 ) != 0 ) c = max( c, concBox( p, vec2( 0.1, 1.78 ), vec2( 0.9, 2.0 ), aa ) );
  if ( ( bits & 2 ) != 0 ) c = max( c, concBox( p, vec2( 0.78, 1.05 ), vec2( 1.0, 1.9 ), aa ) );
  if ( ( bits & 4 ) != 0 ) c = max( c, concBox( p, vec2( 0.78, 0.1 ), vec2( 1.0, 0.95 ), aa ) );
  if ( ( bits & 8 ) != 0 ) c = max( c, concBox( p, vec2( 0.1, 0.0 ), vec2( 0.9, 0.22 ), aa ) );
  if ( ( bits & 16 ) != 0 ) c = max( c, concBox( p, vec2( 0.0, 0.1 ), vec2( 0.22, 0.95 ), aa ) );
  if ( ( bits & 32 ) != 0 ) c = max( c, concBox( p, vec2( 0.0, 1.05 ), vec2( 0.22, 1.9 ), aa ) );
  if ( ( bits & 64 ) != 0 ) c = max( c, concBox( p, vec2( 0.1, 0.89 ), vec2( 0.9, 1.11 ), aa ) );
  return c;
}
vec3 concreteColour( vec3 base, vec4 c, vec3 p, vec3 n, float PANEL, float LIFT, float TIES, float CAP, vec3 band, bool numbers, float drains ) {
  bool laid = abs( c.w - 2.0 ) < 0.5;
  // where on the wall: along it and up it (the world's axes where the geometry does not say)
  float along = laid ? c.x : ( abs( n.x ) > abs( n.z ) ? p.z : p.x );
  float up = laid ? c.y : p.y;
  float down = laid ? c.z : 100.0;
  float top = step( 0.7, n.y );
  float px = max( fwidth( along ) + fwidth( up ), 1.0e-4 );
  float fine = 1.0 - smoothstep( 0.012, 0.05, px );
  float mid = 1.0 - smoothstep( 0.05, 0.2, px );
  vec3 col = vec3( 1.0 );
  // panels: each its own shade in three steps, a dark joint with a pale arris beside it
  float panel = PANEL > 0.0 ? floor( along / PANEL ) : 0.0;
  float fu = PANEL > 0.0 ? fract( along / PANEL ) * PANEL : 1.0;
  float ph = concHash( vec2( panel, 17.0 ) );
  col *= ph < 0.33 ? 0.9 : ph < 0.75 ? 1.0 : 1.08;
  if ( PANEL > 0.0 ) {
    float dj = min( fu, PANEL - fu );
    float joint = 1.0 - smoothstep( 0.02, 0.02 + px, dj );
    float arris = ( 1.0 - smoothstep( 0.05, 0.05 + px, fu - 0.02 ) ) * step( 0.02, fu );
    col *= 1.0 - 0.55 * joint * mid;
    col *= 1.0 + 0.18 * arris * mid;
  }
  // lifts of the formwork, board marks between them, tie holes in rows
  float fl = fract( up / LIFT ) * LIFT;
  float lift = 1.0 - smoothstep( 0.012, 0.012 + px, min( fl, LIFT - fl ) );
  col *= 1.0 - 0.28 * lift * mid;
  col *= 1.0 + 0.05 * fine * ( concHash( vec2( floor( up / 0.15 ), panel ) ) - 0.5 );
  if ( TIES > 0.0 ) {
    vec2 tq = vec2( ( along + 0.5 * TIES ) / TIES, ( up + 0.5 * TIES ) / TIES );
    vec2 tf = ( fract( tq ) - 0.5 ) * TIES;
    float r = length( tf );
    float hole = 1.0 - smoothstep( 0.022, 0.022 + px, r );
    float rim = ( 1.0 - smoothstep( 0.04, 0.04 + px, r ) ) - hole;
    col *= ( 1.0 - 0.6 * hole * fine ) * ( 1.0 + 0.12 * rim * fine );
  }
  // big soft patches of tone, and streaks of weathering hanging down, longest under the joints
  float blot = concNoise( vec2( along * 0.18, up * 0.25 ) );
  col *= 0.92 + 0.16 * blot;
  float streakX = concNoise( vec2( along * 2.3, 0.5 ) ) * concNoise( vec2( along * 0.41, 3.5 ) );
  if ( PANEL > 0.0 ) streakX = max( streakX, 1.0 - smoothstep( 0.0, 0.18, min( fu, PANEL - fu ) ) );
  if ( laid && top < 0.5 ) {
    // the cap: a paler band along the top, a dark drip line under it, streaks hanging below
    float cap = CAP > 0.0 ? 1.0 - smoothstep( CAP - px, CAP + px, down ) : 0.0;
    float drip = CAP > 0.0 ? ( 1.0 - smoothstep( 0.03, 0.03 + px, abs( down - CAP - 0.04 ) ) ) : 0.0;
    float hang = smoothstep( 0.35, 0.8, streakX ) * ( 1.0 - smoothstep( CAP, CAP + 1.2 + 1.6 * concNoise( vec2( along * 1.7, 9.0 ) ), down ) );
    col *= ( 1.0 + 0.22 * cap ) * ( 1.0 - 0.5 * drip * mid ) * ( 1.0 - 0.35 * hang * ( 1.0 - cap ) );
    // the foot: damp and dark, ragged, with moss in it
    float wet = 1.0 - smoothstep( 0.25, 0.45, up - 0.3 * concNoise( vec2( along * 0.9, 1.0 ) ) );
    col *= 1.0 - 0.38 * wet;
    float moss = wet * smoothstep( 0.55, 0.75, concNoise( vec2( along * 1.3, up * 3.0 ) ) );
    col = mix( col, col * vec3( 0.55, 0.75, 0.4 ), moss * 0.8 );
    float tall = up + down;
    if ( PANEL > 0.0 ) {
      float pc = fu - 0.5 * PANEL;
      // a painted band at hand height along the whole run
      if ( band.x >= 0.0 && tall > 2.2 ) {
        float b = concBox( vec2( 0.0, up ), vec2( -1.0, 1.05 ), vec2( 1.0, 1.3 ), px );
        float worn = smoothstep( 0.7, 0.85, concNoise( vec2( along * 3.0, up * 9.0 ) ) );
        col = mix( col, band / max( base, vec3( 0.05 ) ), b * ( 1.0 - 0.6 * worn ) * mid );
      }
      // a stencilled number on every panel of a tall wall, in its upper corner
      if ( numbers && tall > 3.0 ) {
        int num = int( mod( panel, 100.0 ) + 100.0 ) % 100;
        vec2 dq = vec2( fu - 0.35, down - CAP - 0.95 ) / 0.22;
        dq.y = -dq.y;
        dq.y += 2.0;
        float ink = concDigit( dq, num / 10, px / 0.22 ) + concDigit( dq - vec2( 1.45, 0.0 ), num % 10, px / 0.22 );
        col *= 1.0 - 0.7 * clamp( ink, 0.0, 1.0 ) * mid;
      }
      // a weep hole low in every panel of a tall wall, a dark stain run down from it to the foot
      if ( tall > 2.0 ) {
        float wr = length( vec2( pc - 0.6, up - 0.62 ) );
        float weep = 1.0 - smoothstep( 0.045, 0.045 + px, wr );
        float run = ( 1.0 - smoothstep( 0.05, 0.12 + 0.05 * blot, abs( pc - 0.6 ) ) ) * step( up, 0.62 ) * ( 0.5 + 0.5 * smoothstep( 0.0, 0.62, up ) );
        col *= ( 1.0 - 0.8 * weep * mid ) * ( 1.0 - 0.35 * run );
      }
      // now and then a drain outlet near the foot with its stain, or a pair of bolt plates
      float which = concHash( vec2( panel, 5.0 ) );
      if ( which < drains ) {
        float hole = concBox( vec2( pc, up ), vec2( -0.12, 0.28 ), vec2( 0.12, 0.46 ), px );
        float stain = concBox( vec2( pc, up ), vec2( -0.16 - 0.06 * blot, 0.0 ), vec2( 0.16 + 0.06 * blot, 0.3 ), 0.06 );
        col *= ( 1.0 - 0.85 * hole * mid ) * ( 1.0 - 0.35 * stain );
        col = mix( col, col * vec3( 1.1, 0.75, 0.5 ), 0.5 * stain );
      } else if ( which < drains + 0.15 && tall > 2.0 ) {
        float plates = concBox( vec2( abs( pc ) - 0.35, up - 1.6 ), vec2( -0.09 ), vec2( 0.09 ), px );
        col *= 1.0 + 0.3 * plates * fine;
        col = mix( col, col * vec3( 1.0, 0.8, 0.65 ), 0.4 * plates * fine );
      }
    }
  }
  // the tops: paler, worn
  col *= 1.0 + 0.18 * top;
  return col;
}
`;
