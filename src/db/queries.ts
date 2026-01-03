import { db } from './connection.js'

export async function getAllCities() {
  return db.selectFrom('cities').selectAll().orderBy('name').execute()
}

export async function getCityById(id: number) {
  return db.selectFrom('cities').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function getDepotsForCity(cityId: number) {
  return db.selectFrom('depots').selectAll().where('city_id', '=', cityId).execute()
}

export async function getCargoesForDepot(depotId: number) {
  return db
    .selectFrom('depot_cargoes')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_cargoes.cargo_type_id')
    .select(['cargo_types.id', 'cargo_types.name', 'cargo_types.value'])
    .where('depot_cargoes.depot_id', '=', depotId)
    .execute()
}

export async function getTrailersForCargo(cargoId: number) {
  return db
    .selectFrom('cargo_trailers')
    .innerJoin('trailer_types', 'trailer_types.id', 'cargo_trailers.trailer_type_id')
    .select(['trailer_types.id', 'trailer_types.name'])
    .where('cargo_trailers.cargo_type_id', '=', cargoId)
    .execute()
}

export async function getAllTrailerTypes() {
  return db.selectFrom('trailer_types').selectAll().orderBy('name').execute()
}

export async function getAllCargoTypes() {
  return db.selectFrom('cargo_types').selectAll().orderBy('name').execute()
}

// Get full cargo pool for a city (with depot multiplicity)
export async function getCityCargoPool(cityId: number) {
  return db
    .selectFrom('depots')
    .innerJoin('depot_cargoes', 'depot_cargoes.depot_id', 'depots.id')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_cargoes.cargo_type_id')
    .select([
      'depots.id as depot_id',
      'depots.company_name',
      'cargo_types.id as cargo_id',
      'cargo_types.name as cargo_name',
      'cargo_types.value',
    ])
    .where('depots.city_id', '=', cityId)
    .execute()
}

// Get all cargo-trailer mappings
export async function getAllCargoTrailerMappings() {
  return db
    .selectFrom('cargo_trailers')
    .innerJoin('trailer_types', 'trailer_types.id', 'cargo_trailers.trailer_type_id')
    .select([
      'cargo_trailers.cargo_type_id',
      'cargo_trailers.trailer_type_id',
      'trailer_types.name as trailer_name',
    ])
    .execute()
}
