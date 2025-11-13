import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use '/' for Vercel (default), GitHub Pages will override via environment variable
  // Set VITE_BASE_PATH=/ai-eataly-chat/ for GitHub Pages builds
  base: process.env.VITE_BASE_PATH || '/',
})

