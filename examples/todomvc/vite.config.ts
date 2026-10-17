import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  // Use the library straight from the repo's source.
  resolve: { alias: { narrow: fileURLToPath(new URL('../../src/index.ts', import.meta.url)) } },
})
