import babel from '@rolldown/plugin-babel'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const shared = { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] } as const

export default defineConfig({
  test: {
    projects: [
      { test: { ...shared, name: 'plain' } },
      // The same tests with the React Compiler applied to both the library and the tests.
      { plugins: [babel({ presets: [reactCompilerPreset()] })], test: { ...shared, name: 'compiler' } },
    ],
  },
})
