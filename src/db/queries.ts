import { db } from './connection.js'

export async function getAllCities() {
  return db.selectFrom('cities').selectAll().orderBy('name').execute()
}

export async function getCityById(id: number) {
  return db.selectFrom('cities').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function getDepotTypesForCity(cityId: number) {
  return db
    .selectFrom('city_depots')
    .innerJoin('depot_types', 'depot_types.id', 'city_depots.depot_type_id')
    .select(['depot_types.id', 'depot_types.name', 'city_depots.count'])
    .where('city_depots.city_id', '=', cityId)
    .execute()
}

export async function getCargoesForDepotType(depotTypeId: number) {
  return db
    .selectFrom('depot_type_cargoes')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_type_cargoes.cargo_type_id')
    .select(['cargo_types.id', 'cargo_types.name', 'cargo_types.value'])
    .where('depot_type_cargoes.depot_type_id', '=', depotTypeId)
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

export async function getOwnableTrailerTypes() {
  return db.selectFrom('trailer_types').selectAll().where('ownable', '=', true).orderBy('name').execute()
}

export async function getAllCargoTypes() {
  return db.selectFrom('cargo_types').selectAll().orderBy('name').execute()
}

export async function getAllDepotTypes() {
  return db.selectFrom('depot_types').selectAll().orderBy('name').execute()
}

// Get full cargo pool for a city (with depot count multiplicity)
export async function getCityCargoPool(cityId: number) {
  return db
    .selectFrom('city_depots')
    .innerJoin('depot_types', 'depot_types.id', 'city_depots.depot_type_id')
    .innerJoin('depot_type_cargoes', 'depot_type_cargoes.depot_type_id', 'depot_types.id')
    .innerJoin('cargo_types', 'cargo_types.id', 'depot_type_cargoes.cargo_type_id')
    .select([
      'depot_types.id as depot_type_id',
      'depot_types.name as depot_name',
      'city_depots.count as depot_count',
      'cargo_types.id as cargo_id',
      'cargo_types.name as cargo_name',
      'cargo_types.value',
    ])
    .where('city_depots.city_id', '=', cityId)
    .where('cargo_types.excluded', '=', false)
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

// Get cities with depot counts for ranking
export async function getCitiesWithDepotCounts() {
  return db
    .selectFrom('cities')
    .leftJoin('city_depots', 'city_depots.city_id', 'cities.id')
    .select([
      'cities.id',
      'cities.name',
      'cities.country',
      db.fn.sum<number>('city_depots.count').as('depot_count'),
    ])
    .groupBy(['cities.id', 'cities.name', 'cities.country'])
    .orderBy('cities.name')
    .execute()
}
