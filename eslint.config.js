import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The sim core and the contracts must run headless in Node (Vitest), so they may not
// import three.js, the 3D view or the UI, or touch browser globals (plan 07).
const HEADLESS_IMPORTS = {
  patterns: [
    { group: ['three', 'three/*'], message: 'src/sim and src/contracts must not import three.js (plan 07).' },
    { group: ['**/scene', '**/scene/*', '**/ui', '**/ui/*'], message: 'src/sim and src/contracts must not import the 3D view or the UI.' },
  ],
};
// Flat config merges `globals`, so the browser globals above cannot be taken away here, and
// no-undef is off for .ts files. These names are banned outright instead; `npm run typecheck`
// (tsconfig.headless.json, no DOM or Node types) catches every other browser or Node global.
const HEADLESS_GLOBALS = [
  'window', 'self', 'globalThis', 'document', 'navigator', 'location', 'requestAnimationFrame',
  'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'process',
].map((name) => ({ name, message: 'src/sim and src/contracts run headless: no browser or Node globals (plan 07).' }));

export default defineConfig(
  { ignores: ['dist', 'node_modules', '.cache', '.claude', 'playwright-report', 'test-results', 'uht-plant-preview.html'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/sim/**/*.ts', 'src/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', HEADLESS_IMPORTS],
      // no-restricted-imports does not see import(), so `import('three')` would slip through.
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'src/sim and src/contracts use static imports only: no import() (plan 07).' }],
      'no-restricted-globals': ['error', ...HEADLESS_GLOBALS],
    },
  },
);
