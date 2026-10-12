import { realpathSync } from 'node:fs';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// Agent worktrees symlink node_modules from the main checkout. The dev server must still serve
// files from its real path (the self-hosted fonts), which lies outside the worktree.
function nodeModulesRealPath(): string[] {
  try {
    return [realpathSync('node_modules')];
  } catch {
    return [];
  }
}

// GitHub Pages serves the project from /<repo-name>/, so the production build and `vite preview`
// of it need that base (plan review R11); the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/simulation-milk-process/' : '/',
  cacheDir: '.cache/vite',
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...nodeModulesRealPath()] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is about 560 kB minified; warn only if the bundle grows well past it.
    chunkSizeWarningLimit: 800,
  },
}));
