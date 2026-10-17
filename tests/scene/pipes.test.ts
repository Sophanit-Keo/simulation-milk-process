import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinePoint, LinePointId } from '../../src/contracts';
import { createPipes, TEMP_STOPS, tempColor, type Pipes } from '../../src/scene/pipes';
import { readSceneColor, type SceneColorVar } from '../../src/scene/theme';
import { createSim } from '../../src/sim';
import { plantConfig } from '../helpers/plantConfig';
import { stubTheme } from './browserStubs';

// The pipes are coloured by milk temperature (gate G1): pipes.ts turns the temperatures in snapshot.line
// into a colour per vertex, along plan 08's ramp. Checked without WebGL, on the geometry's colour attribute.

type Line = Record<LinePointId, LinePoint>;

afterEach(() => {
  vi.unstubAllGlobals();
});

const color = (hex: string): THREE.Color => new THREE.Color(hex);

function expectColor(actual: THREE.Color, expected: THREE.Color, what: string): void {
  const got = `#${actual.getHexString()}`;
  const want = `#${expected.getHexString()}`;
  expect(actual.r, `${what}: red of ${got}, expected ${want}`).toBeCloseTo(expected.r, 5);
  expect(actual.g, `${what}: green of ${got}, expected ${want}`).toBeCloseTo(expected.g, 5);
  expect(actual.b, `${what}: blue of ${got}, expected ${want}`).toBeCloseTo(expected.b, 5);
}

describe('tempColor', () => {
  const red = new THREE.Color(1, 0, 0);
  const green = new THREE.Color(0, 1, 0);
  const blue = new THREE.Color(0, 0, 1);
  const stops = [
    { tempC: 4, color: red },
    { tempC: 20, color: green },
    { tempC: 60, color: blue },
  ];
  const at = (tempC: number): THREE.Color => tempColor(tempC, stops, new THREE.Color());

  it('is each stop’s colour at its temperature', () => {
    expectColor(at(4), red, '4 °C');
    expectColor(at(20), green, '20 °C');
    expectColor(at(60), blue, '60 °C');
  });

  it('runs in a straight line between two stops', () => {
    expectColor(at(12), new THREE.Color(0.5, 0.5, 0), '12 °C, half-way from 4 to 20');
    expectColor(at(50), new THREE.Color(0, 0.25, 0.75), '50 °C, three quarters of the way from 20 to 60');
  });

  it('holds the end colours beyond the first and the last stop', () => {
    expectColor(at(-30), red, '-30 °C');
    expectColor(at(3.9), red, '3.9 °C');
    expectColor(at(60.1), blue, '60.1 °C');
    expectColor(at(500), blue, '500 °C');
  });

  it('writes into `out` and returns it', () => {
    const out = new THREE.Color();
    expect(tempColor(30, stops, out)).toBe(out);
  });

  it('has plan 08’s stops, rising: 4, 20, 60, 80 and 140 °C', () => {
    expect(TEMP_STOPS.map((stop) => [stop.tempC, stop.colorVar])).toEqual([
      [4, '--t4'],
      [20, '--t20'],
      [60, '--t60'],
      [80, '--t80'],
      [140, '--t140'],
    ]);
  });
});

describe('createPipes', () => {
  const staticLine = (): Line => structuredClone(createSim(plantConfig).snapshot().line);

  function setUp(): { pipes: Pipes; scene: THREE.Scene; line: Line; theme: Record<string, string> } {
    const theme = stubTheme();
    const scene = new THREE.Scene();
    const pipes = createPipes(scene, new THREE.MeshStandardMaterial());
    const line = staticLine();
    pipes.update(line, 0, false);
    return { pipes, scene, line, theme };
  }

  /** The run's vertices: position and colour. */
  function vertices(scene: THREE.Scene, run: string): { at: THREE.Vector3; color: THREE.Color }[] {
    const mesh = scene.getObjectByName(`pipe-${run}`);
    if (!(mesh instanceof THREE.Mesh)) throw new Error(`no pipe-${run}`);
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    return Array.from({ length: position.count }, (_, i) => ({
      at: new THREE.Vector3().fromBufferAttribute(position, i),
      color: new THREE.Color().fromBufferAttribute(colors, i),
    }));
  }

  /** The vertices of a run's tube and joint ball round one point of its route. */
  function near(scene: THREE.Scene, run: string, pointM: [number, number, number]): THREE.Color[] {
    const found = vertices(scene, run).filter((v) => v.at.distanceTo(new THREE.Vector3(...pointM)) < 0.12);
    expect(found.length, `pipe-${run} has vertices round (${pointM.join(', ')})`).toBeGreaterThan(0);
    return found.map((v) => v.color);
  }

  const stop = (name: SceneColorVar): THREE.Color => color(readSceneColor(name));
  /** The colour pipes.ts should give `tempC`, on the theme's ramp. */
  const ramp = (tempC: number): THREE.Color =>
    tempColor(
      tempC,
      TEMP_STOPS.map((s) => ({ tempC: s.tempC, color: stop(s.colorVar) })),
      new THREE.Color(),
    );

  it('colours each run from the static plant’s temperatures', () => {
    const { pipes, scene, line } = setUp();
    // The plant's set points sit on the ramp's stops: silos at 4 °C, the holding tube at 140 °C, the cooler's outlet at 20 °C.
    expect([line.silo.tempC, line.holdingTube.tempC, line.cooler.tempC]).toEqual([4, 140, 20]);
    for (const { color: c } of vertices(scene, 'silo-manifold')) expectColor(c, stop('--t4'), 'pipe-silo-manifold');
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, stop('--t140'), 'pipe-holding-tube');
    // The product line leaves the divert valve at holding-tube temperature and ends cooled, at the aseptic tank.
    for (const c of near(scene, 'product', [-12.6, 2.5, -14])) expectColor(c, stop('--t140'), 'pipe-product at the divert valve');
    for (const c of near(scene, 'product', [4, 1.6, -14])) expectColor(c, stop('--t20'), 'pipe-product at the aseptic tank');
    // In the preheater the milk is part-way from the feed tank's temperature to the preheater's (47 %).
    const preheatingC = line.feedTank.tempC + 0.47 * (line.preheater.tempC - line.feedTank.tempC);
    for (const c of near(scene, 'feed', [-28.9, 0.5, -14])) expectColor(c, ramp(preheatingC), `pipe-feed in the preheater, ${preheatingC} °C`);
    pipes.dispose();
  });

  it('recolours a run when its temperature changes, and leaves the others', () => {
    const { pipes, scene, line } = setUp();
    const silo = vertices(scene, 'silo-manifold').map((v) => v.color);
    line.holdingTube.tempC = 100;
    pipes.update(line, 0, false);
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, ramp(100), 'pipe-holding-tube at 100 °C');
    expectColor(ramp(100), new THREE.Color().lerpColors(stop('--t80'), stop('--t140'), 20 / 60), 'the ramp at 100 °C');
    for (const c of near(scene, 'product', [-12.6, 2.5, -14])) expectColor(c, ramp(100), 'pipe-product at the divert valve');
    vertices(scene, 'silo-manifold').forEach((v, i) => expectColor(v.color, silo[i], 'pipe-silo-manifold'));
    pipes.dispose();
  });

  it('follows the theme’s temperature colours', () => {
    const { pipes, scene, theme } = setUp();
    theme['--t140'] = '#ff00ff';
    pipes.applyTheme();
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, color('#ff00ff'), 'pipe-holding-tube');
    pipes.dispose();
  });
});
