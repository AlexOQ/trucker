/**
 * Trailer Set Optimizer for ETS2 Trucker Advisor
 *
 * Optimizes trailer selection for AI driver garages based on:
 * - Coverage: percentage of available jobs a trailer can handle
 * - Value: average €/km for jobs a trailer can handle
 *
 * Parameters:
 * - scoringBalance: 0-100 slider (0 = pure value, 100 = pure coverage)
 * - maxTrailers: number of trailer slots in garage (1-20)
 * - diminishingFactor: 0-100 slider controlling duplicate trailer penalty
 */

import { getCityCargoPool, getOwnableTrailers } from './data.js';
import type { AllData, Lookups, CargoPoolEntry, Trailer } from './data.js';

interface TrailerStats {
  id: number;
  name: string;
  jobCount: number;
  totalValue: number;
  avgValue: number;
  coverage: number;
  normalizedValue: number;
  topCargoes: string[];
}

interface OptimizationOptions {
  scoringBalance?: number;
  maxTrailers?: number;
  diminishingFactor?: number;
}

interface TrailerRecommendation {
  trailerId: number;
  trailerName: string;
  count: number;
  coveragePct: number;
  avgValue: number;
  score: number;
  topCargoes: string[];
}

interface OptimizationResult {
  cityId: number;
  totalDepots: number;
  totalCargoInstances: number;
  totalValue: number;
  recommendations: TrailerRecommendation[];
  options: Required<OptimizationOptions>;
}

interface CityRanking {
  id: number;
  name: string;
  country: string;
  depotCount: number;
  jobs: number;
  totalValue: number;
  avgValuePerJob: number;
  score: number;
}

/**
 * Calculate trailer statistics for a city
 */
function calculateTrailerStats(
  cargoPool: CargoPoolEntry[],
  trailers: Trailer[],
  lookups: Lookups
): { stats: TrailerStats[]; totalInstances: number; totalValue: number } {
  // Calculate totals
  let totalInstances = 0;
  let totalValue = 0;
  for (const entry of cargoPool) {
    totalInstances += entry.depotCount;
    totalValue += entry.value * entry.depotCount;
  }

  if (totalInstances === 0) {
    return { stats: [], totalInstances: 0, totalValue: 0 };
  }

  // Calculate per-trailer stats
  const stats: TrailerStats[] = [];
  for (const trailer of trailers) {
    const compatibleCargo = lookups.trailerCargoMap.get(trailer.id);
    if (!compatibleCargo) continue;

    let trailerValue = 0;
    let trailerJobs = 0;
    const cargoContributions: Array<{ name: string; value: number; jobs: number }> = [];

    for (const entry of cargoPool) {
      if (compatibleCargo.has(entry.cargoId)) {
        const contribution = entry.value * entry.depotCount;
        trailerValue += contribution;
        trailerJobs += entry.depotCount;
        cargoContributions.push({
          name: entry.cargoName,
          value: contribution,
          jobs: entry.depotCount,
        });
      }
    }

    if (trailerJobs > 0) {
      // Get top 5 unique cargoes by value contribution
      const seen = new Set<string>();
      const topCargoes = cargoContributions
        .sort((a, b) => b.value - a.value)
        .filter((c) => {
          if (seen.has(c.name)) return false;
          seen.add(c.name);
          return true;
        })
        .slice(0, 5)
        .map((c) => c.name);

      stats.push({
        id: trailer.id,
        name: trailer.name,
        jobCount: trailerJobs,
        totalValue: trailerValue,
        avgValue: trailerValue / trailerJobs,
        coverage: trailerJobs / totalInstances,
        normalizedValue: 0, // Will be set below
        topCargoes,
      });
    }
  }

  // Normalize values
  const maxAvgValue = Math.max(...stats.map((s) => s.avgValue), 1);
  for (const s of stats) {
    s.normalizedValue = s.avgValue / maxAvgValue;
  }

  return { stats, totalInstances, totalValue };
}

/**
 * Calculate score for a trailer based on scoring balance
 */
function calculateScore(trailer: TrailerStats, scoringBalance: number): number {
  const valueWeight = (100 - scoringBalance) / 100;
  const coverageWeight = scoringBalance / 100;
  return valueWeight * trailer.normalizedValue + coverageWeight * trailer.coverage;
}

/**
 * Calculate diminishing factor for a trailer
 * Higher coverage = slower diminishing (need more copies)
 */
function getDiminishingFactor(trailer: TrailerStats, diminishingStrength: number): number {
  // Base factor range: 1.0 (no diminishing) to 0.5 (strong diminishing)
  // Adjusted by coverage: high coverage trailers diminish slower
  const strength = diminishingStrength / 100;
  const minFactor = 1 - 0.5 * strength; // 1.0 at strength=0, 0.5 at strength=100
  const coverageBonus = trailer.coverage * 0.5 * strength;
  return minFactor + coverageBonus;
}

