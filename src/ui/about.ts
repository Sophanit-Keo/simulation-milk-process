// "About this model": a button next to the plant's name in the top bar opens a modal dialog with the text
// `process` keeps in src/data/about.md (phase 3 card: the plant-type mix, R5, and the accepted
// simplifications). The native <dialog> traps focus, closes on Escape and gives focus back.
import aboutText from '../data/about.md?raw';
import { el } from './dom';
import { parseMarkdown, type Block, type TextRun } from './markdown';

function runs(parent: HTMLElement, textRuns: TextRun[]): void {
  for (const run of textRuns) {
    if (run.href) {
      const link = el('a', '', run.text);
      link.href = run.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      parent.append(link);
    } else {
      parent.append(run.text);
    }
  }
}

function render(blocks: Block[], titleId: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let titled = false;
  for (const block of blocks) {
    if (block.type === 'heading') {
      // The file's first heading is the dialog's title; the rest sit one level below it.
      const heading = el(titled ? 'h3' : 'h2');
      if (!titled) heading.id = titleId;
      titled = true;
      runs(heading, block.runs);
      fragment.append(heading);
    } else if (block.type === 'paragraph') {
      const paragraph = el('p');
      runs(paragraph, block.runs);
      fragment.append(paragraph);
    } else {
      const list = el('ul');
      for (const item of block.items) {
        const li = el('li');
        runs(li, item);
        list.append(li);
      }
      fragment.append(list);
    }
  }
  return fragment;
}

export interface About {
  dispose(): void;
}

export function createAbout(bar: HTMLElement, signal: AbortSignal): About {
  const open = el('button', 'link about-open', 'About');
  open.type = 'button';
  open.dataset.testid = 'about';
  open.title = 'About this model: what it shows, its simplifications and sources';
  open.setAttribute('aria-haspopup', 'dialog');

  const dialog = el('dialog', 'about card');
  dialog.dataset.testid = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'about-title');
  const body = el('div', 'about-body');
  body.append(render(parseMarkdown(aboutText), 'about-title'));
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  close.dataset.testid = 'about-close';
  const foot = el('div', 'about-foot');
  foot.append(close);
  dialog.append(body, foot);

  open.addEventListener('click', () => dialog.showModal(), { signal });
  close.addEventListener('click', () => dialog.close(), { signal });
  // A click on the backdrop (outside the dialog's box) closes it too.
  dialog.addEventListener(
    'click',
    (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) dialog.close();
    },
    { signal },
  );

  // On the title's row, where the brand's subtitle leaves room, so the bar stays one row at 1280 px.
  const title = bar.querySelector('.brand h1');
  let titleRow: HTMLElement | null = null;
  if (title) {
    titleRow = el('div', 'brand-title');
    title.replaceWith(titleRow);
    titleRow.append(title, open);
  } else {
    bar.append(open);
  }
  document.body.append(dialog);

  return {
    dispose() {
      if (dialog.open) dialog.close();
      dialog.remove();
      open.remove();
      const title = titleRow?.firstElementChild;
      if (titleRow && title) titleRow.replaceWith(title);
    },
  };
}
