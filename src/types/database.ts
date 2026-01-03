import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

export interface Database {
  cities: CityTable
  depots: DepotTable
  cargo_types: CargoTypeTable
  trailer_types: TrailerTypeTable
  depot_cargoes: DepotCargoTable
  cargo_trailers: CargoTrailerTable
}

export interface CityTable {
  id: Generated<number>
  name: string
  country: string
}

export interface DepotTable {
  id: Generated<number>
  city_id: number
  company_name: string
}

export interface CargoTypeTable {
  id: Generated<number>
  name: string
  value: number
}

export interface TrailerTypeTable {
  id: Generated<number>
  name: string
}

export interface DepotCargoTable {
  depot_id: number
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

export type Depot = Selectable<DepotTable>
export type NewDepot = Insertable<DepotTable>

export type CargoType = Selectable<CargoTypeTable>
export type NewCargoType = Insertable<CargoTypeTable>

export type TrailerType = Selectable<TrailerTypeTable>
export type NewTrailerType = Insertable<TrailerTypeTable>

export type DepotCargo = Selectable<DepotCargoTable>
export type CargoTrailer = Selectable<CargoTrailerTable>
