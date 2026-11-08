// A machine explained in its stage's panel (src/ui/machineNotes.ts, phase 28): the notes of src/data/machineNotes.json,
// the numbers in their text held to plant.json, and their live readings on the sim: the holding cell at the opening,
// in production and in a divert; Line P8 running and stopped by a HEPA loss.
import { describe, expect, it } from 'vitest';
import { hToS, type Sim, type Snapshot } from '../../src/contracts';
import notesJson from '../../src/data/machineNotes.json';
import plantJson from '../../src/data/plant.json';
import { createSim } from '../../src/sim';
import { MACHINE_NOTES, NOTE_FACTS, noteFacts, notesFor, parseMachineNotes } from '../../src/ui/machineNotes';
import { plantConfig } from '../helpers/plantConfig';

const Y = plantJson.yogurt;
const textOf = (id: string): string => (MACHINE_NOTES.find((note) => note.id === id)?.sections ?? []).map((section) => section.text).join(' ');
const thousands = (n: number): string => n.toLocaleString('en-US');

function run(sim: Sim, seconds: number, until?: (snap: Snapshot) => boolean): Snapshot {
  sim.dispatch({ type: 'setSpeed', speed: 1_000 });
  const endS = sim.snapshot().timeS + seconds;
  let snap = sim.snapshot();
  while (snap.timeS < endS && !until?.(snap)) {
    sim.step(0.1);
    snap = sim.snapshot();
  }
  return snap;
}

describe('src/data/machineNotes.json', () => {
  it('explains the holding cell in stage 12\'s panel and Line P8 in stage 15\'s, each with its live readings', () => {
    expect(notesFor(12).map((note) => note.id)).toEqual(['holdingCell']);
    expect(notesFor(15).map((note) => note.id)).toEqual(['p8']);
    expect(notesFor(13)).toEqual([]);
    for (const note of MACHINE_NOTES) {
      expect(Object.keys(NOTE_FACTS[note.id] ?? {}).length, note.id).toBeGreaterThan(3);
      for (const section of note.sections) expect(section.text, `${note.id}: ${section.heading}`).toMatch(/^[A-Z].{40,}[.]$/);
    }
  });

  it('refuses a file with a note twice, without a stage, or with a section that says nothing', () => {
    const copy = () => structuredClone(notesJson) as { notes: Record<string, unknown>[] };
    const twice = copy();
    twice.notes.push({ ...twice.notes[0] });
    expect(() => parseMachineNotes(twice)).toThrow(/appears twice/);
    const nowhere = copy();
    if (nowhere.notes[0]) nowhere.notes[0].stage = 0;
    expect(() => parseMachineNotes(nowhere)).toThrow(/is not a stage/);
    const mute = copy();
    if (mute.notes[1]) mute.notes[1].sections = [{ heading: 'Empty', text: ' ' }];
    expect(() => parseMachineNotes(mute)).toThrow(/needs a heading and its text/);
    expect(() => parseMachineNotes({})).toThrow(/needs a "notes" list/);
  });

  it('says what plant.json holds about the holding cell: its size, its temperature and time, the CCP\'s limits', () => {
    const text = textOf('holdingCell');
    const cellL = (Y.heat.holdS * Y.mix.capacityLph) / 3600;
    expect(text).toContain(`${cellL} L`);
    expect(text).toContain(`${Y.heat.setpointC} °C`);
    expect(text).toContain(`${Y.heat.holdS / 60} min`);
    expect(text).toContain(`${thousands(Y.mix.capacityLph)} L/h`);
    expect(text).toContain(`${Y.heat.divertBelowC} °C`);
    expect(text).toContain(`${Y.heat.minHoldS / 60} min`);
    expect(text).toContain(`${Y.heat.denatTargetPct}%`);
    // The hold limit needs the cell's volume in the limit's time: more than the line pumps (H123).
    expect(text).toContain(`${thousands((cellL * 3600) / Y.heat.minHoldS)} L/h`);
  });

  it('says what plant.json holds about Line P8: its lanes and rate, the fill, the seal, the HEPA cabin, the SIP', () => {
    const text = textOf('p8');
    const p8 = Y.p8;
    expect(text).toContain(`${p8.lanes} lanes`);
    expect(text).toContain(`${p8.rateCupsPerH / p8.lanes / 60} cycles a minute`);
    expect(text).toContain(`${thousands(p8.rateCupsPerH)} cups of ${p8.cupG} g`);
    expect(text).toContain(`${p8.fill.targetG} g`);
    expect(text).toContain(`${p8.seal.tempC} °C for ${p8.seal.timeS.toFixed(1)} s at ${p8.seal.bar} bar`);
    expect(text).toContain(`${p8.seal.minTempC}–${p8.seal.maxTempC} °C, ${p8.seal.minTimeS}–${p8.seal.maxTimeS} s or ${p8.seal.minBar}–${p8.seal.maxBar} bar`);
    expect(text).toContain(`every ${p8.sealTest.everyS / 3600} h of running ${p8.sealTest.cups} cups`);
    expect(text).toContain(`about ${p8.hepa.normalPa} Pa`);
    expect(text).toContain(`Under ${p8.hepa.minPa} Pa`);
    expect(text).toContain(`${p8.sip.tempC} °C for ${p8.sip.holdS / 60} min`);
    expect(text).toContain(`under ${p8.magazines.refillBelowFrac * 100}%`);
  });
});

