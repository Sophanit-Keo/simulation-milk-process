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

export default defineConfig(
  { ignores: ['dist', 'node_modules', '.cache', 'playwright-report', 'test-results', 'uht-plant-preview.html'] },
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
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', HEADLESS_IMPORTS],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'requestAnimationFrame', 'localStorage'],
    },
  },
);
