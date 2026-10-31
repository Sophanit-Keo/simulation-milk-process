// How the 3D view's lamps show in each theme (phase 11, D21). In the dark control room every lamp glows: a
// black body lit by its colour, the theme's --ok, --warn or --bad, a little over full strength, so it reads as a
// lit LED against the dimmer plant. There is no bloom pass and no light of its own: the glow is the material's
// emissive colour only. The light theme keeps each lamp as it was, in the colours its module gives.
import * as THREE from 'three';
import { readSceneColor, sceneIsDark, type SceneColorVar } from './theme';

/** A lit lamp's emissive strength in the dark theme. Over 1, the brightest channel saturates and the lamp looks hot. */
export const DARK_LAMP_GLOW = 1.35;
/** A lamp's body in the dark theme: near-black glass, so the emissive colour is all it shows while lit. */
export const DARK_LAMP_BODY_HEX = 0x06090b;

export interface LampPalette<K extends string> {
  /** True while the dark theme shows: the lamps glow (DARK_LAMP_GLOW on DARK_LAMP_BODY_HEX). */
  readonly dark: boolean;
  /** The colour a lamp in state `key` shows now; the palette owns it, so copy it rather than change it. */
  color(key: K): THREE.Color;
  /** Re-reads the theme: the tokens in the dark theme, the light colours given otherwise. Not every frame. */
  applyTheme(): void;
}

/**
 * The colours of one set of lamps: `light` in the light theme, the tokens `dark` names in the dark one. It starts
 * in the light theme without reading the page, so a module builds the same with or without a DOM (unit tests);
 * applyTheme() then reads the theme the page shows.
 */
export function createLampPalette<K extends string>(light: Readonly<Record<K, number>>, dark: Readonly<Record<K, SceneColorVar>>): LampPalette<K> {
  const keys = Object.keys(light) as K[];
  const colors = Object.fromEntries(keys.map((key) => [key, new THREE.Color(light[key])])) as Record<K, THREE.Color>;
  let isDark = false;
  return {
    get dark() {
      return isDark;
    },
    color: (key) => colors[key],
    applyTheme() {
      isDark = sceneIsDark();
      for (const key of keys) {
        if (isDark) colors[key].set(readSceneColor(dark[key]));
        else colors[key].setHex(light[key]);
      }
    },
  };
}

/** Lights `material` as a dark-theme lamp of `color`: a black body glowing at DARK_LAMP_GLOW. */
export function glowInDark(material: THREE.MeshStandardMaterial, color: THREE.Color): void {
  material.color.setHex(DARK_LAMP_BODY_HEX);
  material.emissive.copy(color);
  material.emissiveIntensity = DARK_LAMP_GLOW;
}
