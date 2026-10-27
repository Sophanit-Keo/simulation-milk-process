import { expect, test } from './fixtures';
import { clockTimeS, waitForClock } from './helpers';

// The app's loading note and error state (src/ui/appStatus.ts, phase 6): "Loading the plant…" shows until
// the first frame is drawn; a frame that throws stops the loop, and the view says the simulation stopped,
// with the error and a Reload button that starts the plant again.

test('the loading note goes once the plant is drawn', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  await expect(page.getByTestId('loading')).toBeHidden();
  await expect(page.getByTestId('app-stopped')).toHaveCount(0);
});

test('a frame that throws stops the clock, and the view says why and offers a reload', async ({ page, pageProblems }) => {
  // WebGL drawing that fails on request, from outside the app: the next frame's render throws.
  await page.addInitScript(() => {
    const broken = () => (window as unknown as { breakDrawing?: boolean }).breakDrawing === true;
    const proto = WebGL2RenderingContext.prototype;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const draw = proto[name] as (...args: unknown[]) => void;
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value(this: WebGL2RenderingContext, ...args: unknown[]) {
          if (broken()) throw new Error('test: drawing failed');
          return draw.apply(this, args);
        },
      });
    }
  });
  await page.goto('/');
  await waitForClock(page);
  await page.evaluate(() => ((window as unknown as { breakDrawing: boolean }).breakDrawing = true));

  const stopped = page.getByTestId('app-stopped');
  await expect(stopped).toBeVisible();
  await expect(stopped.getByRole('heading')).toHaveText('The simulation stopped');
  await expect(stopped.locator('.stopped-error')).toHaveText('test: drawing failed');
  await expect(stopped.getByRole('button', { name: 'Reload' })).toBeFocused();
  // The loop stopped with the frame: the clock no longer moves.
  const stoppedS = await clockTimeS(page);
  await page.waitForTimeout(1_000);
  expect(await clockTimeS(page)).toBe(stoppedS);
  // The thrown error is the one problem on the page; the test caused it, so it is cleared here.
  expect(pageProblems).toEqual(['uncaught: test: drawing failed']);
  pageProblems.length = 0;

  // Reload loads a fresh page, where drawing works again.
  await stopped.getByRole('button', { name: 'Reload' }).click();
  await waitForClock(page);
  await expect(page.getByTestId('loading')).toBeHidden();
  await expect(page.getByTestId('app-stopped')).toHaveCount(0);
});
