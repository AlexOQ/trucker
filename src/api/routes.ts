import { Router } from 'express'
import { getAllCities, getCityById } from '../db/queries.js'
import { optimizeTrailerSet } from '../algorithm/optimizer.js'

export const router = Router()

// Get all cities for dropdown
router.get('/cities', async (_req, res) => {
  try {
    const cities = await getAllCities()
    res.json(cities)
  } catch (error) {
    console.error('Error fetching cities:', error)
    res.status(500).json({ error: 'Failed to fetch cities' })
  }
})

// Get trailer recommendations for a city
router.get('/cities/:id/trailers', async (req, res) => {
  try {
    const cityId = parseInt(req.params.id)
    if (isNaN(cityId)) {
      return res.status(400).json({ error: 'Invalid city ID' })
    }

    const city = await getCityById(cityId)
    if (!city) {
      return res.status(404).json({ error: 'City not found' })
    }

    const maxTrailers = parseInt(req.query.max as string) || 10
    const result = await optimizeTrailerSet(cityId, maxTrailers)

    res.json({
      city,
      ...result,
    })
  } catch (error) {
    console.error('Error optimizing trailers:', error)
    res.status(500).json({ error: 'Failed to optimize trailers' })
  }
})
