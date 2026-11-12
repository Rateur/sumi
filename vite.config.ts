import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// Tauri expects a fixed dev port and handles its own console output.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
