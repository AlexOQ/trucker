import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { router } from './api/routes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(express.json())
app.use(express.static(join(__dirname, '../public')))

// API routes
app.use('/api', router)

app.listen(PORT, () => {
  console.log(`ETS2 Trucker Advisor running at http://localhost:${PORT}`)
})
