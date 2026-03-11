import { defineConfig, Plugin } from 'vite'
import { resolve } from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { renameSync, rmSync, readdirSync, existsSync } from 'fs'

/**
 * Development middleware: rewrites /trucker/* requests to /trucker/public/*
 * This lets us serve HTML files from public/ at the expected URLs
 */
function servePublicAtRoot(): Plugin {
  return {
    name: 'serve-public-at-root',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url &&
          req.url.startsWith('/trucker/') &&
          !req.url.includes('/src/') &&
          !req.url.includes('/@') &&
          !req.url.includes('/node_modules/')
        ) {
          // Rewrite /trucker/foo to /trucker/public/foo
          const path = req.url.replace('/trucker/', '/trucker/public/')
          req.url = path === '/trucker/public/' ? '/trucker/public/index.html' : path
        }
        next()
      })
    },
  }
}

/**
 * Build plugin: flattens HTML from dist/public/ to dist/
 * Rollup preserves directory structure, so we move files post-build
 */
function flattenHtmlOutput(): Plugin {
  return {
    name: 'flatten-html-output',
    closeBundle() {
      const publicDir = resolve(__dirname, 'public/dist/public')
      const distDir = resolve(__dirname, 'public/dist')

      if (existsSync(publicDir)) {
        for (const file of readdirSync(publicDir)) {
          renameSync(resolve(publicDir, file), resolve(distDir, file))
        }
        rmSync(publicDir, { recursive: true })
      }
    },
  }
}

export default defineConfig({
  root: '.',
  base: '/trucker/',
  publicDir: false,

  plugins: [
    servePublicAtRoot(),
    viteStaticCopy({
      targets: [
        { src: 'public/data/*', dest: 'data' },
        { src: 'public/css/*', dest: 'css' },
      ],
    }),
    flattenHtmlOutput(),
  ],

  build: {
    outDir: 'public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        cities: resolve(__dirname, 'public/cities.html'),
        companies: resolve(__dirname, 'public/companies.html'),
        cargo: resolve(__dirname, 'public/cargo.html'),
        trailers: resolve(__dirname, 'public/trailers.html'),
        dlcs: resolve(__dirname, 'public/dlcs.html'),
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
