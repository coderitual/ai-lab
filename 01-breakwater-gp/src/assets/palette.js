// Colour script for the whole game: a bright, hazy afternoon with the sun
// already dropping toward a deep blue-green sea, so that waves are lit from
// behind. Everything visual reads its colours from here so the look stays
// coherent.

import * as THREE from 'three';
import { DEG } from '../engine/math.js';

const c = (hex) => new THREE.Color(hex);

// The sun stands over the open ocean to the south-west, low enough to shine
// through the wave tops: it lights the green island's beaches and the faces
// of the towers that look onto the river. (Unit vector *toward* the sun.)
const SUN_AZIMUTH = 218 * DEG; // 0 = +X, 90 = +Z
const SUN_ELEVATION = 33 * DEG;
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
).normalize();

export const PALETTE = {
  // sky
  skyZenith: c('#2a66bd'),
  skyMid: c('#6eaee6'),
  skyHorizonSun: c('#fbf3e2'),
  skyHorizonAway: c('#cfe4f1'),
  sunColor: c('#fff1d6'),
  cloudLit: c('#ffffff'),
  cloudShade: c('#a9c0da'),

  // sea
  waterDeep: c('#052c52'), // troughs, looking down into deep water
  waterMid: c('#0a80ad'), // the lit body of a wave
  waterShallow: c('#3ad6c6'), // over sand near the islands
  waterScatter: c('#3df0d8'), // light coming through the wave tops
  foam: c('#f6fcff'),

  // land
  sand: c('#f0d7a2'),
  sandWet: c('#c9ab78'),
  grass: c('#7fb04c'),
  grassDark: c('#4f8a3f'),
  rock: c('#6b6460'),
  rockDark: c('#3f3a3c'),
  trunk: c('#8c6a48'),
  palmLeaf: c('#3f9150'),
  palmLeafLight: c('#7fbf4d'),
  wood: c('#9b7650'),
  woodDark: c('#6e5238'),
  thatch: c('#d2b06a'),
  farHills: c('#6f86a6'),

  // course furniture
  buoyRed: c('#e8343f'),
  buoyGreen: c('#17b26a'),
  buoyWhite: c('#f7f5ee'),
  floatOrange: c('#ff8a1f'),
  archA: c('#ff6b2c'),
  archB: c('#fdf6e6'),
  lampOff: c('#2a2f36'),
  lampAmber: c('#ffb020'),
  lampGreen: c('#3dff7a'),
};

/**
 * Racing teams: the two colours of each boat's livery, the design it is painted to, the name on its flanks, and the
 * HUD colour. Index 0 is the player.
 */
export const TEAMS = [
  { name: 'YOU', hull: '#ff5a14', accent: '#fff3e2', css: '#ff7a2e', mark: 'EMBER', pattern: 'slash' },
  { name: 'KAI', hull: '#10a6e0', accent: '#0b2550', css: '#27b6e6', mark: 'RIPTIDE', pattern: 'wave' },
  { name: 'MIRA', hull: '#e6278f', accent: '#17171f', css: '#ee4aa6', mark: 'ORCHID', pattern: 'shard' },
  { name: 'JUNO', hull: '#9bd81d', accent: '#262a31', css: '#a6e03a', mark: 'FIREFLY', pattern: 'stripe' },
];
