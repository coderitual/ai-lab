// The town's houses: one material that draws a whole street front on plain
// boxes, and the writer that turns the plan's lots into those boxes.
//
// A wall is one quad. Everything on it is drawn by the fragment shader from
// the wall's own coordinates in metres (u along it, v up from the pavement)
// and a few numbers that ride on its vertices (its size, the heights of its
// floors, the width of a bay, its plaster, its seed):
//   - the grid of windows: openings with a stone surround, a sill, shutters,
//     and a REVEAL: the pane lies a hand's width behind the wall face, and
//     the line of sight is followed to it, so jambs and soffits show and move
//     as a real recess does;
//   - behind every lit pane a ROOM (interior mapping): the line of sight is
//     carried on into a box with a back wall, side walls, a floor and a
//     ceiling, a lamp hanging in it, something dark standing on the floor, a
//     door, shelves or a picture on the back wall, a blind part of the way
//     down, curtains: all different from window to window, from a hash of
//     the house's seed, the floor and the bay. Which windows are lit is the
//     same hash against the share the time of day asks for (lighting.js
//     lamps.windows); an unlit pane is dark glass that mirrors the sky;
//   - ground floors: shop windows with a lit fascia panel and a door, an
//     arcade (a recess three metres deep with lanterns and shop fronts at its
//     back, by the same walk into a box), a hotel's glazed arches, plain
//     doors and windows;
//   - the wall itself: plaster, ashlar or brick with their joints, tone that
//     wanders, dark runs under the sills and from the eaves, a wet band at
//     the foot, string courses, quoins, the wash of the house's own lanterns.
// Roofs, chimneys, cornices, balconies, awnings and the cafe's canopy are
// real geometry in the same mesh and the same material: a number per surface
// (`kind`) picks tiles, plain masonry, cloth, metal, railings or a lit strip.
//
// Three things keep it honest and cheap:
//   - no texture but one small noise map: nothing tiles, and no two windows
//     are the same picture;
//   - everything finer than a pixel fades to its average (joints, louvres,
//     glazing bars, tiles), so the street does not shimmer at a distance;
//   - the wet road's mirror and the cars' reflection probes get the short
//     version (lit panes as plain warm panels): they are small and blurred.
//     So does the low tier.

import * as THREE from 'three';
import { GLSL_HASH } from '../../engine/glsl.js';
import { fieldTexture, valueField, worleyField } from '../../engine/noise.js';
import { extend } from './shading.js';

/** Surface kinds (aB.z). */
export const KIND = { FACADE: 0, WALL: 1, TILES: 2, SOLID: 3, AWNING: 4, METAL: 5, RAILING: 6, LIT: 7, GLASS: 8 };
/** Ground floors (aD.w). */
export const GROUND = { plain: 0, shops: 1, arcade: 2, lobby: 3, church: 4, glass: 5 };
/** Radiance of a lit room's walls at one unit of its lamp's light (scene units, see lighting.js). */
const ROOM_RADIANCE = 0.085;
/** How far the pane lies behind the wall face (m): upper windows, shop windows. */
const REVEAL = 0.22;
/** The share of shop fronts that are lit when the shops are (a fixed set: the paving's baked light knows them). */
export const SHOPS_LIT = 0.74;

/** The shader's integer hash, bit for bit, for whatever the CPU has to agree with it about. */
const hashU = (x) => {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
};
/** hash13 of the shader: three whole numbers to 0..1. */
export const hash3 = (a, b, c) => (hashU((a ^ hashU((b ^ hashU(c)) >>> 0)) >>> 0) >>> 8) / 16777216;

/** The bays of a wall as the shader lays them out: how many, how wide. */
export function baysOf(width, margin, bay) {
  const usable = Math.max(0.5, width - 2 * margin);
  const count = Math.max(1, Math.floor(usable / bay + 0.5));
  return { count, width: usable / count };
}
/** The shop bays of a ground floor: wider than the windows above. */
export function shopBaysOf(width, margin, bay) {
  return baysOf(width, margin, bay * 1.75);
}

const FACADE_PARS = /* glsl */ `
${GLSL_HASH}
uniform sampler2D uFNoise;
uniform vec4 uFLit;   // share of windows lit, radiance of a lit room, shops 0..1, lanterns 0..1
uniform vec2 uFWet;   // how wet the town is, unused
flat varying vec4 vFA; // wall width, top of the floors, ground floor height, floor height
flat varying vec4 vFB; // bay width, margin, kind, flags
flat varying vec4 vFC; // wall colour, material + age
flat varying vec4 vFD; // trim colour, ground floor type
flat varying vec4 vFE; // seed, window width, height, sill
flat varying vec4 vFF; // shutter colour, lantern height
varying vec3 vFUv;     // u, v on the wall (m); 1 in the view itself, 0 in a mirror or a reflection probe

vec3 fcAlbedo; vec3 fcEmit; vec2 fcTilt; float fcRough; float fcMetal; float fcAO;

float fBit( float flags, float bit ) { return mod( floor( flags / bit ), 2.0 ); }
float fBox( vec2 q, vec2 h ) { vec2 d = abs( q ) - h; return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ); }
// signed distance to an opening centred on the origin, half size h; arch: its head is a half circle
float fOpening( vec2 q, vec2 h, float arch ) {
  if ( arch > 0.5 && q.y > h.y - h.x ) return length( q - vec2( 0.0, h.y - h.x ) ) - h.x;
  return fBox( q, h );
}

#ifndef FACADE_SIMPLE
// A lit room behind a pane. The line of sight enters at o (across from the room's middle, above its floor) heading
// d (z into the house); the room is size.x wide, size.y high, size.z deep. Radiance relative to its lamp's light.
vec3 fRoom( vec2 o, vec3 d, vec3 size, vec4 rnd, float shop ) {
  d.z = max( d.z, 0.06 );
  vec3 lim = vec3( 0.5 * size.x, size.y, size.z );
  float tx = ( ( d.x > 0.0 ? lim.x : -lim.x ) - o.x ) / ( abs( d.x ) > 1.0e-4 ? d.x : 1.0e-4 );
  float ty = ( ( d.y > 0.0 ? lim.y : 0.0 ) - o.y ) / ( abs( d.y ) > 1.0e-4 ? d.y : 1.0e-4 );
  float tz = lim.z / d.z;
  float t = min( tz, min( tx, ty ) );
  vec3 h = vec3( o, 0.0 ) + d * t;
  vec3 lamp = vec3( ( rnd.x - 0.5 ) * 0.5 * size.x, size.y - 0.55, size.z * ( 0.35 + 0.3 * rnd.y ) );
  // warm white walls; now and then a cooler room
  vec3 wallTone = mix( vec3( 0.66, 0.58, 0.48 ), vec3( 0.5, 0.58, 0.62 ), rnd.z * rnd.z * rnd.z );
  vec3 col = wallTone * 0.9;
  if ( t == tz ) {
    col = wallTone;
    vec2 q = vec2( h.x / lim.x, h.y / size.y );
    float pick = rnd.w * 3.0 + shop * 9.0;
    if ( pick < 1.0 ) {
      // a door standing open on a dark hall
      float door = step( abs( q.x - ( rnd.x - 0.5 ) ), 0.26 ) * step( q.y, 0.8 );
      col = mix( col, vec3( 0.13, 0.08, 0.05 ), door );
    } else if ( pick < 2.0 || shop > 0.5 ) {
      // shelves: rows of things of every colour
      float on = step( abs( q.x + 0.3 * ( rnd.y - 0.5 ) ), 0.62 + 0.3 * shop ) * step( 0.1, q.y ) * step( q.y, 0.82 );
      float rows = step( 0.22, fract( q.y * ( 5.0 + 2.0 * shop ) ) );
      vec3 things = 0.2 + 0.6 * hash33( vec3( floor( q.x * ( 9.0 + 9.0 * shop ) ), floor( q.y * ( 5.0 + 2.0 * shop ) ), rnd.z * 50.0 ) );
      col = mix( col, mix( vec3( 0.1, 0.07, 0.05 ), things * 0.7, rows ), on );
    } else {
      // a picture
      float pic = step( abs( q.x - 0.4 * ( rnd.x - 0.5 ) ), 0.3 ) * step( abs( q.y - 0.6 ), 0.14 );
      col = mix( col, vec3( 0.18, 0.24, 0.3 ) + 0.25 * rnd.xyz, pic );
    }
  } else if ( t == ty ) {
    col = d.y > 0.0 ? vec3( 0.8 ) : mix( vec3( 0.2, 0.13, 0.08 ), vec3( 0.3, 0.28, 0.26 ), rnd.y );
  }
  vec3 toLamp = h - lamp;
  float light = 0.2 + 1.5 / ( 0.6 + dot( toLamp, toLamp ) );
  // something dark on the floor part of the way in: a sofa's back, a table, a counter
  float tf = ( size.z * 0.5 ) / d.z;
  if ( tf < t ) {
    vec2 f = o + d.xy * tf;
    if ( abs( f.x - ( rnd.z - 0.5 ) * size.x * 0.5 ) < 0.9 + shop && f.y < 0.7 + 0.35 * rnd.w ) {
      col = mix( vec3( 0.1, 0.07, 0.06 ), vec3( 0.16, 0.11, 0.13 ), rnd.x );
      light *= 0.8;
    }
  }
  vec3 seen = col * light;
  // the lamp itself, where the line of sight passes it
  float tl = clamp( dot( lamp - vec3( o, 0.0 ), d ), 0.0, t );
  seen += vec3( 7.0 ) * ( 1.0 - smoothstep( 0.1, 0.24, length( vec3( o, 0.0 ) + d * tl - lamp ) ) );
  return seen;
}
#endif
`;

