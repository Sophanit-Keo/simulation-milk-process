// The Factory board's DOM (phase 9, D19): the header with the live state and who is signed in, the sign-in
// form, and one card per UHT with its draw bar and a row per line, plus the lines no UHT claims. It draws a
// FactoryView (model.ts) and nothing of its own. Every update writes the DOM only where a text or attribute
// changed (setText, setAttr), so the clock tick each second leaves the rest of the page alone; a card's rows
// are rebuilt only when its lines change (another line joins or leaves, or the order changes).
//
// Phase 10 (D20) adds the 3D view: a Board / 3D switch in the header, the viewport the floor is drawn in
// (src/factory/scene/, which main.ts loads), beside the cards in 3D, and a "Show in 3D" button on each card
// and row there. What the floor or a button picks is marked on its card or row.
import type { Status } from '../contracts';
import { createLamp, el, setAttr, setLamp, setText } from '../ui/dom';
import { formatDuration, formatNumber } from '../ui/format';
import { POLL_MS, type FactorySelection, type FactoryView, type FactoryViewMode, type LineView, type LiveState, type UhtView } from './types';

// ───── Texts (pure, so tests can call them) ─────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A wall-clock time in the viewer's time zone, e.g. "14:02:11". */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** What the page knows about the live connection, for the live state's text. */
export interface LiveInfo {
  /** null before the socket has said anything. */
  state: LiveState | null;
  /** When the state last changed (Date.now() ms). */
  sinceMs: number;
  /** The socket has been live at least once this session, so a drop reads "Reconnecting…". */
  everLive: boolean;
  /** When the board last saw Let Report change; null before the first change. */
  lastChangeMs: number | null;
}

const POLL_TEXT = `Updating every ${formatNumber(POLL_MS / 1000)} s`;

/**
 * The live state: "Live · last change 14:02:11" while the socket is joined ("Live" before any change),
 * "Reconnecting…" while it reconnects ("Connecting…" the first time), and "Updating every 15 s" once it is
 * stopped or has been reconnecting for longer than a poll, when only the poll brings changes.
 */
export function liveText(info: LiveInfo, nowMs: number): string {
  if (info.state === 'live') return info.lastChangeMs === null ? 'Live' : `Live · last change ${clockTime(info.lastChangeMs)}`;
  if (info.state === 'offline' || nowMs - info.sinceMs > POLL_MS) return POLL_TEXT;
  return info.everLive ? 'Reconnecting…' : 'Connecting…';
}

const LIVE_LAMP: Readonly<Record<LiveState, Status>> = { live: 'ok', connecting: 'warn', offline: 'idle' };

/** Let Report's severities, 0 to 3. */
const SEVERITY = ['low', 'medium', 'high', 'critical'] as const;

/** The filler and its speed: "A3/Speed · 24,000 packs/h · 100 ml", saying which part Let Report leaves out. */
export function fillerText(line: Pick<LineView, 'filler' | 'packsPerH' | 'packMl'>): string {
  if (!line.filler && line.packsPerH === null && line.packMl === null) return 'Filler not set in Let Report';
  return [
    line.filler || 'filler not set',
    line.packsPerH === null ? 'speed not set' : `${formatNumber(line.packsPerH)} packs/h`,
    line.packMl === null ? 'pack size not set' : `${formatNumber(line.packMl)} ml`,
  ].join(' · ');
}

/** "Whole milk 1 L · lot L2410-03"; '' with neither. */
export function productText(line: Pick<LineView, 'product' | 'lot'>): string {
  return [line.product, line.lot ? `lot ${line.lot}` : ''].filter(Boolean).join(' · ');
}

/** "Output 42 of 100", or "Output 42" with no target. */
export function outputText(line: Pick<LineView, 'qty' | 'target'>): string {
  return line.target > 0 ? `Output ${formatNumber(line.qty)} of ${formatNumber(line.target)}` : `Output ${formatNumber(line.qty)}`;
}

/** "2 open troubles · high"; '' with none. The severity is in words, so the colour is never the only cue. */
export function troublesText(line: Pick<LineView, 'openTroubles' | 'worstSev'>): string {
  if (line.openTroubles <= 0) return '';
  const count = `${formatNumber(line.openTroubles)} open trouble${line.openTroubles === 1 ? '' : 's'}`;
  const severity = line.worstSev === null ? undefined : SEVERITY[Math.min(3, Math.max(0, Math.round(line.worstSev)))];
  return severity ? `${count} · ${severity}` : count;
}

