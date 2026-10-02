import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website lives in app/. Shared music code (model, parsers, checks) lives in shared/.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  // Port 5180 (5173 is used by another program on this Mac). host: true lets your phone
  // open the dev site on the same Wi-Fi.
  server: { port: 5180, host: true },
  build: { outDir: '../dist', emptyOutDir: true },
});
