import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath, URL } from 'node:url';

const API = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [
    react(),
    // Silero VAD model + onnxruntime wasm, served from /vad/
    viteStaticCopy({
      targets: [
        { src: '../../node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: 'vad' },
        { src: '../../node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', dest: 'vad' },
        { src: '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', dest: 'vad' },
        { src: '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', dest: 'vad' },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@ic/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  // vad-web is CommonJS and require()s onnxruntime-web/wasm: both must be pre-bundled together,
  // otherwise the dev server throws "Dynamic require … is not supported" and the app is blank.
  optimizeDeps: { include: ['@ricky0123/vad-web', 'onnxruntime-web/wasm'] },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API,
      '/ws': { target: API, ws: true },
    },
  },
});
