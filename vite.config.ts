import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offline } from './vite-offline';

// The website lives in app/. Shared music code (model, parsers, checks) lives in shared/.
export default defineConfig({
  root: 'app',
  // The website (GitHub Pages) lives at /Tosingwell/; BASE_PATH is set when building it.
  base: process.env.BASE_PATH ?? '/',
  // offline(): saves the app and piano sounds on the device (service worker) so it works without internet.
  plugins: [react(), offline()],
  // Port 5180 (5173 is used by another program on this Mac). host: true lets your phone
  // open the dev site on the same Wi-Fi.
  // /api requests go to the small server (server/index.ts), which holds the API key.
  server: { port: 5180, host: true, proxy: { '/api': 'http://127.0.0.1:5190' } },
  build: { outDir: '../dist', emptyOutDir: true },
});
