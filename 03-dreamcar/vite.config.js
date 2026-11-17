import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: ['es2020', 'safari15'],
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: 'index.html' } },
  },
  server: { port: 5190, strictPort: false },
  preview: { port: 4190, strictPort: false },
});
