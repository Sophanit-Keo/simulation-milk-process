// The Factory board's page (factory.html, phase 9, D19): the real factory's UHT plants and lines, live from
// Let Report. Signed out, it shows the sign-in form. Signed in, it reads everything from Let Report, builds
// the view (model.ts) and draws it (board.ts); it reloads everything after each change Let Report's socket
// reports (a burst brings one reload) and every POLL_MS whatever the socket does, and once a second it
// rebuilds the view from the last data at the new time, so the CIP and lot clocks move without a reload.
// No three.js here: the page imports nothing from the 3D app but its DOM helpers, formats and styles.
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/factory.css';
import letReport from '../data/letReport.json';
import { clockTime, createBoard, type LiveInfo } from './board';
import { buildFactory } from './model';
import { createFactoryClient } from './supabase';
import { POLL_MS, type ClientErrorLike, type FactoryData, type Session } from './types';

/** Change events come in bursts (a save in Let Report can touch several rows): one reload this long after the first. */
const RELOAD_DELAY_MS = 300;
/** The CIP and lot clocks, and the live state, move on once a second. */
const TICK_MS = 1000;

const SESSION_ENDED = 'Your session has ended. Sign in again.';
const POLL_S = POLL_MS / 1000;

/** A ClientError from supabase.ts, known by its shape (types.ts), not its class. */
function isClientError(error: unknown): error is ClientErrorLike {
  return error instanceof Error && typeof (error as Partial<ClientErrorLike>).status === 'number';
}

function signInMessage(error: unknown): string {
  if (!isClientError(error)) return 'Sign-in failed. Try again.';
  if (error.status === 0) return 'No connection to Let Report. Check the network and try again.';
  if (error.code === 'email_not_confirmed') return 'This email is not confirmed in Let Report yet.';
  if (error.status === 400 || error.status === 401 || error.status === 422) return 'Wrong email or password.';
  if (error.status === 429) return 'Too many tries. Wait a minute and try again.';
  return `Let Report could not sign you in (error ${error.status}). Try again.`;
}

function loadMessage(error: unknown, loadedMs: number | null): string {
  const why = !isClientError(error)
    ? 'Could not read the factory from Let Report.'
    : error.status === 0
      ? 'No connection to Let Report.'
      : `Let Report answered with error ${error.status}.`;
  const retry = `Trying again every ${POLL_S} s.`;
  return loadedMs === null ? `${why} ${retry}` : `${why} Showing what it said at ${clockTime(loadedMs)}. ${retry}`;
}

interface Watch {
  stop(): void;
}

function start(): void {
  const root = document.querySelector<HTMLElement>('#factory');
  if (!root) throw new Error('factory.html must contain #factory');

  const client = createFactoryClient({ supabaseUrl: letReport.supabaseUrl, publishableKey: letReport.publishableKey });
  const board = createBoard(root, { appUrl: letReport.appUrl, onSignIn: signIn, onSignOut: signOut });

  /** The timers and the socket while signed in; null while signed out. */
  let current: Watch | null = null;

  function end(): void {
    current?.stop();
    current = null;
  }

  /** A 401, or a refresh that failed: back to the form, saying why. */
  function sessionEnded(): void {
    if (!current) return;
    end();
    board.showSignIn(SESSION_ENDED);
  }

  function signIn(email: string, password: string): void {
    board.setSignInBusy(true);
    client.signIn(email, password).then(
      (session) => {
        if (!current) watch(session);
      },
      (error: unknown) => {
        if (!current) board.setSignInError(signInMessage(error));
      },
    );
  }

  function signOut(): void {
    // Stopped first, so the client's onSession(null) finds nothing running and the form shows no message.
    end();
    board.showSignIn();
    // The client forgets the session even when Let Report can't be told.
    client.signOut().catch(() => undefined);
  }

  function watch(session: Session): void {
    board.showBoard(session.email);
    const abort = new AbortController();
    /** Set by stop(): a load or a timer that comes back after it changes nothing. */
    let stopped = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    const live: LiveInfo = { state: null, sinceMs: Date.now(), everLive: false, lastChangeMs: null };
    let data: FactoryData | null = null;
    let dataKey = '';
    let loadedMs: number | null = null;
    let loading = false;
    let loadAgain = false;
    /** A change event came since the last load, so a load with new data is not a change of its own. */
    let changeSeen = false;

    const showLive = (): void => board.setLive(live, Date.now());

    function draw(): void {
      if (!data) return;
      try {
        board.render(buildFactory(data, Date.now()));
      } catch (error) {
        console.error(error);
        board.setLoadError('The board could not draw what Let Report holds.');
      }
    }

    async function reload(): Promise<void> {
      if (loading) {
        loadAgain = true;
        return;
      }
      loading = true;
      try {
        const next = await client.load();
        if (stopped) return;
        const key = JSON.stringify(next);
        // A poll that finds new data the socket did not report is a change too.
        if (data !== null && key !== dataKey && !changeSeen) {
          live.lastChangeMs = Date.now();
          showLive();
        }
        changeSeen = false;
        data = next;
        dataKey = key;
        loadedMs = Date.now();
        board.setLoadError(null);
        draw();
      } catch (error) {
        if (stopped) return;
        if (isClientError(error) && error.status === 401) {
          // The client signs out on a 401 too; whichever comes first shows the form, the other finds it shown.
          sessionEnded();
          return;
        }
        board.setLoadError(loadMessage(error, loadedMs));
      } finally {
        loading = false;
        if (loadAgain && !stopped) {
          loadAgain = false;
          void reload();
        }
      }
    }

    function reloadSoon(): void {
      if (reloadTimer !== undefined || stopped) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        void reload();
      }, RELOAD_DELAY_MS);
    }

    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = client.subscribe({
        onChange() {
          live.lastChangeMs = Date.now();
          changeSeen = true;
          showLive();
          reloadSoon();
        },
        onState(state) {
          if (state !== live.state) {
            // Back live after a drop: changes made meanwhile came with no event, so read everything again.
            if (state === 'live' && live.everLive) reloadSoon();
            live.state = state;
            live.sinceMs = Date.now();
          }
          if (state === 'live') live.everLive = true;
          showLive();
        },
      });
    } catch (error) {
      // No socket (no WebSocket in this browser, say): the poll alone keeps the board up to date.
      console.error(error);
      live.state = 'offline';
      live.sinceMs = Date.now();
    }

    const pollTimer = setInterval(() => void reload(), POLL_MS);
    const tickTimer = setInterval(() => {
      draw();
      showLive();
    }, TICK_MS);
    // A background tab's timers slow down; catch up as soon as it shows again, or the network comes back.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') void reload();
      },
      { signal: abort.signal },
    );
    window.addEventListener('online', () => void reload(), { signal: abort.signal });

    current = {
      stop() {
        stopped = true;
        clearTimeout(reloadTimer);
        clearInterval(pollTimer);
        clearInterval(tickTimer);
        abort.abort();
        unsubscribe();
      },
    };
    showLive();
    void reload();
  }

  client.onSession((session) => {
    if (session) {
      if (current) board.setUser(session.email);
      else watch(session);
    } else {
      sessionEnded();
    }
  });

  const session = client.session();
  if (session) watch(session);
  else board.showSignIn();
}

start();
