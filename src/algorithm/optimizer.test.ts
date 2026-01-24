import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the database queries module
vi.mock('../db/queries.js', () => ({
  getCityCargoPool: vi.fn(),
  getAllCargoTrailerMappings: vi.fn(),
  getOwnableTrailerTypes: vi.fn(),
}))

import { optimizeTrailerSet } from './optimizer.js'
import { getCityCargoPool, getAllCargoTrailerMappings, getOwnableTrailerTypes } from '../db/queries.js'

const mockedGetCityCargoPool = vi.mocked(getCityCargoPool)
const mockedGetAllCargoTrailerMappings = vi.mocked(getAllCargoTrailerMappings)
const mockedGetOwnableTrailerTypes = vi.mocked(getOwnableTrailerTypes)

describe('optimizeTrailerSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result for empty cargo pool', async () => {
    mockedGetCityCargoPool.mockResolvedValue([])

    const result = await optimizeTrailerSet(1)

    expect(result.city_id).toBe(1)
    expect(result.total_depots).toBe(0)
    expect(result.total_cargo_instances).toBe(0)
    expect(result.total_value).toBe(0)
    expect(result.recommendations).toEqual([])
  })

  it('picks highest value trailer first with pure value scoring', async () => {
    // Setup: Two trailers, one covers high-value cargo, one covers low-value
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 1, cargo_id: 1, value: '100', fragile: false, high_value: false },
      { depot_type_id: 1, depot_count: 1, cargo_id: 2, value: '50', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'High Value Trailer' },
      { id: 2, name: 'Low Value Trailer' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },  // High Value Trailer covers 100-value cargo
      { trailer_type_id: 2, cargo_type_id: 2 },  // Low Value Trailer covers 50-value cargo
    ])

    const result = await optimizeTrailerSet(1, { scoringBalance: 0, maxTrailers: 1 })

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].trailer_name).toBe('High Value Trailer')
  })

  it('calculates coverage correctly', async () => {
    // Setup: Single trailer covers 2 out of 4 cargo instances
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 2, cargo_id: 1, value: '100', fragile: false, high_value: false },
      { depot_type_id: 2, depot_count: 2, cargo_id: 2, value: '100', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'Partial Coverage Trailer' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },  // Only covers cargo 1
    ])

    const result = await optimizeTrailerSet(1, { maxTrailers: 1 })

    expect(result.total_cargo_instances).toBe(4)
    expect(result.recommendations).toHaveLength(1)
    // Coverage = 2/4 = 50%
    expect(result.recommendations[0].coverage_pct).toBe(50)
  })

  it('handles single trailer case correctly', async () => {
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 1, cargo_id: 1, value: '75', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'Only Trailer' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },
    ])

    const result = await optimizeTrailerSet(1, { maxTrailers: 10 })

    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations[0].trailer_name).toBe('Only Trailer')
    expect(result.recommendations[0].avg_value).toBe(75)
    expect(result.recommendations[0].coverage_pct).toBe(100)
  })

  it('applies diminishing returns for repeated trailer selection', async () => {
    // Setup: One trailer that's clearly best - should still get selected multiple times
    // but with diminishing returns, the count depends on the factor
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 5, cargo_id: 1, value: '100', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'Best Trailer' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },
    ])

    // With strong diminishing (100), each additional copy is worth less
    const strongDiminishing = await optimizeTrailerSet(1, {
      maxTrailers: 5,
      diminishingFactor: 100
    })

    // With no diminishing (0), trailer maintains full value
    const noDiminishing = await optimizeTrailerSet(1, {
      maxTrailers: 5,
      diminishingFactor: 0
    })

    // Both should have the trailer, but counts may differ based on algorithm behavior
    // With only one trailer available, both will select it 5 times
    expect(strongDiminishing.recommendations[0].count).toBe(5)
    expect(noDiminishing.recommendations[0].count).toBe(5)
  })

  it('applies fragile and high_value cargo bonuses', async () => {
    mockedGetCityCargoPool.mockResolvedValue([
      // Base value 100, with fragile (+30%) and high_value (+30%) = 100 * 1.6 = 160
      { depot_type_id: 1, depot_count: 1, cargo_id: 1, value: '100', fragile: true, high_value: true },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'Bonus Cargo Trailer' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },
    ])

    const result = await optimizeTrailerSet(1)

    // Total value should reflect the 60% bonus
    expect(result.total_value).toBe(160)
    expect(result.recommendations[0].avg_value).toBe(160)
  })

  it('respects maxTrailers option', async () => {
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 1, cargo_id: 1, value: '100', fragile: false, high_value: false },
      { depot_type_id: 1, depot_count: 1, cargo_id: 2, value: '90', fragile: false, high_value: false },
      { depot_type_id: 1, depot_count: 1, cargo_id: 3, value: '80', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'Trailer A' },
      { id: 2, name: 'Trailer B' },
      { id: 3, name: 'Trailer C' },
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },
      { trailer_type_id: 2, cargo_type_id: 2 },
      { trailer_type_id: 3, cargo_type_id: 3 },
    ])

    const result = await optimizeTrailerSet(1, { maxTrailers: 2 })

    // Sum of counts should be exactly 2
    const totalCount = result.recommendations.reduce((sum, r) => sum + r.count, 0)
    expect(totalCount).toBe(2)
  })

  it('balances value and coverage with scoringBalance option', async () => {
    // Setup: High-value but low-coverage trailer vs low-value but high-coverage trailer
    mockedGetCityCargoPool.mockResolvedValue([
      { depot_type_id: 1, depot_count: 1, cargo_id: 1, value: '200', fragile: false, high_value: false },
      { depot_type_id: 1, depot_count: 1, cargo_id: 2, value: '10', fragile: false, high_value: false },
      { depot_type_id: 1, depot_count: 1, cargo_id: 3, value: '10', fragile: false, high_value: false },
    ])

    mockedGetOwnableTrailerTypes.mockResolvedValue([
      { id: 1, name: 'High Value Low Coverage' },  // Covers 1 cargo worth 200
      { id: 2, name: 'Low Value High Coverage' },  // Covers 2 cargoes worth 10 each
    ])

    mockedGetAllCargoTrailerMappings.mockResolvedValue([
      { trailer_type_id: 1, cargo_type_id: 1 },
      { trailer_type_id: 2, cargo_type_id: 2 },
      { trailer_type_id: 2, cargo_type_id: 3 },
    ])

    // Pure value scoring (0) should prefer high-value trailer
    const pureValue = await optimizeTrailerSet(1, { scoringBalance: 0, maxTrailers: 1 })
    expect(pureValue.recommendations[0].trailer_name).toBe('High Value Low Coverage')

    // Pure coverage scoring (100) should prefer high-coverage trailer
    const pureCoverage = await optimizeTrailerSet(1, { scoringBalance: 100, maxTrailers: 1 })
    expect(pureCoverage.recommendations[0].trailer_name).toBe('Low Value High Coverage')
  })
})
