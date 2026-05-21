# Cargo walking — depot & cargo verification tracker

Truth-set accumulator for `public/data/ets2/game-defs.json`. Every board / depot / cargo Howie encounters → cross-checked, ticked off here. Becomes the navigation tool once remote-garage-purchase unlocks. Verification scope (6-step checklist) lives in **R4** of `routing-rules.md`.

---

## Verified depots

✓ = exists in `city_companies[city]` AND cargo_out/cargo_in matches observed.

### Source depots (observed cargo on their board)

| City | Company (ID) | Country | In defs | cargo_out ✓ | First seen | Verified cargoes (out) |
|---|---|---|---|---|---|---|
| Bucuresti | Fle (`fle`) | RO | ✓ | ✓ | Job #1 | `post_packag` |
| Plovdiv | Teodora (`ttk_bg`) | BG | ✓ | partial | Job #2 | `atl_cod_flt`, `shock_absorb`, `caviar` |
| Brașov | Subse (`subse`) | RO | ✓ | _to confirm_ | Job #3 | `chicken_meat` |
| Poznań | Kaarfor (`kaarfor`) | PL | ✓ | _to confirm_ | Job #4 | `used_plast` |
| Kiel | LKW (`lkwlog`) | DE | ✓ | _to confirm_ | Job #5 | `alu_ingot`, `desinfection`, `mtl_coil`, `vent_tube` |
| Jönköping | Freyr (`freyr`) | SE | ✓ | _to confirm_ | Job #6 source | `packag_food` |
| Gävle | Norse Rail (`norse_rail`) | SE | ✓ | _to confirm_ | Job #7 source | `gnocchi`, `barley`, `gravel` |

### Destination depots (observed delivery)

| City | Company (ID) | Country | In defs | cargo_in ✓ | First seen | Verified cargoes (in) |
|---|---|---|---|---|---|---|
| Istanbul | Lognstick (`lognstick`) | TR | ✓ | _to confirm_ | Job #1 drop | `post_packag` |
| Brașov | Subse (`subse`) | RO | ✓ | _to confirm_ | Job #2 drop | `atl_cod_flt` |
| Poznań | Kaarfor (`kaarfor`) | PL | ✓ | _to confirm_ | Job #3 drop | `chicken_meat` |
| Kiel | LKW (`lkwlog`) | DE | ✓ | _to confirm_ | Job #4 drop | `used_plast` |
| Jönköping | GNT (`gnt`) | SE | ✓ | _to confirm_ | Job #5 drop | `alu_ingot` |
| Gävle | Norse Rail (`norse_rail`) | SE | ✓ | _to confirm_ | Job #6 drop | `packag_food` |
| Dombås | Renar (`renar`) | NO | ✓ | _to confirm_ | Job #7 drop (in transit) | `gnocchi` |
| Daugavpils | Lateds (`lateds`) | LV | ✓ | not yet | offered | (would be `barley`) |
| Tallinn | Baltic Metallurgy (`bltmetal`) | EE | ✓ | not yet | offered | (would be `gravel`) |
| Brussels | FCP (`fcp`) | BE | ✓ | not yet | offered | (would be `desinfection`, `vent_tube`) |
| Karlskrona | Norrsken (`norrsken`) | SE | ✓ | not yet | offered | (would be `mtl_coil`) |

---

## Verified cargoes

✓ = name, mass per unit, value, flags, body_types match game-defs.json. Units shipped (e.g. "11t", "17t") is per-job and doesn't affect cargo-def verification.

