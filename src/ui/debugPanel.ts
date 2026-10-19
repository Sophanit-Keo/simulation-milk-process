// The ?debug panel (plan 07: lil-gui, "floating panel to change set points live"). main.ts loads this
// module with import() only when the URL has ?debug, so lil-gui stays out of the main bundle.
import GUI, { type Controller } from 'lil-gui';
import { SPEEDS, type Command, type SetpointKey, type Snapshot, type Speed } from '../contracts';
import { formatDuration, formatNumber, formatSimTime, formatSpeed } from './format';
import { uhtModeText } from './liquidRows';
import { SETPOINT_SLIDERS } from './setpointSlider';

export interface DebugPanel {
  update(snapshot: Snapshot): void;
  dispose(): void;
}

/** The filler rate has no panel slider until phase 4; its range here is the machine's (plant.json maxRatePacksPerH). */
const FILLER_RATE = { min: 0, max: 8_000, step: 100 } as const;

/**
 * A lil-gui panel at the top right, closed until opened: set points, speed and pause, and read-outs of
 * the clock, the UHT plant and the aseptic tank. Set points go out when a drag ends (onFinishChange), as
 * the panel sliders do. Read-outs refresh with the HUD, not per frame. The page's own controls stay the
 * real ones; this is for poking at the model while building it.
 */
export function createDebugPanel(
  dispatch: (command: Command) => void,
  sentSetpoints: () => Partial<Record<SetpointKey, number>>,
): DebugPanel {
  const gui = new GUI({ title: 'Debug (?debug)', width: 260 });
  gui.domElement.dataset.testid = 'debug-panel';
  gui.close();

  const setpointFolder = gui.addFolder('Set points');
  const sent = sentSetpoints();
  const values: Record<SetpointKey, number> = {
    uhtSetpointC: sent.uhtSetpointC ?? 140,
    homogenizerStage1Bar: sent.homogenizerStage1Bar ?? 200,
    fillerRatePacksPerH: sent.fillerRatePacksPerH ?? 7_500,
  };
  const setpointControls: Controller[] = [];
  for (const spec of Object.values(SETPOINT_SLIDERS)) {
    setpointControls.push(
      setpointFolder
        .add(values, spec.key, spec.min, spec.max, spec.step)
        .name(`${spec.label} (${spec.unit})`)
        .onFinishChange((value: number) => dispatch({ type: 'setSetpoint', key: spec.key, value })),
    );
  }
  setpointControls.push(
    setpointFolder
      .add(values, 'fillerRatePacksPerH', FILLER_RATE.min, FILLER_RATE.max, FILLER_RATE.step)
      .name('Filler rate (packs/h)')
      .onFinishChange((value: number) => dispatch({ type: 'setSetpoint', key: 'fillerRatePacksPerH', value })),
  );

  const clockFolder = gui.addFolder('Clock');
  const clock = { speed: 10 as Speed, paused: false };
  const speedControl = clockFolder
    .add(clock, 'speed', Object.fromEntries(SPEEDS.map((speed) => [formatSpeed(speed), speed])))
    .name('Speed')
    .onChange((speed: Speed) => dispatch({ type: 'setSpeed', speed }));
  const pausedControl = clockFolder
    .add(clock, 'paused')
    .name('Paused')
    .onChange((paused: boolean) => dispatch({ type: 'pause', paused }));

  const readFolder = gui.addFolder('Read-outs');
  const read = { time: '', mode: '', margin: '', bStar: '', tank: '', diverts: '' };
  const readControls = [
    readFolder.add(read, 'time').name('Sim time'),
    readFolder.add(read, 'mode').name('UHT plant'),
    readFolder.add(read, 'margin').name('Over divert limit'),
    readFolder.add(read, 'bStar').name('B* / F0'),
    readFolder.add(read, 'tank').name('Aseptic tank'),
    readFolder.add(read, 'diverts').name('Diverts'),
  ].map((control) => control.disable());

  return {
    update(snapshot) {
      const uht = snapshot.stages[4]?.values ?? {};
      const { liquid } = snapshot;
      read.time = formatSimTime(snapshot.timeS);
      read.mode = `${uhtModeText(liquid).text}${liquid.throttled ? ', throttled' : ''}`;
      read.margin = `${formatNumber((uht.tempC ?? Number.NaN) - (uht.divertLimitC ?? Number.NaN), 2)} °C`;
      read.bStar = `${formatNumber(snapshot.kpis.bStar, 2)} / ${formatNumber(snapshot.kpis.f0Min, 2)} min`;
      const tank = liquid.tanks.asepticTank;
      read.tank = `${formatNumber(tank.levelL)} of ${formatNumber(tank.capacityL)} L`;
      read.diverts = `${formatNumber(liquid.divertCount)}, next clean in ${formatDuration(snapshot.stages[6]?.values.nextCleanS ?? Number.NaN)}`;
      for (const control of readControls) control.updateDisplay();
      // Follow the sim where the page's own controls changed it.
      if (clock.speed !== snapshot.speed || clock.paused !== snapshot.paused) {
        clock.speed = snapshot.speed;
        clock.paused = snapshot.paused;
        speedControl.updateDisplay();
        pausedControl.updateDisplay();
      }
      // The set points as the sim reports them (the UHT one) or as last sent from anywhere on the page.
      if (!gui.domElement.contains(document.activeElement)) {
        const now = { ...sentSetpoints(), ...(uht.setpointC === undefined ? {} : { uhtSetpointC: uht.setpointC }) };
        let changed = false;
        for (const key of Object.keys(values) as SetpointKey[]) {
          const value = now[key];
          if (value !== undefined && value !== values[key]) {
            values[key] = value;
            changed = true;
          }
        }
        if (changed) for (const control of setpointControls) control.updateDisplay();
      }
    },
    dispose() {
      gui.destroy();
    },
  };
}