/** "4 of 6 lines running · 7,910 of 16,000 L/h", over the lines and UHTs the board shows. */
export function summaryText(view: FactoryView): string {
  const lines = [...view.uhts.flatMap((uht) => uht.lines), ...view.unassigned];
  const running = lines.filter((line) => line.status === 'running').length;
  const drawLph = view.uhts.reduce((sum, uht) => sum + uht.drawLph, 0);
  const capacityLph = view.uhts.reduce((sum, uht) => sum + uht.capacityLph, 0);
  const lineWord = lines.length === 1 ? 'line' : 'lines';
  const draw = capacityLph > 0 ? ` · ${formatNumber(drawLph)} of ${formatNumber(capacityLph)} L/h` : '';
  return `${formatNumber(running)} of ${formatNumber(lines.length)} ${lineWord} running${draw}`;
}

// ───── DOM helpers ─────

function show(node: HTMLElement, visible: boolean): void {
  if (node.hidden === visible) node.hidden = !visible;
}

/** A lamp whose words are in the text next to it, so screen readers skip the dot. */
function quietLamp(status: Status): HTMLSpanElement {
  const lamp = createLamp(status);
  lamp.removeAttribute('role');
  lamp.setAttribute('aria-hidden', 'true');
  return lamp;
}

function button(label: string, className: string, testId: string): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.dataset.testid = testId;
  return node;
}

let nextId = 0;
const uniqueId = (prefix: string): string => `${prefix}-${++nextId}`;

/** The rows of a card, rebuilt only when the card's lines (their ids, in order) change. */
function linesKey(lines: readonly LineView[]): string {
  return lines.map((line) => line.id).join('\n');
}

/** "Show in 3D": shown only in the 3D view (factory.css), where it flies the floor's camera to its card or row. */
function locateButton(testId: string, onLocate: () => void): HTMLButtonElement {
  const node = button('Show in 3D', 'link fb-locate', testId);
  node.addEventListener('click', onLocate);
  return node;
}

type Locate = (selection: FactorySelection) => void;

// ───── A line's row ─────

interface LineRowView {
  root: HTMLLIElement;
  update(line: LineView): void;
  /** Marks the row while its line is picked. */
  mark(selection: FactorySelection | null): HTMLElement | null;
}

function createLineRow(onLocate: Locate): LineRowView {
  const root = el('li', 'fb-line');
  const lamp = quietLamp('idle');
  const body = el('div', 'fb-line-body');
  let lineId = '';

  const top = el('div', 'fb-line-top');
  const name = el('h3', 'fb-line-name');
  const status = el('span', 'fb-line-status');
  status.dataset.testid = 'line-status';
  const locate = locateButton('locate-line', () => onLocate({ kind: 'line', id: lineId }));
  top.append(name, status, locate);

  const filler = el('p', 'fb-line-filler');
  filler.dataset.testid = 'line-filler';

  const lotRow = el('p', 'fb-line-lot');
  const product = el('span', 'fb-product');
  product.dataset.testid = 'line-product';
  const lotClock = el('span', 'fb-lot-clock');
  lotClock.dataset.testid = 'line-lot-clock';
  lotRow.append(product, lotClock);

  const outRow = el('p', 'fb-line-out');
  const output = el('span', 'fb-output');
  output.dataset.testid = 'line-output';
  const troubles = el('span', 'fb-trouble');
  troubles.dataset.testid = 'line-troubles';
  outRow.append(output, troubles);

  body.append(top, filler, lotRow, outRow);
  root.append(lamp, body);

  return {
    root,
    update(line) {
      lineId = line.id;
      setAttr(root, 'data-testid', `line-${line.name}`);
      setAttr(root, 'data-status', line.status);
      setLamp(lamp, line.lamp);
      setText(name, line.name);
      setAttr(locate, 'aria-label', `Show ${line.name} in 3D`);
      setText(status, line.statusText);
      setText(filler, fillerText(line));

      const productLine = productText(line);
      const clock = line.lotRunS === null ? '' : `running for ${formatDuration(line.lotRunS)}`;
      setText(product, productLine);
      setText(lotClock, clock);
      show(product, productLine !== '');
      show(lotClock, clock !== '');
      show(lotRow, productLine !== '' || clock !== '');

      setText(output, outputText(line));
      const trouble = troublesText(line);
      setText(troubles, trouble);
      setAttr(troubles, 'data-sev', line.worstSev === null ? null : String(line.worstSev));
      show(troubles, trouble !== '');
    },
    mark(selection) {
      const on = selection?.kind === 'line' && selection.id === lineId;
      setAttr(root, 'data-selected', on ? 'true' : null);
      return on ? root : null;
    },
  };
}