| Cargo ID | Display | Value | Mass/u | Fragility | Parser `fragile` | Real fragile? | Body type | game-defs ✓ | Observed at |
|---|---|---|---|---|---|---|---|---|---|
| `post_packag` | post_packages | 0.733 | 347.7 | 0.20 | false | false (control) | curtainside/dryvan | ✓ | Bucuresti Fle → Istanbul Lognstick |
| `atl_cod_flt` | atlantic_cod_fillet | 0.608 | 498.5 | 0.40 | false | false (control) | refrigerated/insulated | ✓ | Plovdiv Teodora → Brașov Subse |
| `chicken_meat` | chicken_meat | 0.570 | 518.0 | 0.40 | false | false (control) | refrigerated/insulated | ✓ | Brașov Subse → Poznań Kaarfor |
| `used_plast` | used_plastics | 0.330 | 293.1 | 0.10 | false | false (control) | curtainside/dryvan | ✓ | Poznań Kaarfor → Kiel LKW |
| `alu_ingot` | alu_ingots | 0.690 | 793.8 | 0.15 | false | false (control) | flatbed/flatbed_cont | ✓ | Kiel LKW → Jönköping GNT |
| `packag_food` | packaged_food | 0.589 | 526.2 | 0.80 | true | **true ✓ (Fragile r1 paid)** | curtainside/dryvan | ✓ | Jönköping(?) Freyr → Gävle Norse Rail |
| `gnocchi` | gnocchi | 0.584 | 558.8 | 0.40 | false | false | refrigerated/insulated | ✓ | Gävle Norse Rail → Dombås Renar (active) |
| `shock_absorb` | shock_absorbers | 0.739 | 499.7 | 0.69 | true | **false** (no [fragile] tag) | curtainside/dryvan | ✓ | Plovdiv Teodora board (not taken) |
| `caviar` | caviar | 0.620 | 443.3 | 0.40 | false | false | refrigerated/insulated | ✓ | Plovdiv Teodora board (not taken) |
| `mtl_coil` | metal_coil | 10.33 | 12500 | 0.60 | true | **false** (no [fragile] tag) | flatbed/flatbed_cont | ✓ | Kiel LKW board (not taken) |
| `desinfection` | desinfection | 0.598 | 509.7 | 0.30 | false | false (control) | curtainside/dryvan | ✓ | Kiel LKW board (not taken) |
| `vent_tube` | vent_tube | 3.00 | 2400 | 0.30 | false | false (control) | flatbed/flatbed_cont | ✓ | Kiel LKW board (not taken) |
| `scrap_metals` | scrap_metals | 0.750 | 2650 | 0.10 | false | false (control) | dumper | ✓ | (mentioned, not pinned) |
| `plastic_gra` | plastic | 0.650 | 1300 | 0.10 | false | false (control) | silo | ✓ | (mentioned, not pinned) |
| `canned_tuna` | canned_tuna | 0.580 | 573.3 | 0.40 | false | false (control) | refrigerated/insulated | ✓ | (mentioned, not pinned) |
| `barley` | barley | 0.400 | 600.0 | 0.20 | false | false (control) | dumper/silo | ✓ | Gävle Norse Rail board (not taken) |
| `gravel` | gravel | 0.750 | 1690 | 0.10 | false | false (control) | dumper | ✓ | Gävle Norse Rail board (not taken) |

---

## Pay-formula verification

Logged per-job in [`ledger.md`](./ledger.md). All 6 completed jobs verified: base + L<n> proficiency + LD r<n> + skill bonuses − damage penalty = stated total. No discrepancies.

---

## Open questions / discrepancies

