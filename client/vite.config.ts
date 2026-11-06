import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/health': 'http://localhost:8787' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false },
});
