import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path used when deploying to GitHub Pages.
const ghPagesBase = '/dodgers-daily/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? ghPagesBase : '/',
  plugins: [react()],
}))
