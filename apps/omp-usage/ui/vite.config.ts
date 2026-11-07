import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two self-contained ESM bundles (page + composer control). The host provides these at
// runtime through its import map, so they stay out of the bundle.
const entry = process.env.ENTRY === 'control' ? 'control' : 'page'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: `src/${entry}.tsx`,
      formats: ['es'],
      fileName: () => `${entry}.mjs`,
    },
    outDir: 'dist',
    emptyOutDir: entry === 'page',
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@kirocrew/app-sdk',
        '@kirocrew/app-sdk/ui',
        '@tanstack/react-query',
        'lucide-react',
      ],
    },
  },
})