interface LineListView {
  root: HTMLUListElement;
  update(lines: readonly LineView[]): void;
  /** Marks the picked line's row, and returns it (null when it is not in this list). */
  mark(selection: FactorySelection | null): HTMLElement | null;
}

/** A list of line rows that rebuilds its rows only when the lines change. */
function createLineList(onLocate: Locate): LineListView {
  const root = el('ul', 'fb-lines');
  let key: string | null = null;
  let rows: LineRowView[] = [];
  return {
    root,
    update(lines) {
      const nextKey = linesKey(lines);
      if (nextKey !== key) {
        key = nextKey;
        rows = lines.map(() => createLineRow(onLocate));
        root.replaceChildren(...rows.map((row) => row.root));
      }
      lines.forEach((line, index) => rows[index].update(line));
      show(root, lines.length > 0);
    },
    mark(selection) {
      let found: HTMLElement | null = null;
      for (const row of rows) found = row.mark(selection) ?? found;
      return found;
    },
  };
}

// ───── A UHT's card ─────

interface UhtCardView {
  root: HTMLElement;
  update(uht: UhtView): void;
  /** Marks the card while its UHT is picked, or its row while one of its lines is; returns what it marked. */
  mark(selection: FactorySelection | null): HTMLElement | null;
}

function createUhtCard(onLocate: Locate): UhtCardView {
  const titleId = uniqueId('fb-uht');
  const root = el('section', 'fb-uht card');
  root.setAttribute('aria-labelledby', titleId);
  let uhtName = '';

  const head = el('div', 'fb-uht-head');
  const lamp = quietLamp('idle');
  const name = el('h2', 'fb-uht-name');
  name.id = titleId;
  const capacity = el('span', 'fb-cap');
  capacity.dataset.testid = 'capacity';
  const locate = locateButton('locate-uht', () => onLocate({ kind: 'uht', name: uhtName }));
  head.append(lamp, name, capacity, locate);

  const state = el('p', 'fb-state');
  state.dataset.testid = 'draw';

  // The bar is the draw text drawn; the text says the same in words, so the bar itself stays out of the
  // accessibility tree and the percentage beside it is plain text.
  const meter = el('div', 'fb-meter');
  const bar = el('div', 'fb-bar');
  bar.setAttribute('aria-hidden', 'true');
  const fill = el('span', 'fb-bar-fill');
  bar.append(fill);
  const pct = el('span', 'fb-pct');
  pct.dataset.testid = 'load';
  meter.append(bar, pct);

  const over = el('p', 'fb-over');
  over.dataset.testid = 'over-capacity';
  over.hidden = true;

  const lines = createLineList(onLocate);
  root.append(head, state, meter, over, lines.root);

  return {
    root,
    update(uht) {
      uhtName = uht.name;
      setAttr(locate, 'aria-label', `Show ${uht.name} in 3D`);
      setAttr(root, 'data-testid', `uht-${uht.name}`);
      setAttr(root, 'data-state', uht.state);
      setLamp(lamp, uht.lamp);
      setText(name, uht.name);
      setText(capacity, `Capacity ${formatNumber(uht.capacityLph)} L/h`);
      setText(state, uht.stateText);

      const loadPct = Number.isFinite(uht.loadPct) ? Math.max(0, uht.loadPct) : 0;
      const width = `${formatNumber(Math.min(100, loadPct), 1)}%`;
      if (fill.style.width !== width) fill.style.width = width;
      setAttr(meter, 'data-over', uht.overCapacity ? 'true' : null);
      setText(pct, `${formatNumber(loadPct)} % load`);

      setText(over, uht.overCapacity ? `Over capacity by ${formatNumber(uht.drawLph - uht.capacityLph)} L/h` : '');
      show(over, uht.overCapacity);

      lines.update(uht.lines);
    },
    mark(selection) {
      const on = selection?.kind === 'uht' && selection.name === uhtName;
      setAttr(root, 'data-selected', on ? 'true' : null);
      const row = lines.mark(selection);
      return on ? root : row;
    },
  };
}

