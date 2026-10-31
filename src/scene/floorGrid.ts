// The control-room floor (phase 11, D21): in the dark theme a fine, low-contrast grid on the floor and the zone
// slabs, 2 m cells with a stronger line every 10 m, in the colour of the page's backdrop grid (--grid), and the
// floor's margin fading into the background, so the plant stands on a lit plate in a dark room. The light theme
// keeps its plain floor. Both are a few lines in the floor's and the slabs' own shaders: no draw call, no triangle
// and no texture. The lines are anti-aliased with screen-space derivatives and fade out where a cell grows too
// small on screen, so the far floor never turns to moiré.
import * as THREE from 'three';
import { PLANT_BOUNDS, type RectM } from './layout';
import { readSceneColor, readSceneRgba, sceneIsDark } from './theme';

/** A grid cell, in metres. */
export const GRID_CELL_M = 2;
/** A stronger line every this many cells: every 10 m. */
export const GRID_MAJOR_EVERY = 5;
/** The fine lines are drawn this much fainter than the 10 m ones. */
const MINOR_SHARE = 0.55;
/**
 * The dark grid's strength is --grid's alpha (0.05 for the page's backdrop) times this: the page's grid, drawn on
 * the lit floor.
 */
const DARK_GRID_GAIN = 1;
/** The plate the floor's margin fades from: the plant and this much more. */
const PLATE_MARGIN_M = 2;
/** Over this many metres beyond the plate the floor fades into the background (the floor's margin is 12 m). */
const EDGE_FADE_M = 9;

export interface FloorGrid {
  /**
   * Draws the grid on `material` (the floor's or the zone slabs'); with `fadeEdges`, the floor's margin fades into
   * the background too. Call it before the material first renders.
   */
  add(material: THREE.MeshStandardMaterial, options?: { fadeEdges?: boolean }): void;
  /** Re-reads the theme: the grid's colour and strength, and the background the margin fades to. */
  applyTheme(): void;
  /** For tests: whether the grid shows, its strength, and whether the floor's margin fades. */
  state(): { strength: number; edgeFade: number };
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vFloorGridM;`;
const VERTEX_BODY = /* glsl */ `
	vFloorGridM = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vFloorGridM;
uniform vec3 floorGridColor;
uniform float floorGridStrength;
uniform float floorGridCellM;
uniform float floorGridMajorEvery;
uniform float floorGridMinorShare;
uniform vec4 floorPlateM;
uniform float floorEdgeFadeM;
uniform float floorEdgeFade;
uniform vec3 floorFadeColor;
// 1 on a line a pixel or so wide, 0 off it; fading out as a cell shrinks below about 8 px on screen.
float floorGridLines( vec2 cells ) {
	vec2 cellsPerPx = fwidth( cells );
	vec2 offPx = abs( fract( cells - 0.5 ) - 0.5 ) / max( cellsPerPx, vec2( 1e-4 ) );
	float line = 1.0 - min( min( offPx.x, offPx.y ), 1.0 );
	return line * ( 1.0 - smoothstep( 0.12, 0.35, max( cellsPerPx.x, cellsPerPx.y ) ) );
}`;
const FRAGMENT_GRID = /* glsl */ `
	vec2 floorCells = vFloorGridM.xz / floorGridCellM;
	float floorGrid = max( floorGridLines( floorCells ) * floorGridMinorShare, floorGridLines( floorCells / floorGridMajorEvery ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, floorGridColor, floorGrid * floorGridStrength );`;
const FRAGMENT_EDGE = /* glsl */ `
	vec2 floorBeyond = max( max( floorPlateM.xy - vFloorGridM.xz, vFloorGridM.xz - floorPlateM.zw ), vec2( 0.0 ) );
	outgoingLight = mix( outgoingLight, floorFadeColor, floorEdgeFade * smoothstep( 0.0, floorEdgeFadeM, length( floorBeyond ) ) );`;

export function createFloorGrid(plant: RectM = PLANT_BOUNDS): FloorGrid {
  // One set of uniforms for every material the grid is on, so a theme change reaches them all at once.
  const uniforms = {
    floorGridColor: { value: new THREE.Color() },
    floorGridStrength: { value: 0 },
    floorGridCellM: { value: GRID_CELL_M },
    floorGridMajorEvery: { value: GRID_MAJOR_EVERY },
    floorGridMinorShare: { value: MINOR_SHARE },
    floorPlateM: {
      value: new THREE.Vector4(plant.xMinM - PLATE_MARGIN_M, plant.zMinM - PLATE_MARGIN_M, plant.xMaxM + PLATE_MARGIN_M, plant.zMaxM + PLATE_MARGIN_M),
    },
    floorEdgeFadeM: { value: EDGE_FADE_M },
    floorEdgeFade: { value: 0 },
    floorFadeColor: { value: new THREE.Color() },
  };

  return {
    add(material, { fadeEdges = false } = {}) {
      material.customProgramCacheKey = () => (fadeEdges ? 'floor-grid-edge' : 'floor-grid');
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
          .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_BODY}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`)
          .replace('#include <color_fragment>', `#include <color_fragment>${FRAGMENT_GRID}`);
        if (fadeEdges) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `${FRAGMENT_EDGE}\n\t#include <opaque_fragment>`);
      };
    },
    applyTheme() {
      const dark = sceneIsDark();
      const alpha = readSceneRgba('--grid', uniforms.floorGridColor.value);
      uniforms.floorGridStrength.value = dark ? Math.min(1, alpha * DARK_GRID_GAIN) : 0;
      uniforms.floorEdgeFade.value = dark ? 1 : 0;
      uniforms.floorFadeColor.value.set(readSceneColor('--scene-bg'));
    },
    state: () => ({ strength: uniforms.floorGridStrength.value, edgeFade: uniforms.floorEdgeFade.value }),
  };
}
