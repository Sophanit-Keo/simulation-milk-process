import { defineConfig } from 'vite';

// GitHub Pages serves the project from /<repo-name>/, so the production build and `vite preview`
// of it need that base (plan review R11); the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/simulation-milk-process/' : '/',
  cacheDir: '.cache/vite',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is about 560 kB minified; warn only if the bundle grows well past it.
    chunkSizeWarningLimit: 800,
  },
}));
