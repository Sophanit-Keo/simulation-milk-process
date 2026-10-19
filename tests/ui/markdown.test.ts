// The Markdown subset the About dialog renders (src/ui/markdown.ts), and src/data/about.md itself:
// it must stay inside that subset, so nothing in it shows up as raw Markdown on screen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../src/ui/markdown';

describe('parseInline', () => {
  it('splits text and links, in order', () => {
    expect(parseInline('see [R6](https://example.org/r6) and [D4](http://example.org/d4).')).toEqual([
      { text: 'see ' },
      { text: 'R6', href: 'https://example.org/r6' },
      { text: ' and ' },
      { text: 'D4', href: 'http://example.org/d4' },
      { text: '.' },
    ]);
  });

  it('keeps only http(s) links; any other address stays plain text', () => {
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ text: 'x' });
    expect(parseInline('[y](../plan/DECISIONS.md)')).toEqual([{ text: 'y' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, paragraphs joined across lines, and lists with wrapped items', () => {
    const blocks = parseMarkdown('# Title\n\nOne line\nand the next.\n\n## Part\n\n- first\n- second\n  wrapped\n\nAfter.');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, runs: [{ text: 'Title' }] },
      { type: 'paragraph', runs: [{ text: 'One line and the next.' }] },
      { type: 'heading', level: 2, runs: [{ text: 'Part' }] },
      { type: 'list', items: [[{ text: 'first' }], [{ text: 'second' }, { text: ' wrapped' }]] },
      { type: 'paragraph', runs: [{ text: 'After.' }] },
    ]);
  });
});

describe('src/data/about.md', () => {
  const blocks = parseMarkdown(readFileSync(new URL('../../src/data/about.md', import.meta.url), 'utf8'));
  const texts = blocks.flatMap((block) =>
    block.type === 'list' ? block.items.flat() : block.runs,
  ).map((run) => run.text);

  it('opens with one level-1 heading, the dialog title, and has sections under it', () => {
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks.filter((block) => block.type === 'heading' && block.level === 1)).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'heading' && block.level === 2).length).toBeGreaterThan(2);
  });

  it('uses only the subset: no emphasis, code, images or raw links left over', () => {
    for (const text of texts) expect(text, text).not.toMatch(/\*\*|`|!\[|\]\(|<\w/);
  });

  it('links only to http(s) pages', () => {
    const links = blocks.flatMap((block) => (block.type === 'list' ? block.items.flat() : block.runs)).filter((run) => run.href);
    expect(links.length).toBeGreaterThan(0);
    for (const { href } of links) expect(href).toMatch(/^https?:\/\//);
  });
});
