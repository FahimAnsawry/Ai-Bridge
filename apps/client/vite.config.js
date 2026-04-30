import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // suppress ECONNREFUSED on server startup
        },
      },
      '/auth': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {});
        },
      },
      '/copilot': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => {});
        },
      },
      '/socket.io': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {});
        },
      },
    },
  },
})
