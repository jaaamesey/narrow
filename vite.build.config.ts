import babel from '@rolldown/plugin-babel'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The library's JavaScript, compiled with the React Compiler, so apps without it still get the memoization inside
// NarrowList and the context Providers. Declarations come from tsc (see the build script).
export default defineConfig({
  plugins: [babel({ presets: [reactCompilerPreset()] })],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    lib: { entry: 'src/index.ts', formats: ['es'] },
    rollupOptions: {
      external: [/^react($|\/)/, 'mutative'],
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
    },
  },
})
