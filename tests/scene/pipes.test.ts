import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinePoint, LinePointId } from '../../src/contracts';
import { createPipes, TEMP_STOPS, tempColor, type Pipes } from '../../src/scene/pipes';
import { LAMP_GLOW_HEX, readSceneColor, type SceneColorVar } from '../../src/scene/theme';
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

  /** The colour attribute's version: three.js bumps it each time a run is marked for upload. */
  const colourVersion = (scene: THREE.Scene, run: string): number => {
    const mesh = scene.getObjectByName(`pipe-${run}`) as THREE.Mesh;
    return (mesh.geometry.getAttribute('color') as THREE.BufferAttribute).version;
  };

  it('re-uploads the colours of only the runs whose temperatures moved', () => {
    const { pipes, scene, line } = setUp();
    const versions = (): Record<string, number> =>
      Object.fromEntries(['silo-manifold', 'feed', 'holding-tube', 'product', 'divert', 'filler-a'].map((run) => [run, colourVersion(scene, run)]));
    const before = versions();
    pipes.update(line, 0.016);
    expect(versions(), 'nothing moved: nothing re-uploaded').toEqual(before);
    // The UHT temperature's display noise: the runs carrying the holding-tube temperature, and no others.
    line.holdingTube.tempC = 140.2;
    line.divert.tempC = 140.2;
    pipes.update(line, 0.016);
    const after = versions();
    for (const run of ['feed', 'holding-tube', 'product', 'divert']) expect(after[run], run).toBeGreaterThan(before[run]);
    for (const run of ['silo-manifold', 'filler-a']) expect(after[run], run).toBe(before[run]);
    pipes.dispose();
  });

  it('moves each point’s stripes at a speed proportional to its flow, and holds them at no flow', () => {
    const { pipes, line } = setUp();
    line.silo.flowLph = 16_000;
    line.filler.flowLph = 8_000;
    line.divert.flowLph = 0;
    pipes.update(line, 0.01);
    const { phaseM } = pipes.state();
    // 10,000 L/h moves the stripes 1 m a second.
    expect(phaseM.silo).toBeCloseTo(0.016, 6);
    expect(phaseM.filler).toBeCloseTo(phaseM.silo / 2, 6);
    expect(phaseM.divert).toBe(0);
    // No animation time (paused): nothing moves, whatever the flow.
    pipes.update(line, 0);
    expect(pipes.state().phaseM).toEqual(phaseM);
    pipes.dispose();
  });

  it('moves the stripes at most a quarter of a stripe and gap per frame, so a slow frame at ×10,000 doesn’t strobe', () => {
    const { pipes, line } = setUp();
    line.silo.flowLph = 16_000;
    // 1.6 m/s for 0.3 s of animation time (a 0.1 s frame at ×10,000) would be 0.48 m.
    pipes.update(line, 0.3);
    expect(pipes.state().phaseM.silo).toBeCloseTo(0.7 / 4, 6);
    pipes.dispose();
  });

  it('lights the divert route to the reject tank while diverting, and only that run', () => {
    const { pipes, scene, line } = setUp();
    const material = (run: string): THREE.MeshStandardMaterial =>
      (scene.getObjectByName(`pipe-${run}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(pipes.state().divertLit).toBe(false);
    expect(material('divert').emissiveIntensity).toBe(0);
    pipes.update(line, 0.016, true);
    expect(pipes.state().divertLit).toBe(true);
    expect(material('divert').emissiveIntensity).toBeGreaterThan(0);
    expect(material('divert').emissive.getHex()).toBe(LAMP_GLOW_HEX.bad);
    for (const run of ['feed', 'holding-tube', 'product']) {
      expect(material(run), run).not.toBe(material('divert'));
      expect(material(run).emissive.getHex(), run).toBe(0); // black: no glow
    }
    pipes.update(line, 0.016, false);
    expect(pipes.state().divertLit).toBe(false);
    expect(material('divert').emissiveIntensity).toBe(0);
    pipes.dispose();
  });

  it('while the plant cleans, the CIP circuit and the CIP lines carry the fluid’s colour; milk keeps its own outside the circuit (phase 7)', () => {
    const { pipes, scene, line } = setUp();
    const lye = stop('--clean-lye');
    expect(pipes.state().cleaning).toBeNull();
    for (const run of ['cip-supply', 'cip-return']) for (const { color: c } of vertices(scene, run)) expectColor(c, stop('--steel'), `pipe-${run} idle`);
    pipes.update(line, 0, false, { fluid: 'lye', flowLph: 24_000 });
    expect(pipes.state().cleaning).toBe('lye');
    // In the circuit, from the balance tank to the tee after the cooler.
    for (const c of near(scene, 'feed', [-30.35, 0.5, -14])) expectColor(c, lye, 'pipe-feed at the preheater');
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, lye, 'pipe-holding-tube');
    for (const c of near(scene, 'product', [-9.3, 0.8, -11.6])) expectColor(c, lye, 'pipe-product in the cooler');
    for (const run of ['cip-supply', 'cip-return']) for (const { color: c } of vertices(scene, run)) expectColor(c, lye, `pipe-${run}`);
    // Outside it: the mixing tank's outlet, the aseptic tank's inlet and the divert line still show milk.
    for (const c of near(scene, 'feed', [-42.4, 0.7, -14])) expectColor(c, ramp(line.feedTank.tempC), 'pipe-feed at the mixing tank');
    for (const c of near(scene, 'product', [4, 1.6, -14])) expectColor(c, stop('--t20'), 'pipe-product at the aseptic tank');
    for (const { color: c } of vertices(scene, 'divert')) expectColor(c, ramp(line.divert.tempC), 'pipe-divert');
    // The next step's fluid, then the end of the clean: back to the milk's temperatures, the CIP lines to steel.
    pipes.update(line, 0, false, { fluid: 'acid', flowLph: 24_000 });
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, stop('--clean-acid'), 'pipe-holding-tube in the acid');
    pipes.update(line, 0, false, null);
    expect(pipes.state().cleaning).toBeNull();
    for (const { color: c } of vertices(scene, 'holding-tube')) expectColor(c, stop('--t140'), 'pipe-holding-tube after the clean');
    for (const { color: c } of vertices(scene, 'cip-return')) expectColor(c, stop('--steel'), 'pipe-cip-return after the clean');
    pipes.dispose();
  });

  it('flows the circuit’s stripes at the circulation on a slot of their own while it cleans, and gives the vertices back to their points after', () => {
    const { pipes, scene, line } = setUp();
    const slots = (run: string): number[] => Array.from(((scene.getObjectByName(`pipe-${run}`) as THREE.Mesh).geometry.getAttribute('flowSlot').array as Float32Array));
    const milkSlots = slots('holding-tube');
    for (const id of Object.keys(line) as LinePointId[]) line[id].flowLph = 0; // no milk moves while the plant cleans
    pipes.update(line, 0.01, false, { fluid: 'water', flowLph: 24_000 });
    // 24,000 L/h moves the stripes 2.4 m a second (10,000 L/h is 1 m/s).
    expect(pipes.state().cleanPhaseM).toBeCloseTo(0.024, 6);
    expect(pipes.state().phaseM.holdingTube).toBe(0);
    expect(new Set(slots('holding-tube').filter((slot, i) => slot !== milkSlots[i])).size, 'the tube moved onto one slot').toBe(1);
    expect(slots('silo-manifold').every((slot, i) => slot === slots('silo-manifold')[i])).toBe(true);
    pipes.update(line, 0.01, false, null);
    expect(slots('holding-tube')).toEqual(milkSlots);
    // With no clean the cleaning stripes stand still.
    const still = pipes.state().cleanPhaseM;
    pipes.update(line, 0.01, false, null);
    expect(pipes.state().cleanPhaseM).toBe(still);
    pipes.dispose();
  });

  it('disposes both milk materials and the stripe texture', () => {
    const { pipes, scene } = setUp();
    const disposed = new Set<unknown>();
    const milk = (scene.getObjectByName('pipe-feed') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const divert = (scene.getObjectByName('pipe-divert') as THREE.Mesh).material as THREE.Material;
    for (const item of [milk, divert, milk.map as THREE.Texture]) item.addEventListener('dispose', () => disposed.add(item));
    pipes.dispose();
    expect(disposed.size).toBe(3);
  });
});
