import { db } from '../src/db/connection.js'

interface TrailerStats {
  id: number
  name: string
  coverage: number
  normalizedValue: number
  avgValue: number
}

async function getCityStats(cityId: number) {
  const cargoPool = await db
    .selectFrom('city_depots')
    .innerJoin('depot_types', 'depot_types.id', 'city_depots.depot_type_id')
    .innerJoin('depot_type_cargoes', 'depot_type_cargoes.depot_type_id', 'depot_types.id')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_type_cargoes.cargo_type_id')
    .select([
      'depot_types.id as depot_type_id',
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
  let totalValue = 0
  for (const entry of cargoPool) {
    totalInstances += entry.depot_count
    totalValue += Number(entry.value) * entry.depot_count
  }

  const stats: TrailerStats[] = []
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
      stats.push({
        id: trailer.id,
        name: trailer.name,
        coverage: trailerJobs / totalInstances,
        avgValue: trailerValue / trailerJobs,
        normalizedValue: 0
      })
    }
  }

  const maxAvg = Math.max(...stats.map(s => s.avgValue))
  for (const s of stats) {
    s.normalizedValue = s.avgValue / maxAvg
  }

  return { totalInstances, totalValue, stats }
}

function currentScore(t: TrailerStats): number {
  return t.coverage * (1 + t.normalizedValue)
}

function sliderScore(t: TrailerStats, slider: number): number {
  const valueWeight = (10 - slider) / 10
  const coverageWeight = slider / 10
  return valueWeight * t.normalizedValue + coverageWeight * t.coverage
}

async function main() {
  const cities = [
    { id: 219, name: 'İstanbul' },
    { id: 45, name: 'Madrid' },
    { id: 149, name: 'Belgrade' },
    { id: 1, name: 'Graz' },
    { id: 158, name: 'Split' },
    { id: 60, name: 'Sheffield' },
    { id: 322, name: 'Winsen' },
    { id: 376, name: 'Alta' },
  ]

  for (const city of cities) {
    const data = await getCityStats(city.id)
    if (!data) {
      console.log(`\n=== ${city.name} ===\nNo data\n`)
      continue
    }

    console.log(`\n=== ${city.name} === (${data.totalInstances} jobs, €${Math.round(data.totalValue)} total)`)
    console.log('Trailer          | Cov%  | €/job | Current | Sl=0  | Sl=5  | Sl=10')
    console.log('-----------------|-------|-------|---------|-------|-------|------')

    data.stats.sort((a, b) => currentScore(b) - currentScore(a))

    for (const t of data.stats.slice(0, 8)) {
      const cur = currentScore(t).toFixed(3)
      const s0 = sliderScore(t, 0).toFixed(3)
      const s5 = sliderScore(t, 5).toFixed(3)
      const s10 = sliderScore(t, 10).toFixed(3)
      const name = t.name.padEnd(16).slice(0, 16)
      const cov = (t.coverage * 100).toFixed(1).padStart(5)
      const val = t.avgValue.toFixed(2).padStart(5)
      console.log(`${name} | ${cov}% | ${val} | ${cur}   | ${s0} | ${s5} | ${s10}`)
    }
  }

  await db.destroy()
}

main()
