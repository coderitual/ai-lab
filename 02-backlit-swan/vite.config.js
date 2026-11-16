import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: ['es2020', 'safari15'],
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5180, strictPort: false },
  preview: { port: 4180, strictPort: false },
});
