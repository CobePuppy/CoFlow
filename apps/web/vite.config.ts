import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.COFLOW_API_URL || 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist' },
});
