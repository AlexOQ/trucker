# Achievement tracker — Iron Horizon Freight

User-canonical 40-item list (2026-05-20). Wiki-language requirements verbatim where applicable.

**Priority** (per R10 in `routing-rules.md`): achievements outrank Helsinki rush, rare-walk, and pay/km. Single-leg achievements are auto-take. Chain achievements need committed multi-leg attempts (uninterrupted ones forbid any side-jobs).

Status legend: ✅ done · 🔄 in progress · 🔒 blocked (skill/DLC) · ⬜ not started

---

## Heavy Cargo Pack

Mode: heavy cargo jobs at SPECIFIC cities. Available via own lowboy/lowbed trailer OR **quick jobs** (rental at any participating garage). Quick jobs count.

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **I Thought This Should Be Heavy?!** | Complete a delivery of at least 8 unique cargoes from the Heavy Cargo Pack | ⬜ 0/8 | Heavy IDs: `asph_miller`, `cable_reel`, `concr_beams`, `dozer`, `exc_craw`, `locomotive`, `metal_center`, `mobile_crane`, `transformat`. |
| **No Pain No Gain** | Deliver total of 250 tons of cargo on 5 consecutive jobs | 🔄 1/5, 80t/250t | Consecutive-5 chain. Game counts board-displayed weight (locomotive shipped at 80t, not the 61.7t cargo-only mass). Average 50t per leg suffices. |
| **Keep Calm and Haul Heavy** | Complete a perfect delivery (no damage, no fines, in-time) of 3 consecutive Heavy Cargo Pack jobs | ⬜ | Consecutive-3 perfect chain. Bundle with the No Pain No Gain attempt for efficiency. |

---

## Special Transport (oversize)

Mode: OT jobs on dedicated escort routes between specific city pairs. Available via quick jobs at participating cities OR own lowboy. Base-map routes: Berlin–Szczecin, Bratislava–Graz, Bremen–Travemünde, Brussels–Amsterdam, Cardiff–Birmingham, Cologne–Amsterdam, Dijon–Geneva, Dortmund–Hannover, Glasgow–Aberdeen, Linz–Brno, London–Felixstowe, Luxembourg–Liège, Munich–Salzburg, Plymouth–Dover, Prague–Nürnberg, Reims–Strasbourg, Sheffield–Birmingham.

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Big Brother** | Complete delivery of the Haul Truck Chassis | ⬜ | One-shot. |
| **Not a Canoe** | Complete delivery of the Service Boat | ⬜ | One-shot. |
| **Not a Big Problem** | Complete 3 consecutive oversize jobs without any damage | ⬜ | Consecutive-3 no-damage. |
| **The Bigger the Better** | Complete at least 10 unique deliveries of oversize cargoes | ⬜ 0/10 | |
| **Mass-to-don** | Deliver at least 195 tons of oversized cargo in just 3 consecutive deliveries | ⬜ | Consecutive-3, 195t total. Heat Exchanger 70t × 2 + Haul Truck Chassis 55t = 195t exact. |
| **Driver Exceptionnel** | Complete deliveries on at least 10 oversize routes in base game | ⬜ 0/10 | Distinct routes. |

---

## Scandinavia (Howie is HERE)

| Achievement | Requirement | Status | Path |
|---|---|---|---|
| **Cattle Drive** | Complete a cattle delivery to any company in Scandinavia DLC | 🔄 setup | One-shot. Sources of `live_cattle`: Norse Rail (Gävle/Östersund/Kiruna/Narvik/Rovaniemi), Freyr (Jönköping/Trelleborg/Falun/Mikkeli/Joensuu/Esbjerg/Aalborg/Lillehammer/Bodø), Aerobalt (Helsinki/Tallinn/Turku/Riga/Vilnius/Kaunas). Destination = any company in Scandinavia. |
| **Whatever Floats Your Boat** | Deliver cargo to at least 1 container port in Scandinavia DLC | ⬜ | Single delivery to any `cont_port` company. |
| **Sailor** | Deliver yachts to all Scandinavian marinas (requires Scandinavia + **High Power Cargo Pack** DLCs) | ⬜ 0/? | Cargoes: `yacht`, `lux_yacht`. Confirm HPC ownership. |
| **Volvo Trucks Lover** | Deliver truck cargo from Volvo Trucks factory | ⬜ | Göteborg pickup. Natural when garage #3 (Göteborg) is in scope. |
| **Scania Trucks Lover** | Deliver truck cargo from Scania factory | ⬜ | Södertälje pickup. |
| **Miner** | Complete delivery jobs to at least 3 quarries in Scandinavia DLC | ⬜ 0/3 | Quarry destinations. Need to enumerate which `cargo_in` lists include quarry-type input (likely byggpro, mjolnir_min, nordic_ports, etc.). |

