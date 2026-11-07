import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@kirocrew/app-sdk/ui': here('./ui-stub.tsx'),
      '@kirocrew/app-sdk': here('./sdk-stub.tsx'),
    },
  },
  build: { outDir: here('./dist'), emptyOutDir: true },
})
