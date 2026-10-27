// The app's loading note and its error state (phase 6, ui). index.html shows "Loading the plant…" over the 3D
// view while the scripts load and the first frame is drawn; main.ts hides it once that frame is on screen. If
// the app fails to start, or a frame throws, the frame loop stops: the view then says the simulation stopped,
// shows the error's message, and offers a reload, rather than leaving a frozen plant with no word of why.
import { el } from './dom';

/** Hides index.html's loading note (#loading); safe to call every frame. */
export function hideLoading(): void {
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading && !loading.hidden) loading.hidden = true;
}

/** The error's own words, without a stack: what an Error says, or the thrown value as text. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Shows that the simulation stopped, over the 3D view (or the page, if the view is missing): a title, the
 * error's message and a Reload button. Only the first call shows anything; a later error leaves it as it is.
 */
export function showStopped(error: unknown): void {
  hideLoading();
  if (document.querySelector('[data-testid="app-stopped"]')) return;
  const box = el('section', 'overlay overlay-stopped');
  box.dataset.testid = 'app-stopped';
  box.setAttribute('role', 'alert');
  const title = el('h2', '', 'The simulation stopped');
  const message = el('p', 'stopped-error', errorText(error));
  const hint = el('p', '', 'Reload the page to start again; the plant opens fresh on day 8 at 06:00.');
  const reload = el('button', 'btn', 'Reload');
  reload.type = 'button';
  reload.addEventListener('click', () => location.reload());
  box.append(title, message, hint, reload);
  (document.querySelector('.view') ?? document.body).append(box);
  reload.focus();
}
