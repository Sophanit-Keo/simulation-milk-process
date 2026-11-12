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
/** The cup filling room's machines (phase 31), in the order the panel shows them. */
const ROOM_NOTES: readonly string[] = ['p8Denester', 'p8Dosing', 'p8Sealing', 'checkweigher', 'metalDetector', 'visionCheck', 'airUnit', 'cipSip', 'qaBench', 'supplies'];

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
    // Phase 31: Line P8's note, then one for each machine of the cup filling room, closed until asked for.
    expect(notesFor(15).map((note) => note.id)).toEqual(['p8', ...ROOM_NOTES]);
    expect(notesFor(15).filter((note) => note.open).map((note) => note.id)).toEqual(['p8']);
    expect(notesFor(12).every((note) => note.open)).toBe(true);
    expect(notesFor(13)).toEqual([]);
    for (const note of MACHINE_NOTES) {
      expect(Object.keys(NOTE_FACTS[note.id] ?? {}).length, note.id).toBeGreaterThan(ROOM_NOTES.includes(note.id) ? 1 : 3);
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
    const ajar = copy();
    if (ajar.notes[0]) ajar.notes[0].open = 'no';
    expect(() => parseMachineNotes(ajar)).toThrow(/"open" must be true or false/);
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

describe('the cup filling room\'s notes (phase 31)', () => {
  const p8 = Y.p8;

  it('tells of each machine what it does, how it works and what the 3D view shows', () => {
    for (const id of ROOM_NOTES) {
      const note = MACHINE_NOTES.find((each) => each.id === id);
      expect(note?.sections.map((section) => section.heading), id).toEqual(['What it does', 'How it works', 'In the 3D view']);
      expect(note?.stage, id).toBe(15);
    }
    expect(MACHINE_NOTES.find((each) => each.id === 'p8')?.sections.at(-1)?.heading).toBe('In the 3D view');
  });

  it('says what plant.json holds about the de-nester, the filler and the sealing', () => {
    const denester = textOf('p8Denester');
    expect(denester).toContain(`${p8.lanes} magazines`);
    expect(denester).toContain(`${thousands(p8.magazines.cups)} cups, ${(p8.magazines.cups / p8.rateCupsPerH) * 60} min of running`);
    expect(denester).toContain(`under ${p8.magazines.refillBelowFrac * 100}%, which takes ${p8.magazines.refillS / 60} min`);
    const dosing = textOf('p8Dosing');
    expect(dosing).toContain(`declared ${p8.cupG} g`);
    expect(dosing).toContain(`at ${p8.fill.targetG} g`);
    expect(dosing).toContain(`about ${p8.fill.sigmaG} g round the target`);
    const sealing = textOf('p8Sealing');
    expect(sealing).toContain(`${p8.lanes} pre-cut foils`);
    expect(sealing).toContain(`${p8.seal.tempC} °C for ${p8.seal.timeS.toFixed(1)} s at ${p8.seal.bar} bar`);
    expect(sealing).toContain(`${p8.seal.minTempC}–${p8.seal.maxTempC} °C, ${p8.seal.minTimeS}–${p8.seal.maxTimeS} s and ${p8.seal.minBar}–${p8.seal.maxBar} bar`);
    expect(sealing).toContain(`${thousands(p8.magazines.foils)} lids`);
    expect(sealing).toContain(`red over ${p8.seal.maxTempC} °C and dull under ${p8.seal.minTempC} °C`);
  });

  it('says what plant.json holds about the three checks', () => {
    const weigher = textOf('checkweigher');
    expect(weigher).toContain(`under ${p8.fill.underBelowG} g`);
    expect(weigher).toContain(`over ${p8.fill.overAboveG} g`);
    expect(weigher).toContain(`target is ${p8.fill.targetG} g`);
    expect(textOf('metalDetector')).toContain(`about ${p8.metalRejectFrac * 1e6} cups in a million`);
    expect(textOf('visionCheck')).toContain(`About ${p8.visionRejectFrac * 1e6} cups in a million`);
  });

  it('says what plant.json holds about the air, the clean, the seal test and the supplies', () => {
    const air = textOf('airUnit');
    expect(air).toContain(`about ${p8.hepa.normalPa} Pa`);
    expect(air).toContain(`Under ${p8.hepa.minPa} Pa`);
    const cip = textOf('cipSip');
    expect(cip).toContain(`about ${p8.sip.runC} °C`);
    expect(cip).toContain(`at least ${p8.sip.tempC} °C for ${p8.sip.holdS / 60} min`);
    expect(cip).toContain(`under ${p8.atpMaxRlu} RLU`);
    const qa = textOf('qaBench');
    expect(qa).toContain(`Every ${p8.sealTest.everyS / 3600} h of running, ${p8.sealTest.cups} cups`);
    expect(qa).toContain(`the ${p8.sealTest.cups} cups stand`);
    const supplies = textOf('supplies');
    expect(supplies).toContain(`${thousands(p8.rateCupsPerH)} cups`);
    expect(supplies).toContain(`under ${p8.magazines.refillBelowFrac * 100}%`);
    expect(supplies).toContain(`takes ${p8.magazines.refillS / 60} min`);
  });

  it('reads each machine live while P8 runs: the cups set down, the last cup, the checks, the cabin, the supplies', () => {
    const sim = createSim(plantConfig);
    sim.step(0.1);
    run(sim, 120, (each) => each.yogurt.p8.state === 'running');
    const snap = run(sim, 10);
    expect(noteFacts('p8Denester', snap)).toMatchObject({ 'Cups set down': { text: '360 a minute', state: 'ok' }, 'UV-C tunnel': { text: 'Lit', state: 'ok' } });
    expect(noteFacts('p8Denester', snap)?.['Cup magazine']?.text).toMatch(/^\d+ %$/);
    expect(noteFacts('p8Dosing', snap)?.['Feed from the buffer']?.text).toMatch(/^Open · [\d,]+ L in the buffer$/);
    expect(noteFacts('p8Dosing', snap)?.Doses).toEqual({ text: '21,600 an hour', state: 'ok' });
    expect(noteFacts('p8Sealing', snap)).toMatchObject({ Sealing: { text: '200 °C · 1.0 s · 5.0 bar', state: 'ok' }, 'Printed on the lid': { text: 'P8-008-1 · best before day 36', state: 'ok' } });
    expect(noteFacts('checkweigher', snap)).toMatchObject({ Passes: { text: '120.5–135 g' }, 'Under-filled': { text: '0 cups', state: 'ok' }, 'Over-filled': { text: '0 cups', state: 'ok' } });
    expect(noteFacts('metalDetector', snap)).toMatchObject({ Now: { text: 'Searching every cup', state: 'ok' }, 'Thrown out': { text: '0 cups', state: 'ok' } });
    expect(noteFacts('visionCheck', snap)).toMatchObject({ Now: { text: 'Looking at every lid', state: 'ok' } });
    expect(noteFacts('airUnit', snap)).toMatchObject({ Fans: { text: 'Running', state: 'ok' }, 'HEPA cabin': { state: 'ok' } });
    expect(noteFacts('cipSip', snap)).toMatchObject({ Now: { text: 'Standing by', state: 'idle' }, 'Last SIP': { text: 'Passed, day 7', state: 'ok' }, 'ATP swab': { text: '4.0 RLU, must be under 10 RLU', state: 'ok' } });
    expect(noteFacts('qaBench', snap)).toMatchObject({ 'Tests so far': { text: '0 passed · 0 failed', state: 'ok' }, 'Cups held back': { text: '0 cups', state: 'ok' } });
    expect(noteFacts('supplies', snap)).toMatchObject({ Operator: { text: 'At the screen', state: 'ok' } });
  });

  it('sends the operator to the de-nester while the cup magazine is refilled, and stops the air unit\'s fans in a HEPA loss', () => {
    const sim = createSim(plantConfig);
    const low = run(sim, hToS(1), (each) => (each.yogurt.p8.magazines?.cupsPct ?? 100) < p8.magazines.refillBelowFrac * 100);
    expect(noteFacts('supplies', low)).toMatchObject({ Operator: { text: 'At the de-nester, loading cups', state: 'warn' }, 'Cup magazine': { state: 'warn' } });
    expect(noteFacts('p8Denester', low)?.['Cup magazine']?.text).toMatch(/^\d+ % · being refilled$/);
    sim.dispatch({ type: 'triggerScenario', id: 'yogurtHepaLoss' });
    const lost = run(sim, 30);
    expect(noteFacts('airUnit', lost)).toMatchObject({ Fans: { text: 'Stopped', state: 'bad' }, 'HEPA cabin': { state: 'bad' } });
    expect(noteFacts('metalDetector', lost)?.Now).toEqual({ text: 'Standing', state: 'idle' });
  });

  it('reads the clean and the SIP on the skid, and a failed seal test on the QA bench', () => {
    const sim = createSim(plantConfig);
    const cleaning = run(sim, hToS(48), (each) => each.yogurt.p8.state === 'cleaning');
    expect(noteFacts('cipSip', cleaning)?.Now).toEqual({ text: 'Cleaning in place', state: 'warn' });
    // Only a change to set yogurt is followed by a SIP: some days on.
    const sip = run(sim, hToS(24 * 21), (each) => each.yogurt.p8.state === 'sterilizing');
    expect(noteFacts('cipSip', sip)?.Now).toEqual({ text: 'Sterilizing with steam at 123 °C', state: 'warn' });
    const drift = createSim(plantConfig);
    run(drift, 120, (each) => each.yogurt.p8.state === 'running');
    drift.dispatch({ type: 'triggerScenario', id: 'yogurtSealDrift' });
    const failed = run(drift, hToS(6), (each) => (each.yogurt.p8.sealTests?.failed ?? 0) > 0);
    const qa = noteFacts('qaBench', failed);
    expect(qa?.['Tests so far']?.state).toBe('bad');
    expect(qa?.['Cups held back']?.state).toBe('warn');
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
