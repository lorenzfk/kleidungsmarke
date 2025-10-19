// lib/three-catalog/constants.js

export const DEFAULT_CAM_POS = { x: 0, y: 0, z: 3 };

export const SECTION_CAM_POS = {
  about:   { x: 0.0, y: 0.82, z: 2.80 },
  legal:   { x: 0.00, y: 0.82, z: 2.80 },
  default: { x: 0.00, y: 0.12, z: 2.80 },
};

export const OBJECT_PLANE_Z = 0.6;
export const BG_Z = -0.6;

export const BG_URL = process.env.NEXT_PUBLIC_BG_MODEL_URL || '/SHOP.glb';
export const ENV_URL = process.env.NEXT_PUBLIC_ENV_URL || '';
export const BARTOP_EXTRA = Number.parseFloat(process.env.NEXT_PUBLIC_BARTOP_EXTRA || '0.8');

export const TOPSTUFF_SCALE = {
  minWidth: 500,
  maxWidth: 1000,
  minScale: 0.6,
  maxScale: 1.0,
};

export const SPECIAL_HANDLE = 'special';
export const SPECIAL_MODEL_URL = process.env.NEXT_PUBLIC_SPECIAL_MODEL_URL || '/SPECIAL.glb';
export const SPECIAL_TITLE_FALLBACK = 'Special';

export const RIM_DEFAULTS = {
  enabled: false,
  color: '#ffffff',
  intensity: 1.0,
  power: 5.0,
  bias: 0.5,
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
