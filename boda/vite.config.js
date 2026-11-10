import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Vive dentro de otro repo: sin esto Vite hereda el postcss.config del padre.
  css: { postcss: {} },
  server: { port: 5180 },
});
