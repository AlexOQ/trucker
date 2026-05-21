# Going Camping chain — West Balkans-scoped profile

Every cargo pickup must be from a company located in a **West Balkans DLC city** (wiki constraint).

**WB DLC cities (30)**: banja_luka, beograd, bihac, bijelo_polje, bitola, durres, fier, karakaj, koper, kragujevac, ljubljana, maribor, mostar, niksic, nis, novi_sad, novo_mesto, osijek, podgorica, pristina, rijeka, sarajevo, skopje, split, tirana, tuzla, vlore, zadar, zagreb, zenica.

## Verdict

Achievable. Each stage has 15-24 WB pickup cities. Major WB cities (Beograd, Ljubljana, Maribor, Skopje, Sarajevo) support 3+ stages. Strategy: keep the chain entirely within WB by delivering stage N to a WB city that also exports stage N+1 — avoids deadheads.

## Stage-by-stage WB exporters

### Stage 1: ORE pickup (15 WB cities)

| City | Companies |
|---|---|
| beograd | dunavia, rock_eat_str |
| bitola | rock_eater |
| kragujevac | rock_eater |
| ljubljana | balkan_loco |
| maribor | balkan_loco |
| niksic | aluxion_str |
| novi_sad | dunavia |
| osijek | dunavia |
| podgorica | rock_eat_str |
| pristina | sanbuild_cem |
| sarajevo | balkan_loco |
| skopje | balkan_loco, rock_eat_str |
| split | sanbuild_cem |
| tirana | sanbuild_cem |
| tuzla | sanbuild_cem |

### Stage 2: ALU_INGOT pickup (23 WB cities)

23 of 30 WB cities export. Most flexibility here. Hub-density leaders: maribor (4 cos), ljubljana (3), skopje (3), novi_sad (3), pristina (2-3), maribor/sarajevo (2-3).

### Stage 3: ELECT_WIRING pickup (24 WB cities)

24 of 30 WB cities export. Includes the new exporter `eumefa` at multiple cities (electronics specialist).

### Stage 4: ELECTRONICS pickup (19 WB cities)

Slightly narrower but still wide. Hub leaders: maribor, ljubljana, skopje, sarajevo, beograd.

### Stage 5: CARAVANS pickup (21 WB cities)

Note new caravan-specialist companies: `piac`, `slava`, `larus`. Caravans are vehicle cargoes — exports concentrate at vehicle-haulage logistics companies. Howie MUST pickup caravans (user-confirmed 2026-05-19).

## Single-city all-stage hubs

**WB cities supporting ALL FIVE stage exports** (Howie could in principle rotate through one super-hub if destinations allowed):

Looking at the data, the cities with ALL 5 chain cargoes in their exporter set:
- **Ljubljana** — ore (balkan_loco), alu_ingot (balkan_loco/brawen/itcc), elect_wiring (balkan_loco/brawen/itcc), electronics (balkan_loco/brawen), caravans (balkan_loco/brawen)
- **Maribor** — ore (balkan_loco), alu_ingot (balkan_loco/itcc/stokes), elect_wiring (balkan_loco/eumefa/itcc/stokes), electronics (balkan_loco/eumefa/stokes), caravans (balkan_loco/stokes)
- **Skopje** — ore (balkan_loco/rock_eat_str), alu_ingot (balkan_loco/brawen/itcc), elect_wiring (balkan_loco/brawen/itcc), electronics (balkan_loco/brawen/fle), caravans (balkan_loco/brawen)
- **Sarajevo** — ore (balkan_loco), alu_ingot (balkan_loco), elect_wiring (balkan_loco/eumefa), electronics (balkan_loco/eumefa), caravans (balkan_loco)
- **Novi Sad** — ore (dunavia), alu_ingot (betunia/brawen/dunavia), elect_wiring (betunia/brawen/dunavia), electronics (brawen/dunavia), caravans (brawen/dunavia)
- **Beograd** — ore (dunavia/rock_eat_str), alu_ingot (dunavia/syllurgy), elect_wiring (dunavia/eumefa/syllurgy), electronics (dunavia/eumefa), caravans (dunavia/piac)
- **Osijek** — ore (dunavia), alu_ingot (dunavia), elect_wiring (dunavia), electronics (dunavia), caravans (dunavia/slava)

7 cities can theoretically supply every stage. **Balkan Loco at Ljubljana/Maribor/Skopje/Sarajevo** is the cleanest super-hub option — single company across all 5 stages within those cities. **Dunavia at Beograd/Novi Sad/Osijek** is the second option.

## Strategic recommendation

The chain can be **completely contained within West Balkans** with smart routing:

1. **Setup**: drive Howie to a WB city (say Beograd or Ljubljana — both have garages available and central location).
2. **Per stage**: pick up the chain cargo from a WB company. Deliver to ANY destination — preferably back inside WB to keep next stage's pickup local. If the destination is outside WB, **deadhead back** to a WB city before picking up next stage.
3. **Backup hubs** within deadhead range of each other:
   - Slovenia cluster: Ljubljana ↔ Maribor (~125km apart)
   - Serbia cluster: Beograd ↔ Novi Sad (~75km apart)
   - Balkans-South cluster: Skopje ↔ Pristina ↔ Sarajevo

4. **Time commitment**: 3-5h dedicated session — WB is geographically small (~600km across).

## When to attempt

Per R10: as soon as a WB stage 1 cargo (ore) appears on Howie's board, surface it as "STAGE 1 AVAILABLE — commit?" The user can decide whether to commit to the dedicated WB session.

**Realistic attempt windows**:
- After Helsinki garage exists AND has at least one AI driver covering expenses
- Howie deadheads down to a WB city (e.g., Ljubljana or Beograd) and starts the chain on the spot
- Total expedition: ~24-48 game hours including travel TO + chain + travel BACK

## Constraints

- **No intervening deliveries** — chain resets on any wrong-cargo delivery.
- **Sources must be in WB** — every pickup from a WB DLC city.
- **Destinations** — wiki silent; assume anywhere (verify on first stage-1 attempt).
- **electronics is real-fragile** (fragility=0.8) → Fragile r1 ✓ already unlocked.
