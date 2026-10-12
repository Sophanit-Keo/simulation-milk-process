import { defineConfig } from 'vite';

// GitHub Pages serves the project from /<repo-name>/, so production builds need that base (plan review R11).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/simulation-milk-process/' : '/',
  cacheDir: '.cache/vite',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
