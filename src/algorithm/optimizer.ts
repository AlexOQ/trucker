import { getCityCargoPool, getAllCargoTrailerMappings, getOwnableTrailerTypes } from '../db/queries.js'

interface TrailerRecommendation {
  trailer_id: number
  trailer_name: string
  coverage_pct: number
  avg_value: number
  score: number
  count: number
}

interface TrailerStats {
  id: number
  name: string
  jobOpportunities: number
  totalValue: number
  avgValue: number
  coveragePct: number
  valuePct: number
}

interface OptimizationResult {
  city_id: number
  total_depots: number
  total_cargo_instances: number
  total_value: number
  recommendations: TrailerRecommendation[]
}

const DIMINISHING_FACTOR = 0.75

export async function optimizeTrailerSet(
  cityId: number,
  maxTrailers: number = 10
): Promise<OptimizationResult> {
  const cargoPool = await getCityCargoPool(cityId)

  const emptyResult: OptimizationResult = {
    city_id: cityId,
    total_depots: 0,
    total_cargo_instances: 0,
    total_value: 0,
    recommendations: [],
  }

  if (cargoPool.length === 0) {
    return emptyResult
  }

  const allTrailers = await getOwnableTrailerTypes()
  const cargoTrailerMappings = await getAllCargoTrailerMappings()

  // Build trailer -> cargo set mapping
  const trailerCargoes = new Map<number, Set<number>>()
  for (const mapping of cargoTrailerMappings) {
    if (!trailerCargoes.has(mapping.trailer_type_id)) {
      trailerCargoes.set(mapping.trailer_type_id, new Set())
    }
    trailerCargoes.get(mapping.trailer_type_id)!.add(mapping.cargo_type_id)
  }

  // Count total depots
  const depotCounts = new Map<number, number>()
  for (const entry of cargoPool) {
    depotCounts.set(entry.depot_type_id, entry.depot_count)
  }
  const totalDepotCount = [...depotCounts.values()].reduce((sum, c) => sum + c, 0)

  // Count total cargo instances and total value
  let totalCargoInstances = 0
  let totalCityValue = 0
  for (const entry of cargoPool) {
    totalCargoInstances += entry.depot_count
    totalCityValue += Number(entry.value) * entry.depot_count
  }

  // Calculate stats for each trailer
  const trailerStats: TrailerStats[] = []

  for (const trailer of allTrailers) {
    const cargoes = trailerCargoes.get(trailer.id)
    if (!cargoes) continue

    let totalValue = 0
    let jobOpportunities = 0

    for (const entry of cargoPool) {
      if (cargoes.has(entry.cargo_id)) {
        totalValue += Number(entry.value) * entry.depot_count
        jobOpportunities += entry.depot_count
      }
    }

    if (jobOpportunities > 0) {
      trailerStats.push({
        id: trailer.id,
        name: trailer.name,
        jobOpportunities,
        totalValue,
        avgValue: totalValue / jobOpportunities,
        coveragePct: (jobOpportunities / totalCargoInstances) * 100,
        valuePct: (totalValue / totalCityValue) * 100,
      })
    }
  }

  // Find max avg value for normalization
  const maxAvgValue = Math.max(...trailerStats.map((t) => t.avgValue))

  // Algorithm G: Coverage × Value - balanced approach
  // score = coverage% × (1 + normalized_avg_value)
  const scores = new Map<number, number>()
  for (const t of trailerStats) {
    const normalizedValue = t.avgValue / maxAvgValue
    const score = (t.coveragePct / 100) * (1 + normalizedValue)
    scores.set(t.id, score)
  }

  // Coverage-based diminishing factor
  // High coverage trailers get less diminishing (need more copies)
  // factor = 0.5 + (coverage% / 100) × 0.5
  // At 0% coverage: factor = 0.5 (strong diminishing)
  // At 40% coverage: factor = 0.7 (moderate diminishing)
  // At 100% coverage: factor = 1.0 (no diminishing)
  function getFactor(trailerId: number): number {
    const stats = trailerStats.find(t => t.id === trailerId)!
    return 0.5 + (stats.coveragePct / 100) * 0.5
  }

  // Greedy selection with coverage-based diminishing factor
  const selected = new Map<number, number>()
  for (let round = 0; round < maxTrailers; round++) {
    let bestId: number | null = null
    let bestScore = 0

    for (const [id, baseScore] of scores) {
      const picked = selected.get(id) ?? 0
      const factor = getFactor(id)
      const effective = baseScore * Math.pow(factor, picked)

      if (effective > bestScore) {
        bestScore = effective
        bestId = id
      }
    }

    if (bestId === null) break
    selected.set(bestId, (selected.get(bestId) ?? 0) + 1)
  }

  // Build recommendations
  const recommendations: TrailerRecommendation[] = []
  for (const [id, count] of selected) {
    const stats = trailerStats.find(t => t.id === id)!
    recommendations.push({
      trailer_id: id,
      trailer_name: stats.name,
      coverage_pct: Math.round(stats.coveragePct * 10) / 10,
      avg_value: Math.round(stats.avgValue * 100) / 100,
      score: Math.round((scores.get(id) ?? 0) * 1000) / 1000,
      count,
    })
  }
  recommendations.sort((a, b) => b.count - a.count || b.score - a.score)

  return {
    city_id: cityId,
    total_depots: totalDepotCount,
    total_cargo_instances: totalCargoInstances,
    total_value: Math.round(totalCityValue * 100) / 100,
    recommendations,
  }
}
