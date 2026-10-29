/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // API_URL desde la terminal o desde frontend/.env.local (Vite no carga esos archivos en process.env por sí solo).
  const api = loadEnv(mode, process.cwd(), '').API_URL ?? 'http://localhost:3000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Mismo origen para el navegador: sin CORS, y el JWT y el SSE pasan tal cual a la API.
      proxy: {
        '/api': api,
        '/graphql': api,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