---

## Vive la France!

| Achievement | Requirement | Status | Gate |
|---|---|---|---|
| **Check-in, Check-out** | Deliver cargo to at least 3 cargo airport terminals in France | ⬜ 0/3 | No gate. |
| **Go Nuclear** | Deliver cargo to at least 3 nuclear plants in France | 🔒 | ADR-gated (class likely 7 radioactive, possibly any ADR — verify on first attempt). |
| **Gas Must Flow** | Deliver diesel, LPG or petrol to at least 3 truck stops in France | ⬜ 0/3 | ADR Class 3 unlocked ✅. Eligible. |

---

## Italia

| Achievement | Requirement | Status |
|---|---|---|
| **Captain** | Deliver cargo to at least 1 Italian shipyard | ⬜ | Single delivery — Ancona / Messina / Olbia. |
| **Michelangelo** | Complete a delivery from Carrara quarry | ⬜ | Pickup at Carrara (near Livorno). |

---

## Beyond the Baltic Sea

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Concrete Jungle** | Complete 10 deliveries from concrete plants | ⬜ 0/10 | Cargoes: `cement`, `concr_beams`, `concr_beams2`, `concr_cent`, `concr_stair`. Concrete plants are typically `sanbuild_cem`, `cemelt_fla`, etc. |
| **Like a Farmer** | Deliver cargo to at least 4 farms in Beyond the Baltic Sea DLC | ⬜ 0/4 | Baltic-DLC farms (Estonia/Latvia/Lithuania/Finland/Russia exclave). |
| **Industry Standard** | Make 2 deliveries to **EVERY** locomotive, furniture, and paper mill factory in BBS region (= 12 factories × 2 deliveries = **24 total**) | ⬜ 0/24 | **Locomotive (`lvr`)** — 2 cities × 2 = 4: Riga (LV), Daugavpils (LV)<br/>**Furniture (`renat` BBS-only)** — 6 × 2 = 12: Tartu (EE), Helsinki (FI), Daugavpils (LV), Rēzekne (LV), Riga (LV), Šiauliai (LT). (`renat` at Brașov/Leipzig/Pleven/Resita/Salzburg/Veli Tarnovo does NOT count.)<br/>**Paper mills** — 4 × 2 = 8: Kunda (EE) `ee_paper`, Kouvola (FI) `viljo_paper`, Tampere (FI) `viljo_paper`, Vilnius (LT) `viln_paper`<br/>Tactic: QJ filter by destination company. Quick jobs count. |
| **Exclave Transit** | Complete 5 deliveries from Kaliningrad to any other Russian city | ⬜ 0/5 | Kaliningrad → other Russia. |
| **Grand Tour** | Complete excellent deliveries between these countries (any order/direction): RU↔LT, LT↔LV, LV↔EE, EE↔RU, RU↔FI | ⬜ 0/5 | Perfect-delivery gate. |

---

## Road to the Black Sea (requires Going East! also where noted)

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Along the Black Sea** | Complete excellent deliveries between coastal cities (any order/direction): Istanbul↔Burgas, Burgas↔Varna, Varna↔Mangalia, Mangalia↔Constanța | ⬜ 0/4 | Perfect-delivery gate. |
| **Orient Express** | Sequential A→B legs **in this order and direction**: Paris→Strasbourg, Strasbourg→Munich, Munich→Vienna, Vienna→Budapest, Budapest→Bucharest, Bucharest→Istanbul. Requires Going East + Black Sea | ⬜ 0/6 | Uninterrupted chain — no side jobs allowed. Howie's job #1 Bucuresti→Istanbul does NOT count. |
| **Turkish Delight** | Complete 3 deliveries from Istanbul which are at least 2,500 km long. Requires Going East + Black Sea | ⬜ 0/3 | LD r4 caps at 2500km — exactly at the achievable max. Targets: Iberia far west (A Coruña/Lisbon/Sevilla) or Norway far north (Tromsø/Alta). |