/** The card of the UHT lines whose UHT is none Let Report lists. */
function createUnassignedCard(onLocate: Locate): {
  root: HTMLElement;
  update(lines: readonly LineView[]): void;
  mark(selection: FactorySelection | null): HTMLElement | null;
} {
  const titleId = uniqueId('fb-unassigned');
  const root = el('section', 'fb-uht fb-unassigned card');
  root.dataset.testid = 'unassigned';
  root.setAttribute('aria-labelledby', titleId);
  root.hidden = true;
  const head = el('div', 'fb-uht-head');
  const name = el('h2', 'fb-uht-name', 'Not assigned to a UHT');
  name.id = titleId;
  head.append(name);
  const note = el('p', 'fb-note', "These UHT lines name no UHT plant from Let Report's factory settings.");
  const lines = createLineList(onLocate);
  root.append(head, note, lines.root);
  return {
    root,
    update(unassigned) {
      lines.update(unassigned);
      show(root, unassigned.length > 0);
    },
    mark: (selection) => lines.mark(selection),
  };
}

// ───── The page ─────

export interface BoardOptions {
  /** Let Report's address, linked from the sign-in text. */
  appUrl: string;
  /** The form was sent with an email and a password (both filled in). */
  onSignIn(email: string, password: string): void;
  onSignOut(): void;
  /** The viewer picked Board or 3D in the header. */
  onView(mode: FactoryViewMode): void;
  /** "Show in 3D" on a card or a row. */
  onLocate(selection: FactorySelection): void;
}

export interface Board {
  /** The sign-in form, with `message` in its error line (why the board signed out), and the board emptied. */
  showSignIn(message?: string): void;
  /** While a sign-in is under way: the button says so and does not send twice. */
  setSignInBusy(busy: boolean): void;
  /** A sign-in failed: the message in the form's error line, focus back on the password. */
  setSignInError(message: string): void;
  /** The board for `email`, empty ("Loading…") until the first render. */
  showBoard(email: string): void;
  setUser(email: string): void;
  render(view: FactoryView): void;
  setLive(info: LiveInfo, nowMs: number): void;
  /** A short message over the last view, or null to clear it. */
  setLoadError(message: string | null): void;
  /** Where the 3D floor is drawn (phase 10): shown beside the cards in the 3D view, hidden on the board. */
  readonly viewport: HTMLElement;
  /** Board, or the cards beside the 3D floor: the switch, the viewport and the "Show in 3D" buttons follow. */
  setView(mode: FactoryViewMode): void;
  /** Marks the picked UHT's card or line's row, or none; with `reveal`, scrolls it into view. */
  setSelection(selection: FactorySelection | null, reveal?: boolean): void;
}

