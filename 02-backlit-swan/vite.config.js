import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: ['es2020', 'safari15'],
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5180, strictPort: false },
  // 4173 is the port package.json's `npm test`, tools/playtest.cjs and docs/tools.md expect
  preview: { port: 4173, strictPort: false },
});