describe('the notes\' live readings', () => {
  it('as the plant opens: no mix through the holding cell, Line P8 running with its sealing and cabin in their windows', () => {
    const sim = createSim(plantConfig);
    sim.step(0.1);
    run(sim, 120, (each) => each.yogurt.p8.state === 'running');
    const snap = run(sim, 10);
    expect(noteFacts('holdingCell', snap)).toMatchObject({ Held: { text: 'No mix flows', state: 'idle' }, 'The CCP': { text: 'No mix flows', state: 'idle' }, 'Diverts so far': { text: '0', state: 'ok' } });
    const p8 = noteFacts('p8', snap);
    expect(p8).toMatchObject({ Now: { text: 'Running', state: 'ok' }, Speed: { text: '30 cycles a min · 21,600 cups/h', state: 'ok' } });
    expect(p8?.Sealing).toEqual({ text: '200 °C · 1.0 s · 5.0 bar', state: 'ok' });
    expect(p8?.['HEPA cabin']?.state).toBe('ok');
    expect(p8?.['Last cup']?.text).toMatch(/^1\d\d\.\d g, the target 127 g$/);
    expect(p8?.['Next seal test']?.text).toMatch(/^in \d/);
  });

  it('in production: 92 °C at the outlet, held 5 min, 99% of the whey protein denatured, forward', () => {
    const sim = createSim(plantConfig);
    // Once the mix that sat in the cell since the opening has left it: the mix at the outlet then came in at full flow.
    const snap = run(sim, hToS(8), (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0 && each.yogurt.heat.holdS <= Y.heat.holdS);
    const facts = noteFacts('holdingCell', snap);
    expect(facts?.['At the outlet']).toEqual({ text: '92.0 °C, the limit 85 °C', state: 'ok' });
    expect(facts?.Held).toEqual({ text: '5 min 00 s at 6,000 L/h, the limit 3 min', state: 'ok' });
    expect(facts?.['Whey protein denatured']).toEqual({ text: '99.2 %, the target 85 %', state: 'ok' });
    expect(facts?.['The CCP']?.state).toBe('ok');
  });

  it('in a divert: the outlet under the limit and the CCP diverting, red; then the clean, amber, and the divert counted', () => {
    const sim = createSim(plantConfig);
    run(sim, hToS(8), (each) => each.yogurt.heat.mode === 'production' && each.yogurt.heat.flowLph > 0);
    sim.dispatch({ type: 'triggerScenario', id: 'yogurtHeatUnderTemp' });
    const divert = run(sim, 1_800, (each) => each.yogurt.heat.mode === 'divert');
    const facts = noteFacts('holdingCell', divert);
    expect(facts?.['At the outlet']?.state).toBe('bad');
    expect(facts?.['The CCP']).toEqual({ text: 'Diverting to the reprocess tank', state: 'bad' });
    const cleaning = run(sim, 1_800, (each) => each.yogurt.heat.mode === 'cleaning');
    expect(noteFacts('holdingCell', cleaning)?.['The CCP']?.text).toMatch(/^Cleaning after a divert · /);
    expect(noteFacts('holdingCell', cleaning)?.['Diverts so far']).toEqual({ text: '1', state: 'warn' });
  });

  it('with Line P8 stopped by a HEPA loss: why it stopped, and its cabin under the limit, red', () => {
    const sim = createSim(plantConfig);
    run(sim, 120, (each) => each.yogurt.p8.state === 'running');
    sim.dispatch({ type: 'triggerScenario', id: 'yogurtHepaLoss' });
    const snap = run(sim, 30);
    const facts = noteFacts('p8', snap);
    expect(facts?.Now).toEqual({ text: 'Stopped: the HEPA cabin under its limit', state: 'bad' });
    expect(facts?.['HEPA cabin']).toEqual({ text: '+5.0 Pa, the limit +15 Pa', state: 'bad' });
    expect(facts?.Speed?.state).toBe('idle');
  });
});
