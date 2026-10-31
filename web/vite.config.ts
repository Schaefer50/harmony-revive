import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, the UI runs on Vite's port and proxies the API to the bridge server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
});
