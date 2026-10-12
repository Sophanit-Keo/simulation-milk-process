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

// GitHub Pages serves the project from /<repo-name>/ (plan review R11), so CI's Pages build sets
// BASE_PATH to that. Everything else serves from /: the dev server, `vite preview` and Vercel.
export default defineConfig(() => ({
  base: process.env.BASE_PATH ?? '/',
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
