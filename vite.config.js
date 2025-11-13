import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use base path only for GitHub Pages, not for Vercel
  // Vercel doesn't need a base path, GitHub Pages does
  base: import.meta.env.VERCEL ? '/' : (import.meta.env.GITHUB_PAGES ? '/ai-eataly-chat/' : '/'),
})