| # | Item | Status | Resolution needed |
|---|------|--------|-------------------|
| 1 | Parser fragile flag bug | tracked in [#269](https://github.com/AlexOQ/trucker/issues/269) | Empirical truth set being built in `cargo-flags.md` |

---

## Rare-cargo priority list (post-2026-05-19 analysis)

Howie's gateable cargo space — i.e., cargoes he can currently **see on a board** (no ADR class, no HV gate). ADR-locked cargoes (acid, ammonia, chlorine, dynamite, explosives, hydrogen, hwaste, etc., 6-12 src each) are the **rarest globally** but invisible until ADR skills are taken. List below sorted by source-company count ascending — fewer sources = harder to walk, prioritize.

| Rarity (src count) | Cargo | Body type | Where to source | Notes |
|---|---|---|---|---|
| 13 | `marb_blck`, `marb_blck2`, `marb_slab` | flatbed | quarry/stone specialists | Dombås Byggpro ✓, Brașov Rock Eater ✓, Istanbul Rock Eater ✓ |
| 14 | `sugar_b` | silo | sugar/mill specialists | Norse Rail (Gävle), Granoro, Suikersmij |
| 17 | `refl_posts` | curtainside/dryvan | construction logistics | Byggpro, Eolo Lines, Nordic Ports |
| 18 | `live_cattle`, `live_pigs` **[fragile=1, REAL fragile]** | livestock | agri specialists | Fle (Bucuresti, walkable!), Freyr, Aerobalt |
| 20 | `coal` | dumper | mining/aggregate | Norse Rail, Rock Eater, Kivisydan |
| 23 | `granite_cube` | dumper | quarry | Byggpro, Cantera, Marmo, Quarry |
| 27 | `wooden_beams` | curtainside/dryvan/flatbed/log | timber/sawmill | Bjork (Linköping), Tree Et (Poznan), Timberturtle |
| 29 | `barley` ✓, `rye`, `wheat`, `wood_bark`, `ore`, `stones` | dumper/silo | agri/quarry | barley already walked at Gävle Norse Rail; rest unwalked |
| 30 | `stone_dust` | dumper/silo | quarry/aggregate | Byggpro, Renor (Dombås) |
| 33 | `gravel` ✓, `sand` | dumper | quarry | gravel walked at Norse Rail offered (not taken); sand still unwalked |
| 34 | `wshavings` | dumper/silo | timber/sawmill | Byggpro, Renor, Bjork |

**Important narrowness pattern**: cargoes with 13-30 source companies cluster at the SAME ~10 hub companies (Balkan Loco, NCH, Norse Rail, RT Log, DFH, etc.) PLUS regional specialists. The hub companies' geographic positions matter — see next section.

### Hub companies (high rare-cargo density per visit)

| Hub | Cities (the rare-walking treasure map) | Region |
|---|---|---|
| **NCH** | Tallinn, Turku, Riga, Vilnius, Kouvola | Baltic + Finland — **adjacent to Helsinki**, prioritize once garage exists |
| **Norse Rail** | Gävle ✓ (walked) | Single-city; sugar_b + coal still in cargo_out |
| **Nordic Ports** | Bodø, Mo i Rana, Örnsköldsvik, Sundsvall, Tornio, Trondheim | Norway/Sweden coast — Tornio is Finland border, Sundsvall is on the way north |
| **Balkan Loco** | Craiova, Edirne, Ljubljana, Maribor, Pleven, Ruse, Sarajevo, Skopje, Veliko Tarnovo | Balkans expedition |
| **Dunavia** | Beograd, Novi Sad, Osijek | Serbia/Croatia |
| **DFH** | Berlin, Bremen, Dresden, Duisburg, Hamburg, Nürnberg, Rostock | Germany |
| **RT Log** | A Coruña, Barcelona, Bern, Córdoba, Geneva, Graz, Hamburg, Innsbruck, Köln, Linz, Madrid, Nürnberg, Rostock, Salzburg, Sevilla, Travemünde, Zaragoza, Zürich | Iberia + central Europe |

**Strategic implication**: once Helsinki garage exists, **Tallinn ferry → NCH Tallinn** unlocks the biggest single rare-cargo walk in the game. NCH appears in ~25 rare-cargo source lists.

---

## Update rules

- Run the R4 checklist on every board / delivery; tick the **Verified depots** + **Verified cargoes** tables here.
- Mismatches → new row in **Open questions**, never silent overwrite.
- Pay-formula confirmation → `ledger.md`. Skill-bonus firing → `cargo-flags.md`.
