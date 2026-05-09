/**
 * Manual trailer-pricing intake — types for `public/data/<game>/manual-prices.json`.
 *
 * Source of truth: AlexOQ/trucker#254. Static `def/vehicle/trailer_dealer/*.sii`
 * does not carry pricing for HCT/double/triple chassis combos and many singles
 * — those are assembled in-game via the customization screen. This file lets
 * a hand-walked price (keyed by trailer id) override `price=0` from the parser.
 */

export interface ManualPriceEntry {
  /** Total purchase price as shown in the dealer/configurator screen. */
  price: number;
  /**
   * Pack/DLC the trailer ships in (e.g. `cargobull_pack_dlc`, `feldbinder_eu`,
   * `scs_base`). Lets the diff advisory group re-walks per pack.
   */
  source_pack: string;
  /** Game version the price was verified in (e.g. `1.59`). */
  last_verified_game_version: string;
  /** Free-form note (e.g. specific chassis/body combo walked). Optional. */
  notes?: string;
}

export interface ManualPricesFile {
  game: 'ets2' | 'ats';
  schema_version: 1;
  prices: Record<string, ManualPriceEntry>;
  /** Free-form documentation block; ignored by the parser. */
  _doc?: string;
}
