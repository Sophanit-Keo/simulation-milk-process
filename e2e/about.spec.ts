// "About this model" (src/ui/about.ts): the top bar opens a modal with the text of src/data/about.md,
// and while it is open the keys belong to the dialog, not to the sim.
import { expect, test } from './fixtures';
import { railButton, waitForClock } from './helpers';

test('About opens a labelled modal with the About text and closes on Escape or Close, giving focus back', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  // A stage selected first, so Escape flying to the whole plant would show.
  await railButton(page, 4).click();
  const panelTitle = page.getByTestId('panel-title');
  await expect(panelTitle).toHaveText('UHT Treatment');
  const open = page.getByTestId('about');
  const dialog = page.getByRole('dialog', { name: 'About this model' });

  await open.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'When the plant diverts' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'plant.json' })).toHaveAttribute('href', /^https:\/\//);

  // Escape closes the dialog and leaves the selection and camera where they were (no "Whole plant" flight).
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(panelTitle).toHaveText('UHT Treatment');

  await open.click();
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('about-close').click();
  await expect(dialog).toBeHidden();
});

test('while About is open, Space does not pause the sim', async ({ page }) => {
  await page.goto('/');
  await waitForClock(page);
  await page.getByTestId('about').click();
  await expect(page.getByTestId('about-dialog')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('about-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'false');
});
