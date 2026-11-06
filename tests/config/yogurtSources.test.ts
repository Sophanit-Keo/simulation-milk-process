// Phase 21's number check (process): every number of plant.json's yogurt block is named in the decision log's yogurt
// decisions, D25–D30, with its source or "sim assumption" beside it (ownership rule 3). A key is named by its path, its
// last one or two parts, or a group's `p8.seal.*`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { YOGURT_NUMBER_KEYS } from '../../src/contracts';

const decisions = readFileSync(new URL('../../plan/DECISIONS.md', import.meta.url), 'utf8');
const yogurtDecisions = decisions.slice(decisions.indexOf('## D25.'));
/** Every word in backticks in D25–D30, split where a cell lists several keys. */
const named = new Set(
  [...yogurtDecisions.matchAll(/`([^`]+)`/g)].flatMap((match) => (match[1] ?? '').split(/[,\s/]+/).map((part) => part.trim())),
);

describe('the yogurt block\'s sources (D25–D30)', () => {
  it('names every key of plant.json\'s yogurt block', () => {
    const missing = YOGURT_NUMBER_KEYS.filter((key) => {
      const parts = key.split('.');
      const ways = [key, `yogurt.${key}`, parts.at(-1), parts.slice(-2).join('.'), ...parts.slice(0, -1).map((_, i) => `${parts.slice(0, i + 1).join('.')}.*`)];
      return !ways.some((way) => way !== undefined && named.has(way));
    });
    expect(missing).toEqual([]);
  });
});
