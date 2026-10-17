import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Use the library straight from the repo's source.
  resolve: { alias: { narrow: fileURLToPath(new URL('../../src/index.ts', import.meta.url)) } },
})
