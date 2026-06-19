import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // fileURLToPath (not .pathname) so the alias resolves correctly on Windows —
      // .pathname yields a malformed "/C:/...%20..." path that breaks every @/ import.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
