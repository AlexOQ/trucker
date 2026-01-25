import { defineConfig, Plugin } from 'vite'
import { resolve } from 'path'

// Plugin to serve public/ files at root during dev
function servePublicAtRoot(): Plugin {
  return {
    name: 'serve-public-at-root',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Rewrite root HTML requests to public/
        if (req.url && !req.url.startsWith('/src/') && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules/')) {
          const htmlPages = ['/', '/index.html', '/cities.html', '/companies.html', '/cargo.html']
          const staticDirs = ['/css/', '/data/', '/js/']

          if (htmlPages.includes(req.url) || staticDirs.some(dir => req.url!.startsWith(dir))) {
            req.url = '/public' + (req.url === '/' ? '/index.html' : req.url)
          }
        }
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => {
  // Different root for dev vs build to handle TypeScript paths correctly
  const isDev = command === 'serve'

  return {
    // Dev: root at project level so /src/frontend/main.ts works
    // Build: root at public/ so HTML outputs to public/dist/*.html (not public/dist/public/*.html)
    root: isDev ? '.' : 'public',
    // Don't use publicDir since we're building to public/dist
    publicDir: false,
    plugins: isDev ? [servePublicAtRoot()] : [],
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
  }
})
