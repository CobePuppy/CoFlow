import { productInfoPlugin } from '../../scripts/release/product-info.ts';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [productInfoPlugin()],
  base: '/student/',
  publicDir: '../web/public',
  build: { outDir: 'dist' },
});
