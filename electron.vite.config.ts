import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Production CSP as a <meta> tag: file:// loads do not go through webRequest header hooks.
const PROD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function cspMeta(): Plugin {
  return {
    name: 'skm-csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`)
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), cspMeta()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
});
