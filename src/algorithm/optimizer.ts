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
  normalizedValue: number
  coverage: number  // 0-1 range
  coveragePct: number  // 0-100 range
}

interface OptimizationOptions {
  scoringBalance?: number  // 0-100: 0 = pure value, 100 = pure coverage
  maxTrailers?: number     // 1-20: garage slots
  diminishingFactor?: number  // 0-100: 0 = no diminishing, 100 = strong
}

interface OptimizationResult {
  city_id: number
  total_depots: number
  total_cargo_instances: number
  total_value: number
  recommendations: TrailerRecommendation[]
  options: Required<OptimizationOptions>
}

/**
 * Calculate score for a trailer based on scoring balance
 * Matches frontend js/optimizer.js:74-78
 */
function calculateScore(trailer: TrailerStats, scoringBalance: number): number {
  const valueWeight = (100 - scoringBalance) / 100
  const coverageWeight = scoringBalance / 100
  return valueWeight * trailer.normalizedValue + coverageWeight * trailer.coverage
}

/**
 * Calculate diminishing factor for a trailer
 * Higher coverage = slower diminishing (need more copies)
 * Matches frontend js/optimizer.js:86-93
 */
function getDiminishingFactor(trailer: TrailerStats, diminishingStrength: number): number {
  const strength = diminishingStrength / 100
  const minFactor = 1 - (0.5 * strength)  // 1.0 at strength=0, 0.5 at strength=100
  const coverageBonus = trailer.coverage * 0.5 * strength
  return minFactor + coverageBonus
}

/**
 * Apply value bonuses for fragile and high_value cargo
 * +30% for each flag (can stack to +60%)
 * Matches frontend js/data.js:105-106
 */
function applyCargoBonus(value: number, fragile: boolean, highValue: boolean): number {
  const multiplier = 1 + (fragile ? 0.3 : 0) + (highValue ? 0.3 : 0)
  return value * multiplier
}

export async function optimizeTrailerSet(
  cityId: number,
  options: OptimizationOptions = {}
): Promise<OptimizationResult> {
  const {
    scoringBalance = 50,
    maxTrailers = 10,
    diminishingFactor = 50,
  } = options

  const resolvedOptions = { scoringBalance, maxTrailers, diminishingFactor }

  const cargoPool = await getCityCargoPool(cityId)

  const emptyResult: OptimizationResult = {
    city_id: cityId,
    total_depots: 0,
    total_cargo_instances: 0,
    total_value: 0,
    recommendations: [],
    options: resolvedOptions,
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

  // Count total cargo instances and total value (with bonuses applied)
  let totalCargoInstances = 0
  let totalCityValue = 0
  for (const entry of cargoPool) {
    const adjustedValue = applyCargoBonus(Number(entry.value), entry.fragile, entry.high_value)
    totalCargoInstances += entry.depot_count
    totalCityValue += adjustedValue * entry.depot_count
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
        const adjustedValue = applyCargoBonus(Number(entry.value), entry.fragile, entry.high_value)
        totalValue += adjustedValue * entry.depot_count
        jobOpportunities += entry.depot_count
      }
    }

    if (jobOpportunities > 0) {
      const coverage = jobOpportunities / totalCargoInstances
      trailerStats.push({
        id: trailer.id,
        name: trailer.name,
        jobOpportunities,
        totalValue,
        avgValue: totalValue / jobOpportunities,
        normalizedValue: 0,  // Will be set after we know max
        coverage,
        coveragePct: coverage * 100,
      })
    }
  }

  // Normalize values
  const maxAvgValue = Math.max(...trailerStats.map((t) => t.avgValue), 1)
  for (const t of trailerStats) {
    t.normalizedValue = t.avgValue / maxAvgValue
  }

  // Calculate base scores
  const baseScores = new Map<number, number>()
  for (const t of trailerStats) {
    baseScores.set(t.id, calculateScore(t, scoringBalance))
  }

  // Greedy selection with diminishing returns
  const selected = new Map<number, number>()
  for (let round = 0; round < maxTrailers; round++) {
    let bestId: number | null = null
    let bestScore = -1

    for (const t of trailerStats) {
      const base = baseScores.get(t.id)!
      const count = selected.get(t.id) ?? 0
      const factor = getDiminishingFactor(t, diminishingFactor)
      const effective = base * Math.pow(factor, count)

      if (effective > bestScore) {
        bestScore = effective
        bestId = t.id
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
      score: Math.round((baseScores.get(id) ?? 0) * 1000) / 1000,
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
    options: resolvedOptions,
  }
}
