// The small Markdown subset of src/data/about.md (written by `process`): headings, paragraphs,
// bullet lists and links. Parsed to plain data so it can be tested without a DOM; about.ts builds
// the nodes with textContent, so no text from the file is ever read as HTML.

export interface TextRun {
  text: string;
  /** Set for a link; only http(s) addresses are kept, anything else stays plain text. */
  href?: string;
}

export type Block =
  | { type: 'heading'; level: number; runs: TextRun[] }
  | { type: 'paragraph'; runs: TextRun[] }
  | { type: 'list'; items: TextRun[][] };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^https?:\/\//;

/** Splits one line of text into plain runs and links. */
export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match;
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push(SAFE_HREF.test(href) ? { text: label, href } : { text: label });
    at = match.index + whole.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/** Blocks are separated by blank lines; a line starting "- " is a list item, "#" to "######" a heading. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: TextRun[][] | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = [];
    list = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (line === '') {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, runs: parseInline(heading[2]) });
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push(parseInline(line.slice(2)));
    } else if (list) {
      // A wrapped list item continues the last one.
      const last = list[list.length - 1];
      last.push(...parseInline(` ${line}`));
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
