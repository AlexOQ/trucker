import { Router } from 'express'
import { getAllCities, getCityById, getCitiesWithDepotCounts } from '../db/queries.js'
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

// Get city rankings by profitability
router.get('/cities/rankings', async (_req, res) => {
  try {
    const cities = await getCitiesWithDepotCounts()

    const rankings = await Promise.all(
      cities.map(async (city) => {
        const result = await optimizeTrailerSet(city.id, 10)

        // Sum of avg_value from recommendations (normalized profitability indicator)
        const sumAvgValue = result.recommendations.reduce((sum, r) => sum + r.avg_value, 0)

        // Avg value per job opportunity
        const avgValuePerJob = result.total_cargo_instances > 0
          ? result.total_value / result.total_cargo_instances
          : 0

        return {
          id: city.id,
          name: city.name,
          country: city.country,
          depot_count: Number(city.depot_count) || 0,
          job_opportunities: result.total_cargo_instances,
          total_value: result.total_value,
          avg_value_per_job: Math.round(avgValuePerJob * 100) / 100,
          trailer_profitability: Math.round(sumAvgValue * 100) / 100,
        }
      })
    )

    // Sort by trailer_profitability descending
    rankings.sort((a, b) => b.trailer_profitability - a.trailer_profitability)

    res.json(rankings)
  } catch (error) {
    console.error('Error fetching city rankings:', error)
    res.status(500).json({ error: 'Failed to fetch city rankings' })
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
