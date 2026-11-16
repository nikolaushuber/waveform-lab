import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so dist/ works from any sub-path (e.g. GitHub Pages).
  base: './',
  preview: { port: 4173, strictPort: true },
});
