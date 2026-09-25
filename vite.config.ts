import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    host: true,
    proxy: { '/api': 'http://localhost:3080' },
    // A dev server watching the deploy's build folders locks them on Windows, and the swap to the new build fails
    watch: { ignored: ['**/dist*/**', '**/data/**'] },
  },
});