---

## Iberia

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Iberian Pilgrimage** | Complete a delivery from Lisbon, Seville, and Pamplona to A Coruña | ⬜ 0/3 | Three separate runs FROM each origin TO A Coruña. Interruptible (no "uninterrupted" language). |
| **Let's Get Shipping** | Deliver cargo to at least 4 container ports in Iberia | ⬜ 0/4 | Container ports: Lisbon, Vigo, Bilbao, Valencia, Algeciras, etc. |
| **Fleet Builder** | Deliver cargo to at least 3 shipyards in Iberia | ⬜ 0/3 | A Coruña, Gijón, Vigo, Cartagena. |
| **Taste the Sun** | Deliver ADR cargo to at least 2 solar power plants in Iberia | ⬜ 0/2 | Target company: **Engeron** (Spain). 5 locations: Badajoz, Ciudad Real, Granada, Puertollano, Sevilla. Any 2. ADR Class 3 ✅ eligible. Fallback if no ADR job spawns: own gas trailer or QJ-filter to Engeron. |

---

## West Balkans

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Through the Serpentines** | Complete a perfect delivery between Pristina and Bijelo Polje | ⬜ | Single perfect delivery, single route. |
| **Holiday Coastline** | Complete 3 deliveries along the coast in this order: Rijeka → Zadar → Split → Nikšić | ⬜ 0/3 | Sequential-3, **loose** (QJ between legs OK; counter doesn't reset). Split→Nikšić leg rarely spawns on freight market — fallback: own a trailer, QJ filter, or external dispatcher. |
| **Going Camping** | Production chain in order, **from West Balkans companies**: Ore → Aluminium Ingots → Electrical Wiring → Electronics → Campervans | ⬜ 0/5 | Strict uninterrupted. Full WB-scoped exporter map in [`going-camping-profile.md`](./going-camping-profile.md). |

---

## Greece

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **All Inclusive** | Deliver cargo to at least 4 unique hotels in Greece | ⬜ 0/4 | |
| **Gift of Athena** | Deliver olives or olive oil **from Eliarchos Olive Farm** to 5 different cities in Greece | ⬜ 0/5 | Cargoes: `olives`, `olive_oil`, `olive_oil_t`. **Specific source: Eliarchos** only. |
| **Temple Worthy** | Deliver 3 Marble Blocks and 3 undamaged Marble Slabs **from Rock Eater Quarry in Greece** | ⬜ 0/6 | Cargoes: `marb_blck`/`marb_blck2` + `marb_slab`. **Specific source: Rock Eater Quarry, Greece** (`rock_eater` company at Greek city — verify which). Greek `rock_eater` cities need lookup. |

---

## Nordic Horizons

| Achievement | Requirement | Status | Notes |
|---|---|---|---|
| **Above the Arctic Circle** | Complete excellent deliveries in this order/direction: Ivalo → Kiruna → Svolvær | ⬜ 0/3 | Sequential-3 perfect-delivery chain. |
| **Salmon Run** | Deliver 2 cargoes of Salmon Fillet from Tromsø or Alta to 2 different countries | ⬜ 0/2 | Cargo: `salm_fillet`. |

---

## Achievement-specific play notes

- **Perfect-delivery gates** (Grand Tour, Through the Serpentines, Along the Black Sea, Above the Arctic Circle, Keep Calm and Haul Heavy): plan extra caution — no damage, no fines, in-time.
- **Heavy Cargo + Special Transport**: opportunistic via quick jobs at participating cities — surface when Howie passes through one.

(General job → counter increment, chain-progress surfacing, and board-priority logic live in R10 of `routing-rules.md`.)

Last updated: 2026-05-20.