export function createBoard(root: HTMLElement, options: BoardOptions): Board {
  // ── header ──
  const header = el('header', 'fb-head card');
  const brand = el('div', 'fb-brand');
  const titleRow = el('div', 'fb-title-row');
  const title = el('h1', '', 'Factory board');
  // Focus lands here after signing in, so it is not left on the hidden form.
  title.tabIndex = -1;
  const back = el('a', 'link fb-back', '3D plant');
  back.href = './';
  back.dataset.testid = 'plant-link';
  back.title = 'Back to the 3D simulation of the UHT milk plant';
  titleRow.append(title, back);

  const sub = el('p', 'fb-sub');
  const site = el('span', 'fb-site');
  site.dataset.testid = 'site-name';
  site.hidden = true;
  const siteSep = el('span', '', ' · ');
  siteSep.hidden = true;
  siteSep.setAttribute('aria-hidden', 'true');
  sub.append(site, siteSep, 'UHT plants and lines, from Let Report');
  brand.append(titleRow, sub);

  const session = el('div', 'fb-session');
  session.hidden = true;
  const live = el('p', 'fb-live');
  live.dataset.testid = 'live-state';
  live.setAttribute('aria-live', 'polite');
  const liveLamp = el('span', 'lamp');
  liveLamp.setAttribute('aria-hidden', 'true');
  liveLamp.dataset.status = 'warn';
  const liveWords = el('span', 'fb-live-text', 'Connecting…');
  live.append(liveLamp, liveWords);
  const user = el('p', 'fb-user');
  const userEmail = el('span', 'fb-user-email');
  userEmail.dataset.testid = 'user';
  user.append('Signed in as ', userEmail);
  const signOut = button('Sign out', 'btn', 'sign-out');
  signOut.addEventListener('click', () => options.onSignOut());
  // Board or 3D (phase 10): two toggle buttons, the pressed one showing.
  const views = el('div', 'fb-views');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'View');
  const viewButtons: Record<FactoryViewMode, HTMLButtonElement> = {
    board: button('Board', 'fb-view', 'view-board'),
    '3d': button('3D', 'fb-view', 'view-3d'),
  };
  viewButtons['3d'].title = 'The factory floor in 3D, beside the cards';
  for (const [mode, node] of Object.entries(viewButtons) as [FactoryViewMode, HTMLButtonElement][]) {
    node.setAttribute('aria-pressed', 'false');
    node.addEventListener('click', () => options.onView(mode));
    views.append(node);
  }
  session.append(views, live, user, signOut);
  header.append(brand, session);

  // ── sign-in form ──
  const form = el('form', 'fb-signin card');
  form.dataset.testid = 'factory-signin';
  form.noValidate = true;
  form.hidden = true;
  form.setAttribute('aria-labelledby', 'fb-signin-title');
  const formTitle = el('h2', '', 'Sign in');
  formTitle.id = 'fb-signin-title';
  const note = el('p', 'fb-note');
  const appLink = el('a', '', 'Let Report');
  appLink.href = options.appUrl;
  appLink.target = '_blank';
  appLink.rel = 'noopener noreferrer';
  note.append(
    'Sign in with your ',
    appLink,
    " account. The factory's UHT plants and lines, and their status, come from Let Report.",
  );

  const errorLine = el('p', 'fb-form-error');
  errorLine.id = 'fb-signin-error';
  errorLine.dataset.testid = 'signin-error';
  errorLine.setAttribute('role', 'alert');

  const field = (label: string, id: string, type: string, autocomplete: string): { wrap: HTMLDivElement; input: HTMLInputElement } => {
    const wrap = el('div', 'fb-field');
    const labelNode = el('label', '', label);
    labelNode.htmlFor = id;
    const input = el('input');
    input.id = id;
    input.name = id.replace(/^fb-/, '');
    input.type = type;
    input.setAttribute('autocomplete', autocomplete);
    input.required = true;
    input.setAttribute('aria-describedby', errorLine.id);
    wrap.append(labelNode, input);
    return { wrap, input };
  };
  const email = field('Email', 'fb-email', 'email', 'username');
  email.input.spellcheck = false;
  email.input.setAttribute('autocapitalize', 'off');
  email.input.dataset.testid = 'signin-email';
  const password = field('Password', 'fb-password', 'password', 'current-password');
  password.input.dataset.testid = 'signin-password';

  const submit = el('button', 'btn btn-primary', 'Sign in');
  submit.type = 'submit';
  submit.dataset.testid = 'signin-submit';
  const actions = el('div', 'fb-actions');
  actions.append(submit);
  form.append(formTitle, note, email.wrap, password.wrap, errorLine, actions);

  let busy = false;
  const markInvalid = (input: HTMLInputElement | null): void => {
    for (const each of [email.input, password.input]) setAttr(each, 'aria-invalid', each === input ? 'true' : null);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    const emailValue = email.input.value.trim();
    if (!emailValue) {
      setText(errorLine, 'Enter your email.');
      markInvalid(email.input);
      email.input.focus();
      return;
    }
    if (!password.input.value) {
      setText(errorLine, 'Enter your password.');
      markInvalid(password.input);
      password.input.focus();
      return;
    }
    markInvalid(null);
    setText(errorLine, '');
    options.onSignIn(emailValue, password.input.value);
  });

  // ── the board ──
  const boardSection = el('section', 'fb-board');
  boardSection.setAttribute('aria-label', 'UHT plants and lines');
  boardSection.hidden = true;
  const summary = el('p', 'fb-summary');
  summary.dataset.testid = 'summary';
  summary.hidden = true;
  const loadError = el('p', 'fb-load-error');
  loadError.dataset.testid = 'load-error';
  loadError.hidden = true;
  const empty = el('p', 'fb-empty', 'Loading the factory from Let Report…');
  empty.dataset.testid = 'board-loading';
  const noUhts = el('p', 'fb-empty', "Let Report's factory settings list no UHT plants yet.");
  noUhts.hidden = true;
  const grid = el('div', 'fb-uhts');
  const unassigned = createUnassignedCard(options.onLocate);
  grid.append(unassigned.root);
  // In the 3D view the floor stands beside the cards (factory.css); on the board the viewport is hidden.
  const viewport = el('div', 'fb-viewport');
  viewport.dataset.testid = 'factory-3d';
  viewport.setAttribute('aria-label', 'The factory floor in 3D');
  viewport.setAttribute('role', 'region');
  viewport.hidden = true;
  const body = el('div', 'fb-body');
  body.append(viewport, grid);
  boardSection.append(summary, loadError, empty, noUhts, body);

  const main = el('main', 'fb-main');
  main.append(form, boardSection);
  root.replaceChildren(header, main);

  let cardsKey: string | null = null;
  let cards: UhtCardView[] = [];
  let selection: FactorySelection | null = null;

  /** Marks the selection on the cards; returns what it marked. */
  const mark = (): HTMLElement | null => {
    let found: HTMLElement | null = null;
    for (const card of cards) found = card.mark(selection) ?? found;
    return unassigned.mark(selection) ?? found;
  };

  function clearView(): void {
    cardsKey = null;
    cards = [];
    selection = null;
    grid.replaceChildren(unassigned.root);
    unassigned.update([]);
    show(empty, true);
    show(noUhts, false);
    show(summary, false);
    setText(summary, '');
    show(loadError, false);
    setText(loadError, '');
    setText(site, '');
    show(site, false);
    show(siteSep, false);
  }

  function setBusy(next: boolean): void {
    busy = next;
    submit.disabled = next;
    setAttr(form, 'aria-busy', next ? 'true' : null);
    setText(submit, next ? 'Signing in…' : 'Sign in');
  }

  return {
    showSignIn(message) {
      const fromBoard = !boardSection.hidden;
      clearView();
      show(boardSection, false);
      show(session, false);
      show(form, true);
      setBusy(false);
      password.input.value = '';
      markInvalid(null);
      setText(errorLine, message ?? '');
      // Focus follows the form when the board gave way to it; on first load the page leaves focus alone.
      if (fromBoard || message) (email.input.value ? password.input : email.input).focus();
    },
    setSignInBusy: setBusy,
    setSignInError(message) {
      setBusy(false);
      setText(errorLine, message);
      markInvalid(password.input);
      password.input.focus();
      password.input.select();
    },
    showBoard(address) {
      const fromForm = !form.hidden && form.contains(document.activeElement);
      clearView();
      show(form, false);
      setBusy(false);
      password.input.value = '';
      setText(errorLine, '');
      show(session, true);
      setText(userEmail, address);
      show(boardSection, true);
      if (fromForm) title.focus();
    },
    setUser(address) {
      setText(userEmail, address);
    },
    render(view) {
      show(empty, false);
      setText(site, view.siteName);
      show(site, view.siteName !== '');
      show(siteSep, view.siteName !== '');
      setText(summary, summaryText(view));
      show(summary, true);
      show(noUhts, view.uhts.length === 0);

      const nextKey = view.uhts.map((uht) => uht.name).join('\n');
      if (nextKey !== cardsKey) {
        cardsKey = nextKey;
        cards = view.uhts.map(() => createUhtCard(options.onLocate));
        grid.replaceChildren(...cards.map((card) => card.root), unassigned.root);
      }
      view.uhts.forEach((uht, index) => cards[index].update(uht));
      unassigned.update(view.unassigned);
      mark();
    },
    setLive(info, nowMs) {
      setText(liveWords, liveText(info, nowMs));
      setAttr(live, 'data-state', info.state ?? 'connecting');
      setAttr(liveLamp, 'data-status', LIVE_LAMP[info.state ?? 'connecting']);
    },
    setLoadError(message) {
      setText(loadError, message ?? '');
      show(loadError, message !== null);
    },
    viewport,
    setView(mode) {
      setAttr(root, 'data-view', mode);
      setAttr(boardSection, 'data-view', mode);
      for (const [each, node] of Object.entries(viewButtons) as [FactoryViewMode, HTMLButtonElement][]) {
        setAttr(node, 'aria-pressed', each === mode ? 'true' : 'false');
      }
      show(viewport, mode === '3d');
    },
    setSelection(next, reveal = false) {
      selection = next;
      const marked = mark();
      if (reveal && marked) {
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        marked.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
      }
    },
  };
}
