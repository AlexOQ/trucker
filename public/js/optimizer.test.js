import { describe, it, expect } from 'vitest'
import { optimizeTrailerSet, calculateCityRankings } from './optimizer.js'

describe('optimizer', () => {
  // Mock data factory
  const createMockData = () => ({
    cities: [
      { id: 1, name: 'Berlin', country: 'Germany' },
      { id: 2, name: 'Paris', country: 'France' },
      { id: 3, name: 'EmptyCity', country: 'Test' },
    ],
    companies: [
      { id: 1, name: 'Logistics Co' },
      { id: 2, name: 'Transport Inc' },
    ],
    cargo: [
      { id: 1, name: 'Electronics', value: 2.5, excluded: false, fragile: false, high_value: false },
      { id: 2, name: 'Machinery', value: 3.0, excluded: false, fragile: false, high_value: false },
      { id: 3, name: 'Chemicals', value: 4.0, excluded: false, fragile: true, high_value: false },
      { id: 4, name: 'Furniture', value: 1.5, excluded: false, fragile: false, high_value: false },
      { id: 5, name: 'Excluded Cargo', value: 10.0, excluded: true, fragile: false, high_value: false },
    ],
    trailers: [
      { id: 1, name: 'Box Trailer', ownable: true },
      { id: 2, name: 'Flatbed', ownable: true },
      { id: 3, name: 'Tanker', ownable: true },
      { id: 4, name: 'Non-Ownable', ownable: false },
    ],
    cityCompanies: [
      { cityId: 1, companyId: 1, count: 3 },
      { cityId: 1, companyId: 2, count: 2 },
      { cityId: 2, companyId: 1, count: 1 },
      // city 3 has no companies (empty city test case)
    ],
    companyCargo: [
      { companyId: 1, cargoId: 1 },
      { companyId: 1, cargoId: 2 },
      { companyId: 1, cargoId: 3 },
      { companyId: 2, cargoId: 2 },
      { companyId: 2, cargoId: 4 },
      { companyId: 1, cargoId: 5 }, // excluded cargo
    ],
    cargoTrailers: [
      { cargoId: 1, trailerId: 1 },
      { cargoId: 1, trailerId: 2 },
      { cargoId: 2, trailerId: 2 },
      { cargoId: 2, trailerId: 3 },
      { cargoId: 3, trailerId: 3 },
      { cargoId: 4, trailerId: 1 },
      { cargoId: 5, trailerId: 1 }, // excluded cargo
    ],
  })

  const createMockLookups = (data) => {
    const citiesById = new Map(data.cities.map(c => [c.id, c]))
    const companiesById = new Map(data.companies.map(c => [c.id, c]))
    const cargoById = new Map(data.cargo.map(c => [c.id, c]))
    const trailersById = new Map(data.trailers.map(t => [t.id, t]))

    const cityCompanyMap = new Map()
    for (const cc of data.cityCompanies) {
      if (!cityCompanyMap.has(cc.cityId)) {
        cityCompanyMap.set(cc.cityId, [])
      }
      cityCompanyMap.get(cc.cityId).push({ companyId: cc.companyId, count: cc.count })
    }

    const companyCargoMap = new Map()
    for (const cc of data.companyCargo) {
      if (!companyCargoMap.has(cc.companyId)) {
        companyCargoMap.set(cc.companyId, [])
      }
      companyCargoMap.get(cc.companyId).push(cc.cargoId)
    }

    const trailerCargoMap = new Map()
    for (const ct of data.cargoTrailers) {
      if (!trailerCargoMap.has(ct.trailerId)) {
        trailerCargoMap.set(ct.trailerId, new Set())
      }
      trailerCargoMap.get(ct.trailerId).add(ct.cargoId)
    }

    const cargoTrailerMap = new Map()
    for (const ct of data.cargoTrailers) {
      if (!cargoTrailerMap.has(ct.cargoId)) {
        cargoTrailerMap.set(ct.cargoId, new Set())
      }
      cargoTrailerMap.get(ct.cargoId).add(ct.trailerId)
    }

    return {
      citiesById,
      companiesById,
      cargoById,
      trailersById,
      cityCompanyMap,
      companyCargoMap,
      trailerCargoMap,
      cargoTrailerMap,
    }
  }

  describe('optimizeTrailerSet', () => {
    it('returns empty recommendations for city with no depots', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(3, data, lookups)

      expect(result.cityId).toBe(3)
      expect(result.totalDepots).toBe(0)
      expect(result.totalCargoInstances).toBe(0)
      expect(result.totalValue).toBe(0)
      expect(result.recommendations).toEqual([])
    })

    it('optimizes trailer set for city with cargo', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      expect(result.cityId).toBe(1)
      expect(result.totalDepots).toBe(5) // 3 + 2 depots
      expect(result.totalCargoInstances).toBeGreaterThan(0)
      expect(result.totalValue).toBeGreaterThan(0)
      expect(result.recommendations.length).toBeGreaterThan(0)
      expect(result.recommendations.length).toBeLessThanOrEqual(10)
    })

    it('excludes non-ownable trailers from recommendations', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      const nonOwnableRec = result.recommendations.find(r => r.trailerId === 4)
      expect(nonOwnableRec).toBeUndefined()
    })

    it('excludes excluded cargo from value calculations', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      // Cargo 5 is excluded and worth 10.0 - should not contribute to value
      const result = optimizeTrailerSet(1, data, lookups)

      // Total value should not include excluded cargo's value
      // City 1 has:
      // - Electronics (2.5) x 3 depots = 7.5
      // - Machinery (3.0) x 5 depots = 15.0 (company 1: 3, company 2: 2)
      // - Chemicals (4.0 * 1.3 fragile bonus) x 3 depots = 15.6
      // - Furniture (1.5) x 2 depots = 3.0
      // Total: 7.5 + 15.0 + 15.6 + 3.0 = 41.1
      expect(result.totalValue).toBe(41.1)
    })

    it('respects maxTrailers option', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result3 = optimizeTrailerSet(1, data, lookups, { maxTrailers: 3 })
      const result10 = optimizeTrailerSet(1, data, lookups, { maxTrailers: 10 })

      expect(result3.recommendations.length).toBeLessThanOrEqual(3)
      expect(result10.recommendations.length).toBeLessThanOrEqual(10)

      // Count total trailers (sum of counts)
      const totalCount3 = result3.recommendations.reduce((sum, r) => sum + r.count, 0)
      const totalCount10 = result10.recommendations.reduce((sum, r) => sum + r.count, 0)

      expect(totalCount3).toBe(3)
      expect(totalCount10).toBe(10)
    })

    it('handles maxTrailers: 1 correctly', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { maxTrailers: 1 })

      expect(result.recommendations.length).toBe(1)
      expect(result.recommendations[0].count).toBe(1)
    })

    it('handles maxTrailers: 20 correctly', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { maxTrailers: 20 })

      const totalCount = result.recommendations.reduce((sum, r) => sum + r.count, 0)
      expect(totalCount).toBe(20)
    })

    it('applies scoringBalance: 0 (pure value optimization)', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { scoringBalance: 0, maxTrailers: 3 })

      // With pure value optimization, should prioritize trailers with highest avgValue
      expect(result.recommendations.length).toBeGreaterThan(0)
      expect(result.recommendations[0]).toHaveProperty('avgValue')
    })

    it('applies scoringBalance: 100 (pure coverage optimization)', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { scoringBalance: 100, maxTrailers: 3 })

      // With pure coverage optimization, should prioritize trailers with highest coverage
      expect(result.recommendations.length).toBeGreaterThan(0)
      expect(result.recommendations[0]).toHaveProperty('coveragePct')
    })

    it('applies diminishingFactor: 0 (no penalty for duplicates)', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { diminishingFactor: 0, maxTrailers: 10 })

      // With no diminishing, might select many copies of the same trailer
      const maxCount = Math.max(...result.recommendations.map(r => r.count))
      // At least one trailer should have multiple copies
      expect(maxCount).toBeGreaterThan(1)
    })

    it('applies diminishingFactor: 100 (strong penalty for duplicates)', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { diminishingFactor: 100, maxTrailers: 10 })

      // With strong diminishing, should prefer variety
      // Most trailers should have count of 1
      const countOnes = result.recommendations.filter(r => r.count === 1).length
      expect(countOnes).toBeGreaterThan(0)
    })

    it('includes correct metadata in each recommendation', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      for (const rec of result.recommendations) {
        expect(rec).toHaveProperty('trailerId')
        expect(rec).toHaveProperty('trailerName')
        expect(rec).toHaveProperty('count')
        expect(rec).toHaveProperty('coveragePct')
        expect(rec).toHaveProperty('avgValue')
        expect(rec).toHaveProperty('score')
        expect(rec).toHaveProperty('topCargoes')

        expect(typeof rec.trailerId).toBe('number')
        expect(typeof rec.trailerName).toBe('string')
        expect(rec.count).toBeGreaterThan(0)
        expect(rec.coveragePct).toBeGreaterThanOrEqual(0)
        expect(rec.avgValue).toBeGreaterThan(0)
        expect(rec.score).toBeGreaterThan(0)
        expect(Array.isArray(rec.topCargoes)).toBe(true)
        expect(rec.topCargoes.length).toBeLessThanOrEqual(5)
      }
    })

    it('sorts recommendations by count DESC, then score DESC', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { maxTrailers: 10 })

      for (let i = 0; i < result.recommendations.length - 1; i++) {
        const curr = result.recommendations[i]
        const next = result.recommendations[i + 1]

        // Higher count should come first, or if equal count, higher score
        if (curr.count === next.count) {
          expect(curr.score).toBeGreaterThanOrEqual(next.score)
        } else {
          expect(curr.count).toBeGreaterThan(next.count)
        }
      }
    })

    it('preserves options in result', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const options = {
        scoringBalance: 75,
        maxTrailers: 15,
        diminishingFactor: 30,
      }

      const result = optimizeTrailerSet(1, data, lookups, options)

      expect(result.options).toEqual(options)
    })

    it('uses default options when not provided', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      expect(result.options.scoringBalance).toBe(50)
      expect(result.options.maxTrailers).toBe(10)
      expect(result.options.diminishingFactor).toBe(50)
    })

    it('applies fragile cargo bonus correctly', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      // Cargo 3 (Chemicals) is fragile with value 4.0
      // Should get 30% bonus: 4.0 * 1.3 = 5.2
      // It appears 3 times (company 1, 3 depots)
      // Contribution: 5.2 * 3 = 15.6

      const result = optimizeTrailerSet(1, data, lookups)

      // Tanker (id 3) can haul Chemicals and Machinery
      const tankerRec = result.recommendations.find(r => r.trailerId === 3)
      expect(tankerRec).toBeDefined()
      // Total value should reflect the bonus
      expect(result.totalValue).toBeGreaterThan(41.0) // without bonus would be ~41.1
    })
  })

  describe('calculateCityRankings', () => {
    it('returns ranked cities by profitability score', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const rankings = calculateCityRankings(data, lookups)

      expect(rankings.length).toBeGreaterThan(0)

      // Rankings should be sorted by score DESC
      for (let i = 0; i < rankings.length - 1; i++) {
        expect(rankings[i].score).toBeGreaterThanOrEqual(rankings[i + 1].score)
      }
    })

    it('excludes cities with no cargo', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const rankings = calculateCityRankings(data, lookups)

      const emptyCity = rankings.find(r => r.id === 3)
      expect(emptyCity).toBeUndefined()
    })

    it('includes correct metadata for each city', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const rankings = calculateCityRankings(data, lookups)

      for (const rank of rankings) {
        expect(rank).toHaveProperty('id')
        expect(rank).toHaveProperty('name')
        expect(rank).toHaveProperty('country')
        expect(rank).toHaveProperty('depotCount')
        expect(rank).toHaveProperty('jobs')
        expect(rank).toHaveProperty('totalValue')
        expect(rank).toHaveProperty('avgValuePerJob')
        expect(rank).toHaveProperty('score')

        expect(typeof rank.id).toBe('number')
        expect(typeof rank.name).toBe('string')
        expect(typeof rank.country).toBe('string')
        expect(rank.depotCount).toBeGreaterThan(0)
        expect(rank.jobs).toBeGreaterThan(0)
        expect(rank.totalValue).toBeGreaterThan(0)
        expect(rank.avgValuePerJob).toBeGreaterThan(0)
        expect(rank.score).toBeGreaterThan(0)
      }
    })

    it('calculates score as geometric mean of jobs and value', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const rankings = calculateCityRankings(data, lookups)

      for (const rank of rankings) {
        const expectedScore = Math.round(Math.sqrt(rank.jobs * rank.totalValue) * 10) / 10
        expect(rank.score).toBe(expectedScore)
      }
    })

    it('respects optimization options', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const options = {
        scoringBalance: 100,
        maxTrailers: 5,
        diminishingFactor: 0,
      }

      const rankings = calculateCityRankings(data, lookups, options)

      // Results may differ with different options
      expect(rankings.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('handles city with single depot type', () => {
      const data = createMockData()
      // Modify to have only one company
      data.cityCompanies = [{ cityId: 1, companyId: 1, count: 1 }]
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      expect(result.totalDepots).toBe(1)
      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it('handles city where all cargo is excluded', () => {
      const data = createMockData()
      // Mark all cargo as excluded
      data.cargo.forEach(c => { c.excluded = true })
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      expect(result.totalCargoInstances).toBe(0)
      expect(result.recommendations).toEqual([])
    })

    it('handles city with single compatible trailer type', () => {
      const data = createMockData()
      // Make only Box Trailer ownable
      data.trailers = [
        { id: 1, name: 'Box Trailer', ownable: true },
        { id: 2, name: 'Flatbed', ownable: false },
        { id: 3, name: 'Tanker', ownable: false },
      ]
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { maxTrailers: 10 })

      // Should select only Box Trailer
      expect(result.recommendations.length).toBe(1)
      expect(result.recommendations[0].trailerId).toBe(1)
      expect(result.recommendations[0].count).toBe(10)
    })

    it('handles cargo with both fragile and high_value bonuses', () => {
      const data = createMockData()
      // Add cargo with both bonuses
      data.cargo.push({ id: 6, name: 'Precious Goods', value: 5.0, excluded: false, fragile: true, high_value: true })
      data.companyCargo.push({ companyId: 1, cargoId: 6 })
      data.cargoTrailers.push({ cargoId: 6, trailerId: 1 })
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups)

      // Precious Goods should get 60% bonus (30% fragile + 30% high_value)
      // Value: 5.0 * 1.6 = 8.0 per depot
      // Appears 3 times (company 1, 3 depots): 8.0 * 3 = 24.0
      // Total value should include this contribution
      expect(result.totalValue).toBeGreaterThan(65.0) // previous 41.1 + 24.0
    })

    it('handles very large maxTrailers value', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result = optimizeTrailerSet(1, data, lookups, { maxTrailers: 100 })

      // Should still work, but total count limited by available trailer types
      const totalCount = result.recommendations.reduce((sum, r) => sum + r.count, 0)
      expect(totalCount).toBe(100)
    })

    it('handles scoringBalance edge values correctly', () => {
      const data = createMockData()
      const lookups = createMockLookups(data)

      const result0 = optimizeTrailerSet(1, data, lookups, { scoringBalance: 0 })
      const result100 = optimizeTrailerSet(1, data, lookups, { scoringBalance: 100 })

      expect(result0.recommendations.length).toBeGreaterThan(0)
      expect(result100.recommendations.length).toBeGreaterThan(0)

      // Results may differ based on scoring strategy
      expect(result0.options.scoringBalance).toBe(0)
      expect(result100.options.scoringBalance).toBe(100)
    })
  })
})