const FACADE_COLOR = /* glsl */ `
{
  vec2 fp = vFUv.xy;
  float fKind = floor( vFB.z + 0.5 );
  float fSeed = vFE.x;
  float fPx = max( fwidth( fp.x ), fwidth( fp.y ) ) + 1.0e-5;
  float fAa = fPx * 0.75;
  vec2 fOff = vec2( fSeed * 0.137, fSeed * 0.291 );
  vec4 fNa = texture2D( uFNoise, fp / 6.1 + fOff );
  vec4 fNb = texture2D( uFNoise, fp / 0.83 + fOff.yx );
  vec4 fNc = texture2D( uFNoise, vec2( fp.x / 1.9, fp.y / 27.0 ) + fOff );
  vec3 fNw = inverseTransformDirection( normalize( vNormal ), viewMatrix );
  vec3 fTw = normalize( vec3( fNw.z, 0.0, -fNw.x ) + vec3( 1.0e-4, 0.0, 0.0 ) );
  vec3 fBw = cross( fNw, fTw );
  vec3 fRayW = normalize( ( vec4( -vViewPosition, 0.0 ) * viewMatrix ).xyz );
  vec3 fRay = vec3( dot( fRayW, fTw ), dot( fRayW, fBw ), max( -dot( fRayW, fNw ), 0.03 ) );
  float fNear = vFUv.z * ( 1.0 - smoothstep( 0.035, 0.075, fPx ) );   // 1: worth the full walk into the rooms

  vec3 wallCol = vFC.rgb;
  float fMat = floor( vFC.a + 0.001 );
  float fAge = fract( vFC.a ) / 0.98;
  vec3 trimCol = vFD.rgb;
  fcTilt = vec2( 0.0 );
  fcEmit = vec3( 0.0 );
  fcMetal = 0.0;
  fcAO = 1.0;
  fcRough = 0.9;

  // ---- the wall's own surface: tone that wanders, runs from the top, the material's joints
  vec3 col = wallCol * ( 0.84 + 0.3 * fNa.r ) * ( 0.95 + 0.1 * fNb.b );
  col *= 1.0 - fAge * 0.38 * smoothstep( 0.42, 0.8, fNc.g );
  if ( fMat > 1.5 ) {
    // brick: courses of 7.5 cm, lost in their average beyond a few metres
    float course = floor( fp.y / 0.075 );
    vec2 b = vec2( fp.x / 0.25 + 0.5 * mod( course, 2.0 ), fp.y / 0.075 );
    vec2 f = fract( b );
    float fade = 1.0 - smoothstep( 0.008, 0.03, fPx );
    col *= mix( 1.0, 0.78 + 0.44 * hash12( floor( b ) + fSeed ), 0.35 + 0.65 * fade );
    vec2 e = min( f, 1.0 - f ) * vec2( 0.25, 0.075 );
    float joint = ( 1.0 - smoothstep( 0.005, 0.005 + fAa, min( e.x, e.y ) ) ) * fade;
    col = mix( col, vec3( 0.34, 0.32, 0.29 ) * ( 0.8 + 0.4 * fNb.r ), joint * 0.85 );
  } else if ( fMat > 0.5 ) {
    // ashlar: courses of 36 cm, blocks of different lengths and tones, joints with a bevel
    float course = floor( fp.y / 0.36 );
    vec2 b = vec2( fp.x / 0.84 + 0.37 * mod( course, 2.0 ) + 0.3 * hash11( course + fSeed ), fp.y / 0.36 );
    vec2 f = fract( b );
    float fade = 1.0 - smoothstep( 0.012, 0.05, fPx );
    col *= mix( 1.0, 0.82 + 0.36 * hash12( floor( b ) + fSeed ), 0.4 + 0.6 * fade );
    vec2 e = min( f, 1.0 - f ) * vec2( 0.84, 0.36 );
    float joint = ( 1.0 - smoothstep( 0.008, 0.008 + fAa, min( e.x, e.y ) ) ) * fade;
    col *= 1.0 - 0.45 * joint;
    vec2 edge = vec2( e.x < e.y ? sign( f.x - 0.5 ) : 0.0, e.x < e.y ? 0.0 : sign( f.y - 0.5 ) );
    fcTilt += edge * 0.5 * ( 1.0 - smoothstep( 0.0, 0.03, min( e.x, e.y ) ) ) * fade;
    fcRough = 0.82;
  } else {
    // plaster: a fine grain, patches where it has been made good
    col *= 1.0 + 0.08 * ( fNb.g - 0.5 );
    col = mix( col, col * 1.12 + 0.02, fAge * smoothstep( 0.72, 0.78, fNa.b ) * 0.6 );
    fcTilt += ( fNb.rg - 0.5 ) * 0.12 * ( 1.0 - smoothstep( 0.01, 0.04, fPx ) );
  }
  fcAlbedo = col;

  if ( fKind < 0.5 ) {
    // ================================================================ a house front
    float W = vFA.x;
    float top = vFA.y;
    float gH = vFA.z;
    float fH = vFA.w;
    float margin = vFB.y;
    float usable = max( 0.5, W - 2.0 * margin );
    float nBays = max( 1.0, floor( usable / vFB.x + 0.5 ) );
    float bw = usable / nBays;
    float flags = vFB.w;
    float fArch = fBit( flags, 1.0 );
    float fShut = fBit( flags, 2.0 );
    float fSurr = fBit( flags, 4.0 );
    float fRail = fBit( flags, 8.0 );
    float fStr = fBit( flags, 16.0 );
    float fQuoin = fBit( flags, 32.0 );
    float fTower = fBit( flags, 64.0 );
    float gType = floor( vFD.w + 0.5 );
    bool inWidth = fp.x > margin && fp.x < W - margin;

    // quoins at the corners, string courses at the floors, a frieze under the eaves, a stone base
    float trim = 0.0;
    if ( fQuoin > 0.5 ) {
      float qRow = floor( fp.y / 0.42 );
      float qLen = 0.34 + 0.16 * mod( qRow, 2.0 );
      float q = max( step( fp.x, qLen ), step( W - qLen, fp.x ) ) * step( 0.0, fp.y );
      float qj = 1.0 - smoothstep( 0.012, 0.012 + fAa, abs( fract( fp.y / 0.42 ) - 0.5 ) * 0.84 - 0.2 + 0.2 );
      trim = max( trim, q );
    }
    float above = fp.y - gH;
    float fi = floor( above / fH );
    float fy = above - fi * fH;
    if ( fStr > 0.5 && fp.y > gH - 0.16 && fp.y < top + 0.01 ) {
      float band = 1.0 - smoothstep( 0.09, 0.09 + fAa, abs( fy - 0.02 ) );
      // (the band at the ground floor's head is taller: the shop fronts' cornice)
      band = max( band, 1.0 - smoothstep( 0.14, 0.14 + fAa, abs( fp.y - gH ) ) );
      trim = max( trim, band );
      // a line of shade under each band
      fcAO *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.16, fy - 0.11 ) ) * step( 0.11, fy ) * step( fy, 0.4 );
    }
    if ( fp.y > top ) trim = max( trim, fStr * ( 1.0 - smoothstep( 0.0, fAa, abs( fp.y - top - 0.2 ) - 0.16 ) ) );
    float base = ( 1.0 - smoothstep( 0.42, 0.42 + fAa, fp.y ) );
    fcAlbedo = mix( fcAlbedo, trimCol * ( 0.85 + 0.3 * fNa.g ), trim );
    fcAlbedo = mix( fcAlbedo, vec3( 0.2, 0.2, 0.2 ) * ( 0.7 + 0.6 * fNb.r ), base );
    fcRough = mix( fcRough, 0.8, max( trim, base ) );
    // shade under the eaves
    fcAO *= 0.62 + 0.38 * smoothstep( 0.0, 1.1, top + 0.9 - fp.y );

    // ---- the opening this point belongs to: half size, middle, how deep its pane lies, what it is
    vec2 oMid = vec2( 0.0 );
    vec2 oHalf = vec2( -1.0 );
    float oArch = 0.0;
    float oDeep = ${REVEAL.toFixed(2)};
    float oType = 0.0; // 1 window, 2 shop window, 3 door, 4 arcade bay, 5 lobby arch, 6 belfry
    float bayId = 0.0;
    float floorId = fi;
    float lx = 0.0;
    float cellW = bw;
    if ( inWidth && fp.y >= gH && fp.y < top ) {
      float bx = ( fp.x - margin ) / bw;
      bayId = floor( bx );
      lx = ( fract( bx ) - 0.5 ) * bw;
      oMid = vec2( 0.0, vFE.w + 0.5 * vFE.z );
      oHalf = 0.5 * vFE.yz;
      oArch = fArch;
      oType = 1.0;
      if ( fTower > 0.5 && fi > ( top - gH ) / fH - 1.5 ) {
        // the belfry: one tall open arch a side
        oHalf = vec2( 0.95, 1.5 );
        oMid = vec2( 0.0, 0.75 + 1.5 );
        oArch = 1.0;
        oDeep = 0.7;
        oType = 6.0;
      }
      oMid.y += fi * fH + gH;
    } else if ( inWidth && fp.y >= 0.0 && fp.y < gH ) {
      floorId = -1.0;
      if ( gType < 0.5 || gType > 3.5 && gType < 4.5 ) {
        // plain: the windows of the floors above come down, and one bay is the door (the church: a portal)
        float bx = ( fp.x - margin ) / bw;
        bayId = floor( bx );
        lx = ( fract( bx ) - 0.5 ) * bw;
        float doorBay = floor( hash12( vec2( fSeed, 3.0 ) ) * nBays );
        if ( gType > 3.5 ) doorBay = floor( nBays * 0.5 );
        if ( abs( bayId - doorBay ) < 0.5 ) {
          oHalf = gType > 3.5 ? vec2( 1.25, 2.2 ) : vec2( 0.62, 1.2 );
          oMid = vec2( 0.0, oHalf.y + 0.02 );
          oArch = gType > 3.5 ? 1.0 : fArch;
          oType = 3.0;
        } else if ( gType < 0.5 ) {
          oHalf = vec2( 0.5 * vFE.y, min( 0.5 * vFE.z, 0.5 * ( gH - 1.95 ) ) );
          oMid = vec2( 0.0, 1.15 + oHalf.y );
          oArch = fArch;
          oType = 1.0;
        }
      } else if ( gType < 1.5 || gType > 4.5 ) {
        // shops (and the pavilion's glass all round): wide bays, one of them the house door
        float nShops = gType > 4.5 ? nBays : max( 1.0, floor( usable / ( vFB.x * 1.75 ) + 0.5 ) );
        cellW = usable / nShops;
        float bx = ( fp.x - margin ) / cellW;
        bayId = floor( bx );
        lx = ( fract( bx ) - 0.5 ) * cellW;
        float doorBay = floor( hash12( vec2( fSeed, 5.0 ) ) * nShops );
        if ( gType < 1.5 && nShops > 1.5 && abs( bayId - doorBay ) < 0.5 ) {
          oHalf = vec2( 0.7, 1.3 );
          oMid = vec2( 0.0, 1.32 );
          oType = 3.0;
        } else {
          float pier = gType > 4.5 ? 0.07 : 0.32;
          float foot = gType > 4.5 ? 0.12 : 0.5;
          float head = gType > 4.5 ? gH - 0.12 : gH - 0.95;
          oHalf = vec2( 0.5 * cellW - pier, 0.5 * ( head - foot ) );
          oMid = vec2( 0.0, 0.5 * ( head + foot ) );
          oDeep = 0.14;
          oType = 2.0;
        }
      } else {
        // an arcade (and the grand hotel's lobby): an arch to every bay
        float bx = ( fp.x - margin ) / bw;
        bayId = floor( bx );
        lx = ( fract( bx ) - 0.5 ) * bw;
        oHalf = vec2( 0.5 * bw - 0.36, 0.5 * ( gH - 0.75 ) );
        oMid = vec2( 0.0, oHalf.y );
        oArch = 1.0;
        oDeep = gType > 2.5 ? 0.3 : 0.45;
        oType = gType > 2.5 ? 5.0 : 4.0;
      }
    }
    vec4 rnd = hash33( vec3( fSeed, floorId + 2.0, bayId ) ).xyzx;
    rnd.w = hash13( vec3( bayId, fSeed, floorId + 9.0 ) );

    if ( oType > 0.5 ) {
      vec2 q = vec2( lx, fp.y ) - oMid;
      float sd = fOpening( q, oHalf, oArch );
      if ( sd > 0.0 ) {
        // ---- on the wall round the opening: surround, sill, shutters, the runs under the sill
        if ( oType < 1.5 || oType > 5.5 ) {
          float sill = step( abs( q.x ), oHalf.x + 0.13 ) * ( 1.0 - smoothstep( 0.0, fAa, abs( q.y + oHalf.y + 0.05 ) - 0.05 ) );
          float surround = fSurr * ( 1.0 - smoothstep( 0.11, 0.11 + fAa, sd ) );
          // a keystone and a small cornice over the grander windows
          surround = max( surround, fSurr * fArch * step( abs( q.x ), 0.12 ) * step( sd, 0.2 ) * step( 0.0, q.y ) );
          float stone = max( sill, surround );
          fcAlbedo = mix( fcAlbedo, trimCol * ( 0.9 + 0.2 * fNa.g ), stone );
          fcRough = mix( fcRough, 0.78, stone );
          fcTilt += normalize( q + 1.0e-4 ) * 0.5 * surround * smoothstep( 0.07, 0.11, sd );
          // the shade a sill throws, and the dirt the rain carries down from its ends
          float under = -( q.y + oHalf.y + 0.1 );
          if ( under > 0.0 ) {
            fcAO *= 1.0 - 0.35 * step( abs( q.x ), oHalf.x + 0.13 ) * ( 1.0 - smoothstep( 0.0, 0.14, under ) );
            float ends = exp( -pow( ( abs( q.x ) - oHalf.x - 0.06 ) / 0.11, 2.0 ) ) + 0.35 * smoothstep( 0.4, 0.7, fNc.r ) * step( abs( q.x ), oHalf.x + 0.1 );
            fcAlbedo *= 1.0 - ( 0.2 + 0.4 * fAge ) * ends * exp( -under / ( 0.5 + 1.1 * fNa.a ) ) * ( 1.0 - stone );
          }
          // shutters folded back against the wall, louvred
          if ( fShut > 0.5 && oType < 1.5 ) {
            float sx = abs( q.x ) - oHalf.x - 0.04;
            float open = step( 0.14, rnd.y );
            float leaf = open * ( 1.0 - smoothstep( 0.0, fAa, abs( sx - 0.5 * oHalf.x ) - 0.5 * oHalf.x ) ) * ( 1.0 - smoothstep( 0.0, fAa, abs( q.y ) - oHalf.y ) );
            float louvre = fract( q.y / 0.055 );
            float seen = 1.0 - smoothstep( 0.008, 0.03, fPx );
            vec3 leafCol = vFF.rgb * ( 0.8 + 0.4 * fNa.b ) * mix( 0.85, 0.62 + 0.5 * louvre, seen );
            // the frame of each leaf
            leafCol *= 1.0 - 0.25 * seen * step( 0.5 * oHalf.x - 0.06, abs( sx - 0.5 * oHalf.x ) );
            fcAlbedo = mix( fcAlbedo, leafCol, leaf );
            fcRough = mix( fcRough, 0.6, leaf );
            fcTilt.y += leaf * seen * ( louvre - 0.5 ) * 0.9;
            // and the shade they throw on the wall beside them
            fcAO *= 1.0 - 0.25 * open * ( 1.0 - leaf ) * ( 1.0 - smoothstep( 0.0, 0.1, sx - oHalf.x ) ) * step( oHalf.x, sx ) * step( abs( q.y ), oHalf.y );
          }
        } else if ( oType < 2.5 && gType < 4.5 ) {
          // over a shop window: the fascia, on some shops a lit panel (a plain glowing board)
          float fy2 = fp.y - ( oMid.y + oHalf.y );
          float board = step( abs( q.x ), oHalf.x - 0.05 ) * ( 1.0 - smoothstep( 0.0, fAa, abs( fy2 - 0.36 ) - 0.2 ) );
          float lit = step( rnd.x, ${SHOPS_LIT.toFixed(2)} ) * step( 0.45, rnd.z );
          vec3 hue = mix( vec3( 1.0, 0.62, 0.3 ), mix( vec3( 1.0, 0.25, 0.12 ), vec3( 0.55, 0.85, 1.0 ), step( 0.6, rnd.w ) ), step( 0.72, rnd.y ) );
          fcAlbedo = mix( fcAlbedo, mix( vFF.rgb, vec3( 0.03 ), lit ), board );
          fcEmit += board * lit * uFLit.z * hue * ( 0.5 + 0.2 * fNb.r );
          // the stall riser under the pane
          float riser = step( abs( q.x ), oHalf.x ) * step( fp.y, oMid.y - oHalf.y ) * step( 0.42, fp.y );
          fcAlbedo = mix( fcAlbedo, vFF.rgb * 0.8, riser );
        }
        // every opening takes a little sky away from the wall beside it
        fcAO *= 1.0 - 0.18 * ( 1.0 - smoothstep( 0.0, 0.25, sd ) );
      } else {
        // ---- inside the opening: follow the line of sight to the pane (or, in an arcade, straight on)
        vec2 slip = fRay.xy / fRay.z;
        vec2 qg = q + slip * oDeep * vFUv.z;
        float sdg = fOpening( qg, oHalf, oArch );
        vec2 cell = vec2( lx, fp.y ) + slip * oDeep * vFUv.z;
        float lamps = max( uFLit.w, 0.0 );
        if ( oType > 3.5 && oType < 4.5 ) {
          // an arcade: three metres of paving under a ceiling with a lantern to every bay, shop fronts at the back
          vec3 d = fRay;
          vec2 o = vec2( lx, fp.y );
          float hc = gH - 0.35;
          float D = 3.2;
          float ty = ( ( d.y > 0.0 ? hc : 0.0 ) - o.y ) / ( abs( d.y ) > 1.0e-4 ? d.y : 1.0e-4 );
          float tz = D / d.z;
          float t = min( ty, tz );
          vec3 h = vec3( o, 0.0 ) + d * t;
          float gx = bayId * bw + h.x + 0.5 * bw;
          float ax = ( fract( gx / bw ) - 0.5 ) * bw;
          vec3 toLamp = vec3( ax, h.y - ( hc - 0.45 ), h.z - 1.5 );
          float light = 0.9 / ( 0.5 + dot( toLamp, toLamp ) );
          vec3 surf = wallCol * 0.9;
          vec3 glow = vec3( 0.0 );
          if ( t == tz ) {
            float bay2 = floor( gx / bw );
            vec4 r2 = hash33( vec3( fSeed + 31.0, bay2, 4.0 ) ).xyzx;
            vec2 w = vec2( abs( ax ) - ( 0.5 * bw - 0.55 ), abs( h.y - 1.65 ) - 1.2 );
            float pane = step( max( w.x, w.y ), 0.0 );
            float shopLit = step( r2.x, ${SHOPS_LIT.toFixed(2)} ) * uFLit.z;
            surf = mix( surf, vec3( 0.03 ), pane );
            // the lit shop behind its pane: shelves and a warm wall, flat
            vec3 inside = mix( vec3( 0.55, 0.45, 0.33 ), 0.25 + 0.6 * hash33( vec3( floor( gx * 3.0 ), floor( h.y * 2.6 ), fSeed ) ), 0.5 * step( 0.3, fract( h.y * 2.6 ) ) );
            glow = pane * shopLit * inside * ( 1.3 + 0.9 * r2.y ) * uFLit.y * vec3( 1.0, 0.8, 0.56 );
          } else if ( d.y < 0.0 ) {
            // the paving, lit by the shops as well
            vec2 slab = fract( vec2( gx, h.z ) / vec2( 0.6, 0.4 ) );
            surf = vec3( 0.2, 0.19, 0.18 ) * ( 0.85 + 0.15 * step( 0.04, min( slab.x, slab.y ) ) );
            light += 0.25 * uFLit.z / ( 0.6 + ( D - h.z ) * ( D - h.z ) );
          } else surf = vec3( 0.7, 0.67, 0.6 );
          vec3 lampHue = vec3( 1.0, 0.72, 0.42 );
          fcEmit += ( surf * light * lamps * 1.4 * uFLit.y / ${ROOM_RADIANCE.toFixed(3)} * 0.06 * lampHue + glow );
          // the lantern itself
          float tl = clamp( dot( vec3( -lx, hc - 0.45 - fp.y, 1.5 ), d ), 0.0, t );
          vec3 c = vec3( lx, fp.y, 0.0 ) + d * tl - vec3( 0.0, hc - 0.45, 1.5 );
          fcEmit += lamps * lampHue * 14.0 * uFLit.y * ( 1.0 - smoothstep( 0.09, 0.2, length( c ) ) );
          // the sky's own light dies away under the arcade's ceiling
          fcAlbedo = surf;
          fcAO *= 0.12 + 0.5 * ( 1.0 - smoothstep( 0.0, 2.0, h.z ) );
          fcRough = 0.85;
        } else if ( sdg > 0.0 ) {
          // the reveal: jamb, soffit and sill of the recess, in the wall's own stuff, turned away from the sky
          fcAlbedo = mix( wallCol, trimCol, fSurr ) * 0.9;
          fcAO *= 0.42;
          fcRough = 0.85;
        } else if ( oType > 5.5 ) {
          // the belfry stands open: darkness, and the far arch's sky
          fcAlbedo = vec3( 0.012 );
          fcAO *= 0.3;
        } else if ( oType > 2.5 && oType < 3.5 ) {
          // a door: panelled wood, a fanlight over it
          vec2 dq = cell - vec2( 0.0, oMid.y );
          float fan = step( oHalf.y - 0.5, dq.y ) * step( gType, 3.5 );
          vec2 panel = abs( fract( vec2( dq.x / ( oHalf.x + 0.001 ) * 1.0 + 0.5, dq.y / 0.9 ) ) - 0.5 );
          float groove = ( 1.0 - smoothstep( 0.02, 0.02 + fAa * 2.0, 0.5 - max( panel.x, panel.y ) ) ) * ( 1.0 - smoothstep( 0.01, 0.04, fPx ) );
          fcAlbedo = mix( vFF.rgb * ( 0.7 + 0.3 * fNb.g ) * ( 1.0 - 0.4 * groove ), vec3( 0.02 ), fan );
          fcRough = mix( 0.55, 0.08, fan );
          fcMetal = fan;
          fcEmit += fan * vec3( 1.0, 0.72, 0.42 ) * 0.5 * uFLit.y / ${ROOM_RADIANCE.toFixed(3)} * 0.085 * step( rnd.y, 0.5 ) * step( 0.01, uFLit.x );
          fcAO *= 0.7;
        } else {
          // ---- a pane: its frame and bars, then dark glass or a lit room
          float shop = oType > 1.5 ? 1.0 : 0.0;
          float frameW = shop > 0.5 ? 0.07 : 0.055;
          float frame = 1.0 - smoothstep( 0.0, fAa, -sdg - frameW );
          vec2 gq = qg;
          float barsSeen = 1.0 - smoothstep( 0.012, 0.04, fPx );
          float bars = 0.0;
          if ( shop < 0.5 ) {
            // a mullion down the middle and a transom two thirds of the way up; small panes on the old houses
            bars = max( 1.0 - smoothstep( 0.0, fAa, abs( gq.x ) - 0.028 ), 1.0 - smoothstep( 0.0, fAa, abs( gq.y - oHalf.y * 0.36 ) - 0.025 ) );
            bars = max( bars, fShut * barsSeen * ( 1.0 - smoothstep( 0.0, fAa, abs( fract( ( gq.y + oHalf.y ) / 0.42 ) - 0.5 ) * 0.42 - 0.012 ) ) );
          } else {
            bars = ( 1.0 - smoothstep( 0.0, fAa, abs( fract( gq.x / 1.9 + 0.5 ) - 0.5 ) * 1.9 - 0.03 ) ) * step( 2.3, 2.0 * oHalf.x );
          }
          frame = max( frame, bars * barsSeen );
          vec3 frameCol = shop > 0.5 || oType > 4.5 ? vec3( 0.05, 0.05, 0.055 ) : mix( vec3( 0.55, 0.53, 0.5 ), vFF.rgb, step( 0.5, hash12( vec2( fSeed, 11.0 ) ) ) );
          // which panes are lit: a hash against the hour's share; shops and the lobby as their own switch says
          float share = uFLit.x * ( 0.75 + 0.5 * hash12( vec2( fSeed, 23.0 ) ) );
          float lit = step( rnd.x, share );
          if ( shop > 0.5 ) lit = step( rnd.x, ${SHOPS_LIT.toFixed(2)} ) * uFLit.z;
          if ( gType > 4.5 ) lit = uFLit.z;
          if ( oType > 4.5 ) lit = step( 0.01, uFLit.x + uFLit.z );
          // closed shutters on a few of the dark ones
          float shut = ( 1.0 - lit ) * fShut * step( rnd.z, 0.16 ) * ( 1.0 - shop );
          vec3 glassCol = vec3( 0.07, 0.075, 0.08 );
          fcAlbedo = mix( glassCol, frameCol, frame );
          fcMetal = 1.0 - frame;
          fcRough = mix( 0.06, 0.6, frame );
          fcAO *= mix( 1.0, 0.75, frame );
          if ( shut > 0.5 ) {
            float louvre = fract( gq.y / 0.055 );
            fcAlbedo = vFF.rgb * ( 0.8 + 0.3 * fNa.b ) * mix( 0.85, 0.62 + 0.5 * louvre, barsSeen ) * ( 1.0 - 0.3 * step( abs( gq.x ), 0.012 ) );
            fcMetal = 0.0;
            fcRough = 0.6;
          } else if ( lit > 0.5 ) {
            // the lamp's colour and strength; the room's size
            vec3 hue = mix( vec3( 1.0, 0.74, 0.44 ), mix( vec3( 1.0, 0.86, 0.68 ), vec3( 0.72, 0.84, 1.0 ), step( 0.93, rnd.w ) ), step( 0.7, rnd.w ) );
            float power = ( 0.55 + 0.9 * rnd.y ) * ( 1.0 + 0.9 * shop );
            vec3 room;
            vec3 size = vec3( max( cellW - 0.25, 2.0 * oHalf.x + 0.3 ), ( shop > 0.5 ? gH : fH ) - 0.3, shop > 0.5 ? 5.5 : 3.2 + 1.6 * rnd.z );
            float floorAt = shop > 0.5 ? 0.0 : fi * fH + gH;
            #ifndef FACADE_SIMPLE
            if ( fNear > 0.02 ) {
              room = fRoom( vec2( cell.x, cell.y - floorAt ), fRay, size, rnd, shop );
            } else
            #endif
            {
              // far away, in a mirror or in a probe: the room as one warm panel, brighter towards its ceiling
              room = vec3( 0.62, 0.56, 0.48 ) * ( 0.45 + 0.75 * smoothstep( -oHalf.y, oHalf.y, gq.y ) );
            }
            #ifndef FACADE_SIMPLE
            room = mix( vec3( 0.62, 0.56, 0.48 ) * ( 0.45 + 0.75 * smoothstep( -oHalf.y, oHalf.y, gq.y ) ), room, fNear );
            #endif
            if ( shop < 0.5 ) {
              // curtains drawn part of the way in from each side, a blind part of the way down, a net over some
              vec2 cw = oHalf.x * ( 0.1 + 0.75 * rnd.zy * rnd.zy ) * step( 0.25, rnd.w );
              float curtain = max( step( gq.x, -oHalf.x + cw.x ), step( oHalf.x - cw.y, gq.x ) );
              float fold = 0.72 + 0.28 * sin( gq.x * 46.0 + rnd.x * 30.0 );
              vec3 cloth = mix( vec3( 0.75, 0.68, 0.55 ), vec3( 0.55, 0.3, 0.25 ), step( 0.8, rnd.y ) ) * mix( 1.0, fold, barsSeen );
              float net = step( 0.62, rnd.z );
              room = mix( room, vec3( 0.7, 0.66, 0.6 ) * ( 0.55 + 0.4 * smoothstep( -oHalf.y, oHalf.y, gq.y ) ), 0.62 * net );
              room = mix( room, cloth * 0.75, curtain );
              float down = oHalf.y - 2.0 * oHalf.y * rnd.y * step( rnd.x * 7.0 - floor( rnd.x * 7.0 ), 0.55 );
              float blind = step( down, gq.y );
              float slat = 0.85 + 0.15 * step( 0.5, fract( gq.y / 0.05 ) ) * barsSeen;
              room = mix( room, vec3( 0.8, 0.72, 0.56 ) * 0.62 * slat, blind );
            }
            fcEmit += ( 1.0 - frame ) * room * hue * power * uFLit.y;
          }
        }
      }
    } else if ( fp.y < 0.0 ) {
      // below the pavement: the plinth, plain stone
      fcAlbedo = vec3( 0.17, 0.17, 0.165 ) * ( 0.7 + 0.6 * fNb.r );
    }

    // an iron rail across the foot of a tall window (flat against the wall: its bars fade out with distance)
    if ( fRail > 0.5 && oType > 0.5 && oType < 1.5 ) {
      vec2 q = vec2( lx, fp.y ) - oMid;
      float inside = step( abs( q.x ), oHalf.x + 0.1 ) * step( -oHalf.y - 0.05, q.y ) * step( q.y, -oHalf.y + 0.95 );
      float bar = 1.0 - smoothstep( 0.0, fAa, abs( fract( q.x / 0.12 ) - 0.5 ) * 0.12 - 0.012 );
      bar = max( bar, 1.0 - smoothstep( 0.0, fAa, abs( q.y + oHalf.y - 0.92 ) - 0.02 ) );
      float seen = inside * mix( bar, 0.22, smoothstep( 0.012, 0.05, fPx ) );
      fcAlbedo = mix( fcAlbedo, vec3( 0.02 ), seen );
      fcEmit *= 1.0 - seen;
    }

    // the house's lanterns wash the wall round them
    if ( vFF.a > 0.5 ) {
      float lh = vFF.a;
      float n = W > 24.0 ? 4.0 : W > 12.5 ? 2.0 : 1.0;
      float wash = 0.0;
      for ( float k = 0.0; k < 4.0; k += 1.0 ) {
        if ( k >= n ) break;
        float lu = n < 1.5 ? 0.5 * W : 0.9 + ( W - 1.8 ) * k / ( n - 1.0 );
        vec2 dl = fp - vec2( lu, lh );
        float d2 = dot( dl, dl ) + 0.12;
        wash += 0.35 / ( d2 * sqrt( d2 ) ) * smoothstep( 0.6, -1.2, dl.y );
      }
      fcEmit += fcAlbedo * ( 1.0 - fcMetal ) * wash * uFLit.w * vec3( 1.0, 0.7, 0.4 ) * 0.05;
    }
  } else if ( fKind < 1.5 ) {
    // ================================================================ plain masonry (party walls, gables, chimneys)
    fcAO *= 0.75 + 0.25 * smoothstep( -0.5, 1.5, fp.y );
  } else if ( fKind < 2.5 ) {
    // ================================================================ roof tiles: v up the slope
    float seen = 1.0 - smoothstep( 0.02, 0.09, fPx );
    float row = fp.y / 0.33;
    float tile = fp.x / 0.2 + 0.5 * mod( floor( row ), 2.0 );
    float tone = hash12( vec2( floor( tile ), floor( row ) ) + fSeed );
    vec3 t = vFC.rgb * ( 0.72 + 0.56 * mix( 0.5, tone, 0.4 + 0.6 * seen ) ) * ( 0.85 + 0.3 * fNa.r );
    // lichen and soot in patches, more on the old roofs
    t = mix( t, vec3( 0.2, 0.2, 0.17 ) * ( 0.6 + 0.8 * fNb.r ), fAge * 0.6 * smoothstep( 0.5, 0.75, fNa.g ) );
    float round = sin( 3.14159 * fract( tile ) );
    t *= mix( 1.0, ( 0.62 + 0.38 * round ) * ( 1.0 - 0.4 * smoothstep( 0.82, 1.0, 1.0 - fract( row ) ) ), seen );
    fcTilt = vec2( ( fract( tile ) - 0.5 ) * 1.6, 0.5 - fract( row ) ) * 0.45 * seen;
    fcAlbedo = t * mix( 1.0, 0.72, uFWet.x );
    fcRough = mix( 0.86, 0.34, uFWet.x * ( 0.6 + 0.4 * fNb.a ) );
  } else if ( fKind < 3.5 ) {
    // ================================================================ a plain painted or stone part
    fcAlbedo = vFC.rgb * ( 0.86 + 0.28 * fNa.r );
    fcRough = 0.82;
  } else if ( fKind < 4.5 ) {
    // ================================================================ an awning's cloth: stripes, lit a little from the shop below
    float stripe = smoothstep( 0.5 - fAa / 0.36, 0.5 + fAa / 0.36, abs( fract( fp.x / 0.36 ) - 0.5 ) * 2.0 );
    fcAlbedo = mix( vFC.rgb, vFD.rgb, stripe ) * ( 0.9 + 0.2 * fNa.r );
    fcRough = 0.9;
    fcEmit += fcAlbedo * 0.012 * uFLit.z;
  } else if ( fKind < 5.5 ) {
    // ================================================================ painted metal
    fcAlbedo = vFC.rgb * ( 0.9 + 0.2 * fNb.r );
    fcRough = 0.45;
    fcMetal = 0.55;
  } else if ( fKind < 6.5 ) {
    // ================================================================ a railing: bars that thin out into a veil with distance
    float bar = 1.0 - smoothstep( 0.0, fAa, abs( fract( fp.x / 0.115 ) - 0.5 ) * 0.115 - 0.011 );
    bar = max( bar, step( vFA.y - 0.06, fp.y ) );
    bar = max( bar, step( fp.y, 0.05 ) );
    float cover = mix( bar, 0.24, smoothstep( 0.012, 0.06, fPx ) * ( 1.0 - step( vFA.y - 0.06, fp.y ) ) );
    float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( cover < ign * 0.98 + 0.01 ) discard;
    fcAlbedo = vFC.rgb;
    fcRough = 0.5;
    fcMetal = 0.5;
  } else if ( fKind < 7.5 ) {
    // ================================================================ a lit strip or panel (vFD.a: its radiance; flags 1: always on, else with the shops)
    fcAlbedo = vec3( 0.02 );
    fcEmit += vFC.rgb * vFD.a * mix( uFLit.z, 1.0, step( 0.5, vFB.w ) );
    fcRough = 0.4;
  } else {
    // ================================================================ dark glass
    fcAlbedo = vec3( 0.07, 0.075, 0.08 );
    fcMetal = 1.0;
    fcRough = 0.05;
  }

  // ---- the foot of every wall is wet: darker and smoother, with a ragged upper edge
  if ( fKind < 1.5 ) {
    float wet = uFWet.x * ( 1.0 - smoothstep( 0.25, 0.9 + 0.8 * fNc.b, fp.y ) ) * step( fcMetal, 0.5 );
    fcAlbedo *= 1.0 - 0.38 * wet;
    fcRough = mix( fcRough, 0.35, wet );
    // and dirt splashed up from the pavement
    fcAlbedo *= 1.0 - 0.25 * ( 1.0 - smoothstep( 0.0, 0.5, fp.y ) ) * step( 0.0, fp.y );
  }
  diffuseColor.rgb = fcAlbedo;
}
`;

