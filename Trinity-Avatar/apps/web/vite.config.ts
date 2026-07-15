import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // Workspace packages ship TS sources; Vite compiles them directly.
  optimizeDeps: {
    exclude: ['@trinity-avatar/avatar-core', '@trinity-avatar/protocol'],
  },
});
