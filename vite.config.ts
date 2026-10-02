import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website lives in app/. Shared music code (model, parsers, checks) lives in shared/.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  server: { host: true }, // lets your phone open the dev site on the same Wi-Fi
  build: { outDir: '../dist', emptyOutDir: true },
});
