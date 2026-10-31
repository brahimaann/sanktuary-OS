import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Test sign-in without Clerk, dev server only (tests/signed-in.mjs)
      ...(process.env.FAKE_CLERK && { '@clerk/react': path.resolve(__dirname, './tests/fake-clerk.js') }),
    },
  },
  // darkroom-render.html: the page the server develops Darkroom Lite's pictures with (src/darkroomRender.ts)
  build: { rollupOptions: { input: ['index.html', 'darkroom-render.html'] } },
  server: {
    port: 3001,
    host: true,
    proxy: { '/api': 'http://localhost:3080' },
    // A dev server watching the deploy's build folders locks them on Windows, and the swap to the new build fails
    watch: { ignored: ['**/dist*/**', '**/data/**'] },
  },
});
