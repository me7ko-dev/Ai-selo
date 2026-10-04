import { defineConfig } from 'vite';

// base './' — играта работи и от GitHub Pages (/Ai-selo/), и от Electron (вътрешен сървър на 127.0.0.1)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 3000, assetsInlineLimit: 0 },
  server: { port: 5199 },
});