/**
 * Optimize trailer set for a city
 */
export function optimizeTrailerSet(
  cityId: number,
  data: AllData,
  lookups: Lookups,
  options: OptimizationOptions = {}
): OptimizationResult {
  const {
    scoringBalance = 50, // 0-100: 0 = pure value, 100 = pure coverage
    maxTrailers = 10, // 1-20: garage slots
    diminishingFactor = 50, // 0-100: 0 = no diminishing, 100 = strong
  } = options;

  const cargoPool = getCityCargoPool(cityId, data, lookups);
  const trailers = getOwnableTrailers(data);

  const { stats, totalInstances, totalValue } = calculateTrailerStats(cargoPool, trailers, lookups);

  if (stats.length === 0) {
    return {
      cityId,
      totalDepots: 0,
      totalCargoInstances: 0,
      totalValue: 0,
      recommendations: [],
      options: { scoringBalance, maxTrailers, diminishingFactor },
    };
  }

  // Count unique depots
  const depotCounts = new Map<number, number>();
  const cityCompanies = lookups.cityCompanyMap.get(cityId) || [];
  for (const { companyId, count } of cityCompanies) {
    depotCounts.set(companyId, count);
  }
  const totalDepots = Array.from(depotCounts.values()).reduce((sum, c) => sum + c, 0);

  // Calculate base scores
  const baseScores = new Map<number, number>();
  for (const t of stats) {
    baseScores.set(t.id, calculateScore(t, scoringBalance));
  }

  // Greedy selection with diminishing returns
  const selected = new Map<number, number>();
  for (let round = 0; round < maxTrailers; round++) {
    let bestId: number | null = null;
    let bestScore = -1;

    for (const t of stats) {
      const base = baseScores.get(t.id)!;
      const count = selected.get(t.id) || 0;
      const factor = getDiminishingFactor(t, diminishingFactor);
      const effective = base * Math.pow(factor, count);

      if (effective > bestScore) {
        bestScore = effective;
        bestId = t.id;
      }
    }

    if (bestId === null) break;
    selected.set(bestId, (selected.get(bestId) || 0) + 1);
  }

  // Build recommendations
  const recommendations: TrailerRecommendation[] = [];
  for (const [id, count] of Array.from(selected.entries())) {
    const trailer = stats.find((t) => t.id === id)!;
    recommendations.push({
      trailerId: id,
      trailerName: trailer.name,
      count,
      coveragePct: Math.round(trailer.coverage * 1000) / 10,
      avgValue: Math.round(trailer.avgValue * 100) / 100,
      score: Math.round(baseScores.get(id)! * 1000) / 1000,
      topCargoes: trailer.topCargoes,
    });
  }
  recommendations.sort((a, b) => b.count - a.count || b.score - a.score);

  return {
    cityId,
    totalDepots,
    totalCargoInstances: totalInstances,
    totalValue: Math.round(totalValue * 100) / 100,
    recommendations,
    options: { scoringBalance, maxTrailers, diminishingFactor },
  };
}

/**
 * Calculate city rankings based on profitability
 */
export function calculateCityRankings(
  data: AllData,
  lookups: Lookups,
  options: OptimizationOptions = {}
): CityRanking[] {
  const rankings: CityRanking[] = [];

  for (const city of data.cities) {
    const result = optimizeTrailerSet(city.id, data, lookups, options);

    if (result.totalCargoInstances === 0) continue;

    const jobs = result.totalCargoInstances;
    const value = result.totalValue;

    // Geometric mean: balances job availability and total value
    const score = Math.sqrt(jobs * value);
    const avgValuePerJob = jobs > 0 ? value / jobs : 0;

    rankings.push({
      id: city.id,
      name: city.name,
      country: city.country,
      depotCount: result.totalDepots,
      jobs,
      totalValue: Math.round(value),
      avgValuePerJob: Math.round(avgValuePerJob * 100) / 100,
      score: Math.round(score * 10) / 10,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}

/**
 * Default options with descriptions
 */
export const defaultOptions = {
  scoringBalance: 50, // 0 = prioritize high-value jobs, 100 = prioritize job variety
  maxTrailers: 10, // Garage capacity
  diminishingFactor: 50, // How quickly duplicate trailers lose value
};

export const optionDescriptions = {
  scoringBalance: {
    label: 'Value ↔ Coverage',
    min: 0,
    max: 100,
    step: 1,
    minLabel: 'High €/km',
    maxLabel: 'More variety',
    description: 'Balance between high-paying jobs vs job variety',
  },
  maxTrailers: {
    label: 'Garage Size',
    min: 1,
    max: 20,
    step: 1,
    description: 'Number of trailer slots in garage',
  },
  diminishingFactor: {
    label: 'Diversity Pressure',
    min: 0,
    max: 100,
    step: 1,
    minLabel: 'Allow duplicates',
    maxLabel: 'Force variety',
    description: 'How quickly duplicate trailers lose priority',
  },
};
