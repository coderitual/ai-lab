// Colour script for the whole game: a bright trade-wind afternoon over a deep
// blue sea. Everything visual reads its colours from here so the look stays
// coherent.

import * as THREE from 'three';
import { DEG } from '../engine/math.js';

const c = (hex) => new THREE.Color(hex);

// The sun stands fairly high over the open ocean. (Unit vector *toward* the sun.)
const SUN_AZIMUTH = 55 * DEG; // 0 = +X, 90 = +Z
const SUN_ELEVATION = 40 * DEG;
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
).normalize();

export const PALETTE = {
  // sky
  skyZenith: c('#1a5fc2'),
  skyMid: c('#58a3e6'),
  skyHorizonSun: c('#e4f0f1'),
  skyHorizonAway: c('#c4e1f3'),
  sunColor: c('#fff4dc'),
  cloudLit: c('#ffffff'),
  cloudShade: c('#a9c0da'),

  // sea
  waterDeep: c('#06305c'), // troughs, looking down into deep water
  waterMid: c('#0a5f96'), // the lit body of a wave
  waterShallow: c('#34d3c4'), // over sand near the islands
  waterScatter: c('#2fdcc8'), // light coming through thin crests
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

/** Racing teams: hull colours + rider kit. Index 0 is the player. */
export const TEAMS = [
  { name: 'YOU', hull: '#ff6a1a', accent: '#fff3e2', suit: '#1c2f55', vest: '#ff6a1a', helmet: '#fbf7ee', visor: '#1a1d24', css: '#ff7a2e' },
  { name: 'KAI', hull: '#12a8d8', accent: '#0d2c52', suit: '#0d2c52', vest: '#ffd23f', helmet: '#ffd23f', visor: '#10202e', css: '#27b6e6' },
  { name: 'MIRA', hull: '#d5308c', accent: '#1b1b24', suit: '#1b1b24', vest: '#f4f1ea', helmet: '#f4f1ea', visor: '#d5308c', css: '#ee4aa6' },
  { name: 'JUNO', hull: '#8fd128', accent: '#2d3138', suit: '#5c6470', vest: '#8fd128', helmet: '#d63b2f', visor: '#16181d', css: '#a6e03a' },
];
