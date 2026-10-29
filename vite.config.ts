import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // three.js with the loaders the app takes from it, about 655 kB minified, goes in a chunk of its own, which
    // the browser keeps cached when only the app changes; the app's chunk is the rest (about 185 kB by phase 4).
    // Warn if either grows well past that.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      // Two pages: the 3D plant, and the Factory board (phase 9), which loads no three.js. Their links to each
      // other are relative (factory.html, ./), so the GitHub Pages base path needs nothing more.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        factory: fileURLToPath(new URL('factory.html', import.meta.url)),
      },
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
}));
