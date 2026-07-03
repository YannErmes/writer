import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use a relative base so the app works on both Vercel and GitHub Pages.
const base = process.env.VITE_BASE_URL || './'

export default defineConfig({
  base,
  plugins: [react()],
})
