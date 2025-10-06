'use client';

import * as THREE from 'three';
import { RIM_DEFAULTS } from '@/lib/three-catalog/constants';

const DEFAULT_RIM_COLOR = new THREE.Color(RIM_DEFAULTS.color || '#88ccff');

export function sanitizeColorToThree(input) {
  if (input instanceof THREE.Color) return input.clone();
  try {
    const c = new THREE.Color(input || DEFAULT_RIM_COLOR);
    return c;
  } catch {
    return DEFAULT_RIM_COLOR.clone();
  }
}

const shouldSkipRim = (mat) =>
  typeof mat?.name === 'string' && mat.name.toUpperCase().includes('NORIM');

export const clampRimOpts = (opts = {}) => ({
  color: sanitizeColorToThree(opts.color ?? RIM_DEFAULTS.color),
  intensity: Math.max(0, Number(opts.intensity ?? RIM_DEFAULTS.intensity)),
  power: Math.max(0.001, Number(opts.power ?? RIM_DEFAULTS.power)),
  bias: Math.min(0.99, Math.max(0.0, Number(opts.bias ?? RIM_DEFAULTS.bias))),
  enabled: opts.enabled !== false,
});

export function patchRimOnMaterial(mat, opts = {}) {
  if (!mat || shouldSkipRim(mat)) return;
  if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return;

  const o = clampRimOpts(opts);
  mat.userData._rim = mat.userData._rim || { enabled: false, uniforms: null };
  mat.onBeforeCompile = (shader) => {
    if (
      !shader.fragmentShader.includes('#include <normal_fragment_maps>') ||
      !shader.fragmentShader.includes('#include <emissivemap_fragment>')
    ) {
      return;
    }

    shader.fragmentShader =
      'uniform vec3 rimColor; uniform float rimPower; uniform float rimIntensity; uniform float rimBias;\n' +
      shader.fragmentShader;

    shader.uniforms.rimColor = { value: o.color.clone() };
    shader.uniforms.rimPower = { value: o.power };
    shader.uniforms.rimIntensity = { value: o.intensity };
    shader.uniforms.rimBias = { value: o.bias };

    mat.userData._rim.uniforms = {
      rimColor: shader.uniforms.rimColor,
      rimPower: shader.uniforms.rimPower,
      rimIntensity: shader.uniforms.rimIntensity,
      rimBias: shader.uniforms.rimBias,
    };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec3 V = normalize(-vViewPosition);
       float NoV = abs(dot(normalize(normal), V));
       float rim = 1.0 - NoV;
       rim = clamp((rim - rimBias) / max(1.0 - rimBias, 1e-4), 0.0, 1.0);
       rim = pow(max(rim, 1e-4), rimPower);`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       totalEmissiveRadiance += rimColor * rim * rimIntensity;`
    );
  };

  mat.needsUpdate = true;
  mat.userData._rim.enabled = true;
}

export function unpatchRimOnMaterial(mat) {
  if (!(mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial))) return;
  if (mat.userData._rim?.enabled) {
    mat.onBeforeCompile = undefined;
    mat.userData._rim = { enabled: false, uniforms: null };
    mat.needsUpdate = true;
  }
}

export function updateRimUniformsOnMaterial(mat, opts = {}) {
  const u = mat?.userData?._rim?.uniforms;
  if (!u) return;
  const o = clampRimOpts(opts);
  u.rimColor.value.copy(o.color);
  u.rimPower.value = o.power;
  u.rimIntensity.value = o.intensity;
  u.rimBias.value = o.bias;
}

export function applyRimToObject(root, opts = {}) {
  if (!root) return;
  const o = clampRimOpts(opts);
  root.traverse((obj) => {
    const mesh = obj;
    if (!(mesh && mesh.isMesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat) return;
      if (!o.enabled) {
        unpatchRimOnMaterial(mat);
      } else if ((mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) && !shouldSkipRim(mat)) {
        if (!mat.userData?._rim?.enabled) patchRimOnMaterial(mat, o);
        updateRimUniformsOnMaterial(mat, o);
      }
    });
  });
}

export function applyDefaultRim(root) {
  applyRimToObject(root, RIM_DEFAULTS);
}
