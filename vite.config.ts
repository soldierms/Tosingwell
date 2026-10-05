import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website lives in app/. Shared music code (model, parsers, checks) lives in shared/.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  // Port 5180 (5173 is used by another program on this Mac). host: true lets your phone
  // open the dev site on the same Wi-Fi.
  // /api requests go to the small server (server/index.ts), which holds the API key.
  server: { port: 5180, host: true, proxy: { '/api': 'http://127.0.0.1:5190' } },
  build: { outDir: '../dist', emptyOutDir: true },
});
