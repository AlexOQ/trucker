import { db } from '../src/db/connection.js'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')

// Check for --all flag to include cargo/trailers (reviewed last)
const exportAll = process.argv.includes('--all')

// Ensure data directory exists
mkdirSync(dataDir, { recursive: true })

function writeJson(filename: string, data: unknown) {
  const path = join(dataDir, filename)
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  console.log(`Wrote ${path}`)
}

async function exportData() {
  console.log('Exporting database to JSON...')
  if (!exportAll) {
    console.log('(Skipping cargo/trailers - use --all after review)\n')
  } else {
    console.log('(Including all data)\n')
  }

  // Cities
  const cities = await db
    .selectFrom('cities')
    .select(['id', 'name', 'country'])
    .orderBy('country')
    .orderBy('name')
    .execute()
  writeJson('cities.json', cities)

  // Companies (depot_types)
  const companies = await db
    .selectFrom('depot_types')
    .select(['id', 'name'])
    .orderBy('name')
    .execute()
  writeJson('companies.json', companies)

  // Cargo (only with --all flag)
  let cargo: { id: number; name: string; value: number; excluded: boolean; high_value: boolean; fragile: boolean }[] = []
  if (exportAll) {
    const cargoRaw = await db
      .selectFrom('cargo_types')
      .select(['id', 'name', 'value', 'excluded', 'high_value', 'fragile'])
      .orderBy('name')
      .execute()
    cargo = cargoRaw.map(c => ({
      ...c,
      value: Number(c.value)
    }))
    writeJson('cargo.json', cargo)
  }

  // Trailers (only with --all flag)
  let trailers: { id: number; name: string; ownable: boolean }[] = []
  if (exportAll) {
    trailers = await db
      .selectFrom('trailer_types')
      .select(['id', 'name', 'ownable'])
      .orderBy('name')
      .execute()
    writeJson('trailers.json', trailers)
  }

  // City-Companies (city_depots)
  const cityCompanies = await db
    .selectFrom('city_depots')
    .select([
      'city_id as cityId',
      'depot_type_id as companyId',
      'count'
    ])
    .orderBy('city_id')
    .orderBy('depot_type_id')
    .execute()
  writeJson('city-companies.json', cityCompanies)

  // Company-Cargo (depot_type_cargoes)
  const companyCargo = await db
    .selectFrom('depot_type_cargoes')
    .select([
      'depot_type_id as companyId',
      'cargo_type_id as cargoId'
    ])
    .orderBy('depot_type_id')
    .orderBy('cargo_type_id')
    .execute()
  writeJson('company-cargo.json', companyCargo)

  // Cargo-Trailers (only with --all flag)
  let cargoTrailers: { cargoId: number; trailerId: number }[] = []
  if (exportAll) {
    cargoTrailers = await db
      .selectFrom('cargo_trailers')
      .select([
        'cargo_type_id as cargoId',
        'trailer_type_id as trailerId'
      ])
      .orderBy('cargo_type_id')
      .orderBy('trailer_type_id')
      .execute()
    writeJson('cargo-trailers.json', cargoTrailers)
  }

  // Summary
  console.log('\nExport complete:')
  console.log(`  Cities: ${cities.length}`)
  console.log(`  Companies: ${companies.length}`)
  console.log(`  City-Company links: ${cityCompanies.length}`)
  console.log(`  Company-Cargo links: ${companyCargo.length}`)
  if (exportAll) {
    console.log(`  Cargo: ${cargo.length}`)
    console.log(`  Trailers: ${trailers.length}`)
    console.log(`  Cargo-Trailer links: ${cargoTrailers.length}`)
  } else {
    console.log(`  (Cargo, Trailers, Cargo-Trailers skipped - use --all)`)
  }

  await db.destroy()
}

exportData().catch(err => {
  console.error('Export failed:', err)
  process.exit(1)
})