const FACADE_NORMAL = /* glsl */ `
{
  vec3 fNw = inverseTransformDirection( normal, viewMatrix );
  vec3 fTw = normalize( vec3( fNw.z, 0.0, -fNw.x ) + vec3( 1.0e-4, 0.0, 0.0 ) );
  vec3 fBw = cross( fNw, fTw );
  vec3 bent = normalize( fNw + ( fTw * fcTilt.x + fBw * fcTilt.y ) * vFUv.z );
  normal = normalize( ( viewMatrix * vec4( bent, 0.0 ) ).xyz );
}
`;

/**
 * The material of every building in the town.
 * @param {object} o
 * @param {import('../../engine/caps.js').Tier} o.tier
 * @param {import('./atmosphere.js').Atmosphere} o.atmosphere
 */
export function createFacadeMaterial({ tier, atmosphere }) {
  const size = 256;
  const noise = fieldTexture(size, [
    valueField(size, { seed: 811, cells: 6, octaves: 5 }),
    valueField(size, { seed: 812, cells: 9, octaves: 4, gain: 0.6 }),
    worleyField(size, { seed: 813, cells: 11 }),
    valueField(size, { seed: 814, cells: 4, octaves: 3 }),
  ]);
  const uniforms = {
    uFNoise: { value: noise },
    uFLit: { value: new THREE.Vector4(0, ROOM_RADIANCE, 0, 0) },
    uFWet: { value: new THREE.Vector2(0, 0) },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.name = 'facade';
  if (tier === 'low') material.defines = { ...material.defines, FACADE_SIMPLE: 1 };
  extend(material, `facade-${tier === 'low' ? 'simple' : 'full'}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD; attribute vec4 aE; attribute vec4 aF;
flat varying vec4 vFA; flat varying vec4 vFB; flat varying vec4 vFC; flat varying vec4 vFD; flat varying vec4 vFE; flat varying vec4 vFF;
varying vec3 vFUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFA = aA; vFB = aB; vFC = aC; vFD = aD; vFE = aE; vFF = aF;
// the view's own camera has a plain perspective; a mirror's near plane is slanted, a probe's faces are square
// and a right angle wide (the same test as retro.js)
bool fMirror = abs( projectionMatrix[ 0 ][ 2 ] ) + abs( projectionMatrix[ 1 ][ 2 ] ) > 1.0e-5;
bool fProbe = abs( abs( projectionMatrix[ 1 ][ 1 ] ) - 1.0 ) < 1.0e-3 && abs( abs( projectionMatrix[ 0 ][ 0 ] ) - 1.0 ) < 1.0e-3;
vFUv = vec3( uv, fMirror || fProbe ? 0.0 : 1.0 );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_PARS}`)
      .replace('#include <map_fragment>', FACADE_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fcRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fcMetal;')
      .replace('#include <normal_fragment_maps>', FACADE_NORMAL)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fcEmit;')
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= fcAO;\nreflectedLight.indirectSpecular *= mix( 1.0, fcAO, 0.7 );\nreflectedLight.directDiffuse *= mix( 1.0, fcAO, 0.5 );',
      );
  });
  atmosphere.patch(material);
  return {
    material,
    uniforms,
    /**
     * @param {import('./lighting.js').TimeOfDay} time @param {number} wetness 0..1
     */
    setTime(time, wetness) {
      const lamps = time.lamps;
      uniforms.uFLit.value.set(lamps.windows ?? 0, ROOM_RADIANCE * (lamps.rooms ?? 1), lamps.shops ?? (lamps.street > 0 ? 1 : 0), lamps.street);
      uniforms.uFWet.value.set(wetness, 0);
    },
    dispose() {
      noise.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The writer: quads and triangles with the numbers the material reads.

const UP = new THREE.Vector3(0, 1, 0);

/** The numbers of one surface: six groups of four (aA .. aF). */
export function surface({ kind = KIND.SOLID, color = [0.5, 0.5, 0.5], color2 = [0.5, 0.5, 0.5], seed = 1, flags = 0, top = 1, radiance = 0 } = {}) {
  const r = new Float32Array(24);
  r.set([1, top, 0, 1], 0);
  r.set([3, 0, kind, flags], 4);
  r.set([color[0], color[1], color[2], 0], 8);
  r.set([color2[0], color2[1], color2[2], radiance], 12);
  r.set([seed, 1, 1, 1], 16);
  r.set([0.2, 0.2, 0.2, 0], 20);
  return r;
}

/** The numbers of a house wall with windows (or, with `kind` WALL, the same wall blind). */
export function facadeSurface(lot, width, { kind = KIND.FACADE, ground = lot.ground, lantern = 0, floors = lot.floors, groundH = lot.groundH, win = lot.win, wall = lot.wall, mat = lot.mat, seedOffset = 0 } = {}) {
  const r = new Float32Array(24);
  const flags =
    (win.arch ? 1 : 0) + (win.shutters ? 2 : 0) + (win.surround ? 4 : 0) + (win.rail ? 8 : 0) + (lot.mat === 1 || lot.kind === 'hotel' || lot.kind === 'grand' || lot.flags.palazzo ? 16 : 0) +
    (lot.flags.palazzo || lot.flags.villa || lot.kind === 'church' ? 32 : 0) + (lot.flags.tower ? 64 : 0);
  r.set([width, groundH + floors * lot.floorH, groundH, lot.floorH], 0);
  r.set([lot.bay, lot.margin, kind, flags], 4);
  r.set([wall[0], wall[1], wall[2], mat + Math.min(0.97, lot.age) * 0.98], 8);
  r.set([lot.trim[0], lot.trim[1], lot.trim[2], GROUND[ground] ?? 0], 12);
  r.set([lot.seed + seedOffset, win.w, win.h, win.sill], 16);
  r.set([lot.shutter[0], lot.shutter[1], lot.shutter[2], lantern], 20);
  return r;
}

/** Collects the buildings' geometry. */
export function createWriter() {
  const pos = [];
  const nor = [];
  const uv = [];
  const data = [[], [], [], [], [], []];
  const index = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  let triangles = 0;

  const vertex = (p, u, v, normal, rec) => {
    pos.push(p.x, p.y, p.z);
    nor.push(normal.x, normal.y, normal.z);
    uv.push(u, v);
    for (let k = 0; k < 6; k++) data[k].push(rec[k * 4], rec[k * 4 + 1], rec[k * 4 + 2], rec[k * 4 + 3]);
  };

  const w = {
    /**
     * A flat polygon of three or four points with texture coordinates in metres. Its front is the side `towards`
     * points to (a rough direction is enough): the corners are taken in whichever order faces that way.
     * @param {THREE.Vector3[]} pts @param {number[][]} uvs @param {Float32Array} rec @param {THREE.Vector3} towards
     */
    poly(pts, uvs, rec, towards) {
      a.subVectors(pts[1], pts[0]);
      b.subVectors(pts[pts.length - 1], pts[0]);
      n.crossVectors(a, b).normalize();
      const flip = n.dot(towards) < 0;
      if (flip) n.negate();
      const base = pos.length / 3;
      pts.forEach((p, k) => vertex(p, uvs[k][0], uvs[k][1], n, rec));
      for (let k = 1; k < pts.length - 1; k++) {
        if (flip) index.push(base, base + k + 1, base + k);
        else index.push(base, base + k, base + k + 1);
        triangles++;
      }
    },
    /**
     * An upright wall from P to Q (points of the map), from y0 + v0 up to y0 + v1; u runs from P. Its face looks
     * to the right of the way from P to Q.
     */
    wall(P, Q, y0, v0, v1, rec, u0 = 0) {
      const length = Math.hypot(Q.x - P.x, Q.z - P.z);
      const towards = new THREE.Vector3(-(Q.z - P.z), 0, Q.x - P.x);
      w.poly(
        [new THREE.Vector3(P.x, y0 + v0, P.z), new THREE.Vector3(Q.x, y0 + v0, Q.z), new THREE.Vector3(Q.x, y0 + v1, Q.z), new THREE.Vector3(P.x, y0 + v1, P.z)],
        [[u0, v0], [u0 + length, v0], [u0 + length, v1], [u0, v1]],
        rec,
        towards,
      );
      return length;
    },
    /**
     * A box standing on a base rectangle: centre c (map), half sizes along the unit vectors t and o, from y0 to y1.
     * `faces`: which of its sides to draw (default all but the bottom).
     */
    box(c, t, o, ht, ho, y0, y1, rec, { bottom = false, top = true } = {}) {
      const corner = (st, so, y) => new THREE.Vector3(c.x + t.x * ht * st + o.x * ho * so, y, c.z + t.z * ht * st + o.z * ho * so);
      const sides = [
        [[-1, -1], [1, -1], new THREE.Vector3(-o.x, 0, -o.z), 2 * ht],
        [[1, 1], [-1, 1], new THREE.Vector3(o.x, 0, o.z), 2 * ht],
        [[-1, 1], [-1, -1], new THREE.Vector3(-t.x, 0, -t.z), 2 * ho],
        [[1, -1], [1, 1], new THREE.Vector3(t.x, 0, t.z), 2 * ho],
      ];
      for (const [p, q, out, len] of sides) {
        w.poly([corner(p[0], p[1], y0), corner(q[0], q[1], y0), corner(q[0], q[1], y1), corner(p[0], p[1], y1)], [[0, 0], [len, 0], [len, y1 - y0], [0, y1 - y0]], rec, out);
      }
      const cap = (y, dir) =>
        w.poly([corner(-1, -1, y), corner(1, -1, y), corner(1, 1, y), corner(-1, 1, y)], [[0, 0], [2 * ht, 0], [2 * ht, 2 * ho], [0, 2 * ho]], rec, dir);
      if (top) cap(y1, UP);
      if (bottom) cap(y0, new THREE.Vector3(0, -1, 0));
    },
    get triangles() {
      return triangles;
    },
    /** @returns {THREE.BufferGeometry} */
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      ['aA', 'aB', 'aC', 'aD', 'aE', 'aF'].forEach((name, k) => g.setAttribute(name, new THREE.Float32BufferAttribute(data[k], 4)));
      g.setIndex(index);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    },
  };
  return w;
}

/**
 * One building from its lot: walls, roof, chimneys, cornice, balconies, awnings.
 * @param {ReturnType<typeof createWriter>} w
 * @param {object} lot one building: its front line A..B on the map, depth, floors, roof, palette (town.js makes them)
 * @param {number} y0 the height of the pavement at its front (v = 0)
 * @param {number} low the lowest ground under it (its plinth goes down to there)
 * @param {import('../../engine/rng.js').Rng} rng
 */
export function writeBuilding(w, lot, y0, low, rng) {
  const t = new THREE.Vector3(lot.bx - lot.ax, 0, lot.bz - lot.az).normalize();
  const o = new THREE.Vector3(lot.ox, 0, lot.oz);
  const A = new THREE.Vector3(lot.ax, 0, lot.az);
  const B = new THREE.Vector3(lot.bx, 0, lot.bz);
  const C = B.clone().addScaledVector(o, lot.d);
  const D = A.clone().addScaledVector(o, lot.d);
  const at = (alongT, alongO, y) => new THREE.Vector3(lot.ax + t.x * alongT + o.x * alongO, y, lot.az + t.z * alongT + o.z * alongO);
  const top = lot.groundH + lot.floors * lot.floorH;
  const wallTop = top + lot.attic;
  const foot = Math.min(-0.3, low - y0 - 0.5);
  const W = lot.w;
  const Dp = lot.d;
  const lantern = lot.kind === 'house' || lot.kind === 'hotel' ? Math.min(lot.groundH - 0.55, 3.7) : 0;
  const mansard = lot.roof === 'mansard';
  const frontRidge = lot.roof === 'front';
  const trimRec = surface({ kind: KIND.SOLID, color: lot.trim, seed: lot.seed });
  const darkRec = surface({ kind: KIND.SOLID, color: [0.09, 0.08, 0.075], seed: lot.seed });

  // ---- the four walls
  const front = facadeSurface(lot, W, { lantern });
  const backGround = lot.kind === 'pavilion' ? 'glass' : lot.ground === 'church' ? 'plain' : 'plain';
  const back = facadeSurface(lot, W, { ground: backGround, seedOffset: 1 });
  const sideOpen = (seedOffset) => facadeSurface(lot, Dp, { ground: lot.kind === 'pavilion' ? 'glass' : lot.kind === 'grand' ? 'lobby' : 'plain', seedOffset });
  const sideBlind = facadeSurface(lot, Dp, { kind: KIND.WALL });
  // seen from outside, a wall runs from its left end to its right end: u = 0 is at B on the front
  w.wall(B, A, y0, foot, wallTop, front);
  w.wall(D, C, y0, foot, wallTop, back);
  w.wall(A, D, y0, foot, wallTop, lot.openA ? sideOpen(2) : sideBlind);
  w.wall(C, B, y0, foot, wallTop, lot.openB ? sideOpen(3) : sideBlind);

  // ---- a cornice under the eaves, round the sides that show
  const corniceH = lot.kind === 'pavilion' ? 0 : 0.26;
  if (corniceH > 0) {
    const proud = lot.mat === 1 || lot.flags.palazzo || lot.kind === 'hotel' || lot.kind === 'grand' ? 0.34 : 0.2;
    const yc = y0 + wallTop;
    w.box(at(W / 2, -proud / 2, 0), t, o, W / 2 + proud, proud / 2, yc - corniceH, yc, trimRec, { bottom: true });
    if (lot.openA) w.box(at(-proud / 2, Dp / 2, 0), t, o, proud / 2, Dp / 2, yc - corniceH, yc, trimRec, { bottom: true });
    if (lot.openB) w.box(at(W + proud / 2, Dp / 2, 0), t, o, proud / 2, Dp / 2, yc - corniceH, yc, trimRec, { bottom: true });
  }

  // ---- the roof
  const tiles = surface({ kind: KIND.TILES, color: lot.roofColor, seed: lot.seed });
  tiles[11] = Math.floor(0) + Math.min(0.97, lot.age) * 0.98;
  const gableRec = facadeSurface(lot, W, { kind: KIND.WALL });
  const ov = lot.roof === 'flat' ? 0 : 0.5;
  const pitch = lot.pitch;
  const yw = y0 + wallTop;
  let ridgeY = yw;
  /** A roof slope from an eave line (two points) up to a ridge line (two points). */
  const slope = (e0, e1, r0, r1, towards) => {
    const run = Math.hypot(e0.distanceTo(r0), 0);
    const len = e0.distanceTo(e1);
    const inset = (len - r0.distanceTo(r1)) / 2;
    if (r0.distanceTo(r1) < 0.05) w.poly([e0, e1, r0], [[0, 0], [len, 0], [len / 2, run]], tiles, towards);
    else w.poly([e0, e1, r1, r0], [[0, 0], [len, 0], [len - inset, run], [inset, run]], tiles, towards);
  };
  const up = (v, k = 1) => v.clone().add(UP).normalize().multiplyScalar(k);
  if (lot.roof === 'gable' || lot.roof === 'hip' || lot.roof === 'spire') {
    const hip = lot.roof !== 'gable';
    const half = Dp / 2;
    const og = hip ? ov : 0.3;
    const ye = yw - ov * pitch;
    const inset = hip ? Math.min(half, W / 2) : 0;
    const rise = hip ? inset * pitch : half * pitch;
    ridgeY = yw + rise;
    const rA = at(inset, half, ridgeY);
    const rB = at(W - inset, half, ridgeY);
    const eFA = at(-og, -ov, ye);
    const eFB = at(W + og, -ov, ye);
    const eBA = at(-og, Dp + ov, ye);
    const eBB = at(W + og, Dp + ov, ye);
    if (hip && W < Dp) {
      // deeper than wide: the ridge runs away from the road
      const r0 = at(W / 2, inset, ridgeY);
      const r1 = at(W / 2, Dp - inset, ridgeY);
      slope(eFB, eFA, r0, r0, up(o.clone().negate()));
      slope(eBA, eBB, r1, r1, up(o));
      slope(eFA, eBA, r0, r1, up(t.clone().negate()));
      slope(eBB, eFB, r1, r0, up(t));
    } else {
      slope(eFB, eFA, rB, rA, up(o.clone().negate()));
      slope(eBA, eBB, rA, rB, up(o));
      if (hip) {
        slope(eFA, eBA, rA, rA, up(t.clone().negate()));
        slope(eBB, eFB, rB, rB, up(t));
      } else {
        // the gable ends: the wall carried up to the ridge
        const tri = (P, Q, out) =>
          w.poly([new THREE.Vector3(P.x, yw, P.z), new THREE.Vector3(Q.x, yw, Q.z), new THREE.Vector3((P.x + Q.x) / 2, ridgeY, (P.z + Q.z) / 2)], [[0, wallTop], [Dp, wallTop], [Dp / 2, wallTop + rise]], gableRec, out);
        tri(A, D, t.clone().negate());
        tri(C, B, t);
      }
    }
    // the underside of the eaves along the front
    w.poly([at(-og, -ov, ye - 0.02), at(W + og, -ov, ye - 0.02), at(W + og, 0, yw - 0.03), at(-og, 0, yw - 0.03)], [[0, 0], [W, 0], [W, ov], [0, ov]], darkRec, new THREE.Vector3(0, -1, 0));
    if (lot.roof === 'spire') {
      // a cross on the tower
      const crossRec = surface({ kind: KIND.METAL, color: [0.05, 0.05, 0.05], seed: 3 });
      w.box(at(W / 2, half, 0), t, o, 0.07, 0.07, ridgeY - 0.2, ridgeY + 1.9, crossRec);
      w.box(at(W / 2, half, 0), t, o, 0.5, 0.07, ridgeY + 1.2, ridgeY + 1.34, crossRec);
    }
  } else if (frontRidge) {
    // the church: its ridge runs away from the road, its gable faces it
    const half = W / 2;
    const rise = half * pitch;
    ridgeY = yw + rise;
    const ye = yw - ov * pitch;
    const r0 = at(half, -0.3, ridgeY);
    const r1 = at(half, Dp + 0.3, ridgeY);
    slope(at(-ov, -0.3, ye), at(-ov, Dp + 0.3, ye), r0, r1, up(t.clone().negate()));
    slope(at(W + ov, Dp + 0.3, ye), at(W + ov, -0.3, ye), r1, r0, up(t));
    const tri = (P, Q, out) =>
      w.poly([new THREE.Vector3(P.x, yw, P.z), new THREE.Vector3(Q.x, yw, Q.z), new THREE.Vector3((P.x + Q.x) / 2, ridgeY, (P.z + Q.z) / 2)], [[0, wallTop], [W, wallTop], [W / 2, wallTop + rise]], gableRec, out);
    tri(B, A, o.clone().negate());
    tri(D, C, o);
  } else if (mansard) {
    // a steep slate slope with a window to every bay, then a low hip
    const mH = 2.9;
    const inset = 1.0;
    const attic = { ...lot, floorH: mH, floors: 1, groundH: 0, win: { w: 0.95, h: 1.35, sill: 0.8, arch: 0, shutters: 0, surround: 1, rail: 0 }, trim: lot.trim, mat: 0, age: 0.3, flags: {}, kind: 'attic' };
    const steep = (P, Q, out, width, seedOffset) => {
      const rec = facadeSurface(attic, width, { ground: 'plain', wall: lot.roofColor, mat: 0, seedOffset });
      const pin = (p, k) => new THREE.Vector3(p.x - out.x * inset * k, yw + mH * k, p.z - out.z * inset * k);
      const run = Math.hypot(mH, inset);
      // (the slope narrows by `inset` at each end as it climbs; u keeps its metres)
      const dir = new THREE.Vector3(Q.x - P.x, 0, Q.z - P.z).normalize();
      const p1 = pin(P, 1).addScaledVector(dir, inset);
      const q1 = pin(Q, 1).addScaledVector(dir, -inset);
      w.poly([new THREE.Vector3(P.x, yw, P.z), new THREE.Vector3(Q.x, yw, Q.z), q1, p1], [[0, 0], [width, 0], [width - inset, run], [inset, run]], rec, up(out, 1));
    };
    steep(B, A, o.clone().negate(), W, 5);
    steep(D, C, o, W, 6);
    steep(A, D, t.clone().negate(), Dp, 7);
    steep(C, B, t, Dp, 8);
    const yt = yw + mH;
    const half = Dp / 2 - inset;
    const hipIn = Math.min(half, W / 2 - inset);
    ridgeY = yt + hipIn * 0.22;
    const rA = at(inset + hipIn, Dp / 2, ridgeY);
    const rB = at(W - inset - hipIn, Dp / 2, ridgeY);
    const c = (st, so) => at(st > 0 ? W - inset : inset, so > 0 ? Dp - inset : inset, yt);
    slope(c(1, -1), c(-1, -1), rB, rA, up(o.clone().negate()));
    slope(c(-1, 1), c(1, 1), rA, rB, up(o));
    slope(c(-1, -1), c(-1, 1), rA, rA, up(t.clone().negate()));
    slope(c(1, 1), c(1, -1), rB, rB, up(t));
  } else {
    // flat: the walls end in a parapet; the roof lies a little below its top, with what stands on flat roofs
    const yr = yw - Math.min(0.7, lot.attic * 0.7);
    w.poly([at(0, 0, yr), at(W, 0, yr), at(W, Dp, yr), at(0, Dp, yr)], [[0, 0], [W, 0], [W, Dp], [0, Dp]], darkRec, UP);
    ridgeY = yw;
    if (lot.kind !== 'pavilion') {
      const plain = surface({ kind: KIND.SOLID, color: lot.wall.map((v) => v * 0.8), seed: lot.seed });
      w.box(at(W * rng.range(0.3, 0.7), Dp * 0.62, 0), t, o, 1.6, 1.3, yr, yr + 2.5, plain);
      const metal = surface({ kind: KIND.METAL, color: [0.3, 0.31, 0.32], seed: lot.seed });
      for (let k = 0; k < 2; k++) w.box(at(W * rng.range(0.12, 0.88), Dp * rng.range(0.25, 0.45), 0), t, o, 0.55, 0.4, yr, yr + rng.range(0.7, 1.0), metal);
    }
  }

  // ---- chimneys on the pitched roofs
  if (lot.roof === 'gable' || lot.roof === 'hip' || mansard) {
    const stack = facadeSurface(lot, 1, { kind: KIND.WALL, mat: rng.next() < 0.4 ? 2 : lot.mat, wall: rng.next() < 0.4 ? [0.34, 0.2, 0.15] : lot.wall });
    const count = lot.kind === 'back' ? 1 : mansard ? 4 : 1 + rng.int(3);
    for (let k = 0; k < count; k++) {
      const along = W * (mansard ? 0.12 + (0.76 * k) / Math.max(1, count - 1) : rng.range(0.15, 0.85));
      const deep = Dp * (0.5 + (mansard ? (k % 2 ? 0.2 : -0.2) : rng.range(-0.22, 0.22)));
      const h = ridgeY + rng.range(0.5, 1.2);
      const base = mansard ? yw + 1.5 : yw + 0.2;
      w.box(at(along, deep, 0), t, o, 0.34, 0.26, base, h, stack);
      w.box(at(along, deep, 0), t, o, 0.42, 0.34, h, h + 0.09, trimRec, { bottom: true });
    }
  }

  // ---- balconies: a slab and an iron rail to every bay of every floor but the top one
  if (lot.flags.balconies) {
    const bays = baysOf(W, lot.margin, lot.bay);
    const rail = surface({ kind: KIND.RAILING, color: [0.03, 0.03, 0.035], seed: lot.seed, top: 1.0 });
    const slab = surface({ kind: KIND.SOLID, color: lot.trim.map((v) => v * 0.9), seed: lot.seed });
    const wide = Math.min(bays.width - 0.55, lot.win.w + 1.1) / 2;
    const deep = 1.05;
    for (let f = 0; f < lot.floors - 1; f++) {
      const y = y0 + lot.groundH + f * lot.floorH;
      for (let i = 0; i < bays.count; i++) {
        // u runs from B: the bay's middle, measured from A
        const mid = W - (lot.margin + (i + 0.5) * bays.width);
        w.box(at(mid, -deep / 2, 0), t, o, wide, deep / 2, y - 0.14, y, slab, { bottom: true });
        const p0 = at(mid - wide, -deep, y);
        const p1 = at(mid + wide, -deep, y);
        const railQuad = (P, Q, out) =>
          w.poly([P, Q, Q.clone().setY(y + 1.0), P.clone().setY(y + 1.0)], [[0, 0], [P.distanceTo(Q), 0], [P.distanceTo(Q), 1.0], [0, 1.0]], rail, out);
        railQuad(p1, p0, o.clone().negate());
        railQuad(p0, at(mid - wide, 0, y), t.clone().negate());
        railQuad(at(mid + wide, 0, y), p1, t);
      }
    }
  }

  // ---- awnings over some of the shop windows
  if (lot.flags.awnings && lot.ground === 'shops') {
    const bays = shopBaysOf(W, lot.margin, lot.bay);
    const colours = [[0.5, 0.12, 0.08], [0.1, 0.22, 0.14], [0.55, 0.5, 0.4], [0.1, 0.14, 0.28]];
    const pair = colours[rng.int(colours.length)];
    const cloth = surface({ kind: KIND.AWNING, color: pair, color2: [0.62, 0.6, 0.54], seed: lot.seed });
    for (let i = 0; i < bays.count; i++) {
      if (rng.next() < 0.3) continue;
      const mid = W - (lot.margin + (i + 0.5) * bays.width);
      const half = bays.width / 2 - 0.3;
      const yTop = y0 + lot.groundH - 0.95;
      const out = 1.45;
      const drop = 0.62;
      const a0 = at(mid - half, 0, yTop);
      const a1 = at(mid + half, 0, yTop);
      const b0 = at(mid - half, -out, yTop - drop);
      const b1 = at(mid + half, -out, yTop - drop);
      const run = Math.hypot(out, drop);
      const uvs = [[0, 0], [2 * half, 0], [2 * half, run], [0, run]];
      w.poly([b0, b1, a1, a0], uvs, cloth, UP);
      w.poly([b0, b1, a1, a0], uvs, cloth, new THREE.Vector3(0, -1, 0));
      // the valance
      w.poly([b0.clone().setY(b0.y - 0.2), b1.clone().setY(b1.y - 0.2), b1, b0], [[0, 0], [2 * half, 0], [2 * half, 0.2], [0, 0.2]], cloth, o.clone().negate());
    }
  }
  return { ridgeY, wallTop: yw };
}
