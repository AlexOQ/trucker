import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

export interface Database {
  cities: CityTable
  depot_types: DepotTypeTable
  city_depots: CityDepotTable
  cargo_types: CargoTypeTable
  trailer_types: TrailerTypeTable
  depot_type_cargoes: DepotTypeCargoTable
  cargo_trailers: CargoTrailerTable
}

export interface CityTable {
  id: Generated<number>
  name: string
  country: string
}

export interface DepotTypeTable {
  id: Generated<number>
  name: string
}

export interface CityDepotTable {
  city_id: number
  depot_type_id: number
  count: number
}

export interface CargoTypeTable {
  id: Generated<number>
  name: string
  value: number
}

export interface TrailerTypeTable {
  id: Generated<number>
  name: string
  ownable: boolean
}

export interface DepotTypeCargoTable {
  depot_type_id: number
  cargo_type_id: number
}

export interface CargoTrailerTable {
  cargo_type_id: number
  trailer_type_id: number
}

// Helper types for queries
export type City = Selectable<CityTable>
export type NewCity = Insertable<CityTable>
export type CityUpdate = Updateable<CityTable>

export type DepotType = Selectable<DepotTypeTable>
export type NewDepotType = Insertable<DepotTypeTable>

export type CityDepot = Selectable<CityDepotTable>
export type CargoType = Selectable<CargoTypeTable>
export type NewCargoType = Insertable<CargoTypeTable>

export type TrailerType = Selectable<TrailerTypeTable>
export type NewTrailerType = Insertable<TrailerTypeTable>

export type DepotTypeCargo = Selectable<DepotTypeCargoTable>
export type CargoTrailer = Selectable<CargoTrailerTable>
