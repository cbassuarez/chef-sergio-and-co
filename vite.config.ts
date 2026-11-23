import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'

export default defineConfig({
  // '/' for the custom domain; set BASE_PATH=/repo-name/ for a github.io project preview.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  define: {
    __SITE_MODE__: JSON.stringify(process.env.SITE_MODE || 'prototype'),
    // The selected page structure ships with the approved salon color and type system.
    __LOOK__: JSON.stringify(process.env.LOOK || 'c'),
    // The authored sequence is packaged separately. Keep its existing static treatment until it is installed.
    __PLATING_SEQUENCE_AVAILABLE__: JSON.stringify(['sequence.json', 'poster-640.webp', 'poster-1280.webp'].every(file => existsSync(new URL(`./public/art/plating/${file}`, import.meta.url)))),
  },
  build: { outDir: 'dist', emptyOutDir: true, manifest: true },
})
