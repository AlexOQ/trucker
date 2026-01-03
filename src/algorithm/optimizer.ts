import { getCityCargoPool, getAllCargoTrailerMappings, getAllTrailerTypes } from '../db/queries.js'

interface CargoPoolEntry {
  depot_type_id: number
  depot_name: string
  depot_count: number
  cargo_id: number
  cargo_name: string
  value: number
}

interface TrailerRecommendation {
  trailer_id: number
  trailer_name: string
  amount: number
  coverage_percent: number
  covered_cargoes: string[]
}

interface OptimizationResult {
  city_id: number
  total_pool_value: number
  total_unique_cargoes: number
  recommendations: TrailerRecommendation[]
}

export async function optimizeTrailerSet(
  cityId: number,
  maxTrailers: number = 10
): Promise<OptimizationResult> {
  // Get cargo pool for city
  const cargoPool = await getCityCargoPool(cityId)

  if (cargoPool.length === 0) {
    return {
      city_id: cityId,
      total_pool_value: 0,
      total_unique_cargoes: 0,
      recommendations: [],
    }
  }

  // Get all trailer types and cargo-trailer mappings
  const allTrailers = await getAllTrailerTypes()
  const cargoTrailerMappings = await getAllCargoTrailerMappings()

  // Build trailer -> cargo set mapping
  const trailerCargoes = new Map<number, Set<number>>()
  for (const mapping of cargoTrailerMappings) {
    if (!trailerCargoes.has(mapping.trailer_type_id)) {
      trailerCargoes.set(mapping.trailer_type_id, new Set())
    }
    trailerCargoes.get(mapping.trailer_type_id)!.add(mapping.cargo_type_id)
  }

  // Calculate total pool value and unique cargoes
  // Each cargo's contribution = value * depot_count (for multiplicity)
  const uniqueCargoIds = new Set(cargoPool.map((e) => e.cargo_id))

  // Build weighted cargo value map (accounts for depot count multiplicity)
  // Each cargo's weight = sum of (value * depot_count) across all depot appearances
  const cargoWeights = new Map<number, number>()
  const cargoNames = new Map<number, string>()
  for (const entry of cargoPool) {
    const contribution = entry.value * entry.depot_count
    cargoWeights.set(entry.cargo_id, (cargoWeights.get(entry.cargo_id) ?? 0) + contribution)
    cargoNames.set(entry.cargo_id, entry.cargo_name)
  }

  const totalPoolValue = [...cargoWeights.values()].reduce((sum, v) => sum + v, 0)

  // Greedy selection
  const selectedTrailers: Map<number, number> = new Map() // trailer_id -> count
  const remainingCargoWeights = new Map(cargoWeights)

  for (let i = 0; i < maxTrailers; i++) {
    let bestTrailerId: number | null = null
    let bestValue = 0

    // Find trailer with highest remaining coverage value
    for (const trailer of allTrailers) {
      const cargoes = trailerCargoes.get(trailer.id)
      if (!cargoes) continue

      let coverageValue = 0
      for (const cargoId of cargoes) {
        coverageValue += remainingCargoWeights.get(cargoId) ?? 0
      }

      if (coverageValue > bestValue) {
        bestValue = coverageValue
        bestTrailerId = trailer.id
      }
    }

    if (bestTrailerId === null || bestValue === 0) break

    // Add trailer to selection
    selectedTrailers.set(bestTrailerId, (selectedTrailers.get(bestTrailerId) ?? 0) + 1)

    // Reduce remaining weights for covered cargoes (diminishing returns)
    const coveredCargoes = trailerCargoes.get(bestTrailerId)!
    for (const cargoId of coveredCargoes) {
      const currentWeight = remainingCargoWeights.get(cargoId) ?? 0
      // Each additional trailer covering same cargo has 50% diminishing returns
      remainingCargoWeights.set(cargoId, currentWeight * 0.5)
    }
  }

  // Build recommendations
  const recommendations: TrailerRecommendation[] = []

  for (const [trailerId, amount] of selectedTrailers) {
    const trailer = allTrailers.find((t) => t.id === trailerId)!
    const coveredCargoIds = trailerCargoes.get(trailerId) ?? new Set()

    // Coverage = cargoes this trailer can haul / total unique cargoes in pool
    const poolCargoIdsCovered = [...coveredCargoIds].filter((id) => uniqueCargoIds.has(id))
    const coveragePercent = (poolCargoIdsCovered.length / uniqueCargoIds.size) * 100

    recommendations.push({
      trailer_id: trailerId,
      trailer_name: trailer.name,
      amount,
      coverage_percent: Math.round(coveragePercent * 10) / 10,
      covered_cargoes: poolCargoIdsCovered.map((id) => cargoNames.get(id)!),
    })
  }

  // Sort by amount (descending), then coverage
  recommendations.sort((a, b) => b.amount - a.amount || b.coverage_percent - a.coverage_percent)

  return {
    city_id: cityId,
    total_pool_value: totalPoolValue,
    total_unique_cargoes: uniqueCargoIds.size,
    recommendations,
  }
}
