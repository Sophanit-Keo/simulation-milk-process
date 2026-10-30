// The Factory board's page (factory.html, phase 9, D19): the real factory's UHT plants and lines, live from
// Let Report. Signed out, it shows the sign-in form. Signed in, it reads everything from Let Report, builds
// the view (model.ts) and draws it (board.ts); it reloads everything after each change Let Report's socket
// reports (a burst brings one reload) and every POLL_MS whatever the socket does, and once a second it
// rebuilds the view from the last data at the new time, so the CIP and lot clocks move without a reload.
// No three.js here: the page imports nothing from the 3D app but its DOM helpers, formats and styles.
//
// Phase 10 (D20): the 3D view. Picking 3D in the header (or opening factory.html#3d) loads the floor,
// src/factory/scene/, by import() the first time, so three.js comes only then, in chunks of its own. The floor
// draws each view the board draws, and what one picks the other marks.
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/factory.css';
import letReport from '../data/letReport.json';
import { clockTime, createBoard, type LiveInfo } from './board';
import { buildFactory } from './model';
import { createFactoryClient } from './supabase';
import {
  POLL_MS,
  type ClientErrorLike,
  type FactoryData,
  type FactoryScene,
  type FactorySelection,
  type FactoryView,
  type FactoryViewMode,
  type Session,
} from './types';

/** Change events come in bursts (a save in Let Report can touch several rows): one reload this long after the first. */
const RELOAD_DELAY_MS = 300;
/** The CIP and lot clocks, and the live state, move on once a second. */
const TICK_MS = 1000;

const SESSION_ENDED = 'Your session has ended. Sign in again.';
const POLL_S = POLL_MS / 1000;

/** The 3D view's place in the address (D20): factory.html#3d opens it. */
const HASH_3D = '#3d';
const modeOf = (hash: string): FactoryViewMode => (hash === HASH_3D ? '3d' : 'board');
const SCENE_FAILED = 'The 3D view could not load. Reload the page to try again; the cards still show the factory.';

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
  /** The board, or the cards beside the 3D floor. */
  setMode(mode: FactoryViewMode): void;
  /** "Show in 3D" on a card or a row. */
  locate(selection: FactorySelection): void;
}

function start(): void {
  const root = document.querySelector<HTMLElement>('#factory');
  if (!root) throw new Error('factory.html must contain #factory');

  const params = new URLSearchParams(location.search);
  const client = createFactoryClient({ supabaseUrl: letReport.supabaseUrl, publishableKey: letReport.publishableKey });
  const board = createBoard(root, { appUrl: letReport.appUrl, onSignIn: signIn, onSignOut: signOut, onView: setMode, onLocate: locate });
  let mode = modeOf(location.hash);
  board.setView(mode);

  /** The timers and the socket while signed in; null while signed out. */
  let current: Watch | null = null;

  function end(): void {
    current?.stop();
    current = null;
  }

  function applyMode(next: FactoryViewMode): void {
    mode = next;
    board.setView(mode);
    current?.setMode(mode);
  }

  /** The switch in the header: the address follows, without a step in the history, so Back still leaves the page. */
  function setMode(next: FactoryViewMode): void {
    if (next !== mode) history.replaceState(history.state, '', next === '3d' ? HASH_3D : `${location.pathname}${location.search}`);
    applyMode(next);
  }
  window.addEventListener('hashchange', () => applyMode(modeOf(location.hash)));

  function locate(selection: FactorySelection): void {
    current?.locate(selection);
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

    // The 3D floor (phase 10): loaded the first time the 3D view shows, then kept until signing out.
    let scene: FactoryScene | null = null;
    let sceneLoading = false;
    let sceneFailed = false;
    let lastView: FactoryView | null = null;
    let selection: FactorySelection | null = null;
    const sceneShows = (): boolean => mode === '3d' && document.visibilityState === 'visible';

    const showLive = (): void => board.setLive(live, Date.now());

    /** The floor draws the board's view; a fault there is reported once and leaves the cards alone. */
    function drawScene(view: FactoryView): void {
      if (!scene || sceneFailed) return;
      try {
        scene.render(view);
      } catch (error) {
        sceneFailed = true;
        console.error(error);
        showSceneMessage('The 3D view could not draw what Let Report holds; the cards still show it.');
      }
    }

    function showSceneMessage(text: string): void {
      const note = document.createElement('p');
      note.className = 'fs-empty';
      note.dataset.testid = 'scene-error';
      note.textContent = text;
      board.viewport.append(note);
    }

    function openScene(): void {
      if (scene || sceneLoading) return;
      sceneLoading = true;
      import('./scene/scene').then(
        ({ createFactoryScene }) => {
          sceneLoading = false;
          if (stopped) return;
          scene = createFactoryScene(board.viewport, {
            heroModels: !params.has('greybox'),
            onSelect(next) {
              selection = next;
              board.setSelection(next, true);
            },
          });
          if (lastView) drawScene(lastView);
          if (selection) scene.select(selection);
          scene.setActive(sceneShows());
        },
        (error: unknown) => {
          // A chunk that did not arrive (offline, a new deploy): the next switch to 3D tries again.
          sceneLoading = false;
          console.error(error);
          if (!stopped && !board.viewport.querySelector('[data-testid="scene-error"]')) showSceneMessage(SCENE_FAILED);
        },
      );
    }

    function draw(): void {
      if (!data) return;
      let view: FactoryView;
      try {
        view = buildFactory(data, Date.now());
        board.render(view);
      } catch (error) {
        console.error(error);
        board.setLoadError('The board could not draw what Let Report holds.');
        return;
      }
      lastView = view;
      drawScene(view);
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
        scene?.setActive(sceneShows());
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
        scene?.dispose();
        scene = null;
        board.viewport.querySelector('[data-testid="scene-error"]')?.remove();
      },
      setMode(next) {
        if (next === '3d') openScene();
        scene?.setActive(sceneShows());
      },
      locate(next) {
        selection = next;
        board.setSelection(next);
        scene?.select(next);
      },
    };
    showLive();
    current.setMode(mode);
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
