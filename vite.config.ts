import { defineConfig } from 'vite'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  root: 'public',
  base: '/trucker/',
  publicDir: false, // Disable default publicDir, use plugin instead
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'data/*',
          dest: 'data',
        },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        cities: resolve(__dirname, 'public/cities.html'),
        companies: resolve(__dirname, 'public/companies.html'),
        cargo: resolve(__dirname, 'public/cargo.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/frontend'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
