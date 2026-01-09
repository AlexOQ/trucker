import { db } from '../src/db/connection.js'

interface TrailerStats {
  id: number
  name: string
  coverage: number
  normalizedValue: number
}

async function getCityStats(cityId: number) {
  const cargoPool = await db
    .selectFrom('city_depots')
    .innerJoin('depot_types', 'depot_types.id', 'city_depots.depot_type_id')
    .innerJoin('depot_type_cargoes', 'depot_type_cargoes.depot_type_id', 'depot_types.id')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_type_cargoes.cargo_type_id')
    .select([
      'city_depots.count as depot_count',
      'cargo_types.id as cargo_id',
      'cargo_types.value',
    ])
    .where('city_depots.city_id', '=', cityId)
    .where('cargo_types.excluded', '=', false)
    .execute()

  if (cargoPool.length === 0) return null

  const trailers = await db
    .selectFrom('trailer_types')
    .selectAll()
    .where('ownable', '=', true)
    .execute()

  const mappings = await db
    .selectFrom('cargo_trailers')
    .select(['cargo_type_id', 'trailer_type_id'])
    .execute()

  const trailerCargoes = new Map<number, Set<number>>()
  for (const m of mappings) {
    if (!trailerCargoes.has(m.trailer_type_id)) {
      trailerCargoes.set(m.trailer_type_id, new Set())
    }
    trailerCargoes.get(m.trailer_type_id)!.add(m.cargo_type_id)
  }

  let totalInstances = 0
  for (const entry of cargoPool) {
    totalInstances += entry.depot_count
  }

  const stats: TrailerStats[] = []
  let maxAvg = 0

  for (const trailer of trailers) {
    const cargoes = trailerCargoes.get(trailer.id)
    if (!cargoes) continue

    let trailerValue = 0
    let trailerJobs = 0
    for (const entry of cargoPool) {
      if (cargoes.has(entry.cargo_id)) {
        trailerValue += Number(entry.value) * entry.depot_count
        trailerJobs += entry.depot_count
      }
    }

    if (trailerJobs > 0) {
      const avgValue = trailerValue / trailerJobs
      maxAvg = Math.max(maxAvg, avgValue)
      stats.push({
        id: trailer.id,
        name: trailer.name,
        coverage: trailerJobs / totalInstances,
        normalizedValue: avgValue // will normalize below
      })
    }
  }

  for (const s of stats) {
    s.normalizedValue = s.normalizedValue / maxAvg
  }

  return stats
}

function sliderScore(t: TrailerStats, slider: number): number {
  const valueWeight = (10 - slider) / 10
  const coverageWeight = slider / 10
  return valueWeight * t.normalizedValue + coverageWeight * t.coverage
}

function getDiminishingFactor(t: TrailerStats): number {
  // Current formula: higher coverage = less diminishing
  return 0.5 + t.coverage * 0.5
}

function simulatePicks(stats: TrailerStats[], slider: number, maxPicks: number = 10): Map<string, number> {
  const baseScores = new Map<number, number>()
  for (const t of stats) {
    baseScores.set(t.id, sliderScore(t, slider))
  }

  const picked = new Map<number, number>()
  const result = new Map<string, number>()

  for (let round = 0; round < maxPicks; round++) {
    let bestId: number | null = null
    let bestScore = -1

    for (const t of stats) {
      const base = baseScores.get(t.id)!
      const count = picked.get(t.id) ?? 0
      const factor = getDiminishingFactor(t)
      const effective = base * Math.pow(factor, count)

      if (effective > bestScore) {
        bestScore = effective
        bestId = t.id
      }
    }

    if (bestId === null) break
    picked.set(bestId, (picked.get(bestId) ?? 0) + 1)
    const name = stats.find(s => s.id === bestId)!.name
    result.set(name, (result.get(name) ?? 0) + 1)
  }

  return result
}

function formatPicks(picks: Map<string, number>): string {
  const arr = [...picks.entries()].sort((a, b) => b[1] - a[1])
  return arr.map(([name, count]) => `${count}×${name.slice(0, 12)}`).join(', ')
}

async function main() {
  const cities = [
    { id: 219, name: 'İstanbul' },
    { id: 45, name: 'Madrid' },
    { id: 149, name: 'Belgrade' },
    { id: 60, name: 'Sheffield' },
    { id: 376, name: 'Alta' },
  ]

  console.log('Simulating 10 trailer picks at different slider values:\n')

  for (const city of cities) {
    const stats = await getCityStats(city.id)
    if (!stats) continue

    console.log(`=== ${city.name} ===`)
    for (const slider of [0, 2, 5, 8, 10]) {
      const picks = simulatePicks(stats, slider)
      console.log(`  Slider ${slider.toString().padStart(2)}: ${formatPicks(picks)}`)
    }
    console.log()
  }

  await db.destroy()
}

main()
