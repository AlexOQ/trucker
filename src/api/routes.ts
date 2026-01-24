import { Router } from 'express'
import { getAllCities, getCityById, getCitiesWithDepotCounts } from '../db/queries.js'

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

// Get city rankings by profitability
// NOTE: Rankings are now computed client-side. Use public/data/*.json files.
router.get('/cities/rankings', async (_req, res) => {
  try {
    const cities = await getCitiesWithDepotCounts()
    // Basic ranking by depot count (algorithm moved to client-side)
    const rankings = cities.map(city => ({
      id: city.id,
      name: city.name,
      country: city.country,
      depot_count: Number(city.depot_count) || 0,
    }))
    rankings.sort((a, b) => b.depot_count - a.depot_count)
    res.json(rankings)
  } catch (error) {
    console.error('Error fetching city rankings:', error)
    res.status(500).json({ error: 'Failed to fetch city rankings' })
  }
})

// Get trailer recommendations for a city
// NOTE: Optimization is now computed client-side. See public/js/optimizer.js
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

    res.json({
      city,
      message: 'Trailer optimization moved to client-side. Use the static app at public/index.html'
    })
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Failed to get city info' })
  }
})
