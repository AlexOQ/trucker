# roadgraph (#320)

Can city-pair road distances come out of `base_map.scs`, to retire the
save-derived `playthrough/tools/citykm.json`? **Yes.** This extracts the drivable
road graph from ETS2 map sectors and shortest-paths between cities. Still a
feasibility probe, not the production pipeline — see "What this does not do".

**Slice 1 (dual scale)** is landed: ETS2 compresses city streets (`CityScale`)
harder than open road (`NormalScale`), so a single scale over-reads short,
city-heavy routes. Each road edge now carries its `IsCityRoad` flag and the two
scales come from the map's `.mbd`. This removes the distance-dependent bias the
spike (#345) left open — see "Findings".

Context: issues #320 (retire `citykm.json`) and #326 (per-DLC `route_km`). The
`citykm.json` oracle is 47,108 observed haul medians over 372 of ~400 cities
(`playthrough/research-register.md` Q59/Q60). It is the system's only non-def
input; everything else is derived from game files.

## Pipeline

`scripts/scs-extract` (Go) already opens the HashFS v2 archive. It extracts the
`map/<name>` sector tree; this script turns those `.base` files into a graph.

```sh
# 1. extract the europe sector tree + the .mbd (game data -> a scratch dir)
cd scripts/scs-extract
ETS2="$HOME/Library/Application Support/Steam/steamapps/common/Euro Truck Simulator 2"
go run . -x -o /tmp/ets2map "$ETS2/base_map.scs" map   # `map` (not map/europe) for the .mbd

# 2a. route named city pairs (map km, city share, single vs dual game km)
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map/map/europe \
    --pairs geneve:paris,prague:rotterdam,berlin:milano

# 2b. validate against the oracle (single scale vs dual scale, per distance band)
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map/map/europe \
    --citykm playthrough/tools/citykm.json --validate
```

The two scales auto-load from `<first SRC>.mbd` (here `/tmp/ets2map/map/europe.mbd`);
`--mbd PATH` overrides. When the `.mbd` is unreadable they are fitted from the
oracle (if `--citykm` is given) or defaulted to the documented 19/3; the run
prints which. No game data is committed. `citykm.json` lives under the
git-ignored `playthrough/`; validation needs a local ETS2 install and that file.

## `.base` sector format (map format version 907)

Canonical layout reference is `sk-zk/TruckLib` (C#); `mwl4/ConverterPIX`
(`ppd_0x19.h`) and the SCS Blender Tools corroborate it. Verified against the
local 1.61 install.

```
header            u32 core_map_version(907) | token game_id | u32 game_map_version(3)   = 16 B
items             u32 item_count,  then item_count variable-size, type-tagged items
nodes             u32 node_count,  then node_count * 56 B node records
vis-area children u32 count,       then count * u64
```

`token`: SCS base-38, charset `"\0"+"0..9"+"a..z"+"_"`, value `Σ index·38^i`,
≤12 chars (`token("euro2") == 0x750461`, the `game_id`).

```
Node (56 B): u64 uid | i32 x,y,z (/256 -> metres) | f32 quat[4]
             | u64 backward_item_uid(@36) | u64 forward_item_uid(@44) | u32 flags(@52)
Item head:   u64 uid | f32 kdop_min[5] kdop_max[5] (40 B) | u32 flags(@uid+48) | ...
Road tail:   ... | u64 node0 | u64 node1 | f32 length (metres)   # length is STORED
```

Node positions are world metres; a sector spans 4096 m and `sector_coord*4096 ≈
node position`. A node names the (≤2) items it touches; a road's two endpoint
nodes each name it, so **road topology is recoverable from the node array alone**.
The same back-reference recovers a road's own item UID — it is the one item
*both* its endpoint nodes name — which locates the item head, hence its flags
(the `IsCityRoad` bit is bit 23 of the u32 at `uid+48`, i.e. byte `uid+50 & 0x80`).

## Method (no full item parser)

The item array has no per-item length prefix, so skipping an item needs every
one of ~40 item types' byte layout. This spike sidesteps that:

1. **Node array**, located by the tail equation
   `offset + 4 + node_count·56 + 4 + vis_count·8 == filesize`, validated by
   unit-norm quaternions (one constraint alone yields spurious matches). Decodes
   every node's position.
2. **Phase scan** of the item bytes for runs of consecutive known-node UIDs.
   Every node-ref list (prefab `Nodes[]`, company spawn groups, a road's node
   pair) is such a run, and all its UIDs sit at one offset-phase mod 8, so each
   phase unpacks as one C-level `struct` array. A random u64 being a known node
   is ~1e-14, so a run is never a false positive.
   - 2-run whose trailing f32 ≥ chord → **road edge**, weight = stored length.
   - any other run → **junction/prefab**, cliqued at straight-line cost (prefab
     interiors are short relative to inter-city routes).
   Node slots alone do **not** connect the graph: a prefab's `Nodes[]` references
   nodes that need not record the prefab back, so slot-only incidence fragments
   into 23k components. The run scan recovers those links.
3. **City-road tag** (slice 1): a 2-run gives the road's node UIDs but not its
   item flags, which sit far from the node pair behind a variable-length
   road-look/terrain block. Instead, the road's own item UID is the single item
   both endpoint nodes back-reference; scanning the item bytes for that UID finds
   the item head, and `IsCityRoad` is bit 23 of the flags word at `uid+48`. All
   75,546 road edges resolve a unique item UID. Validated against a CityArea-box
   ground truth (road midpoint inside any city's `w/2 × h/2` box): **94.5%**
   agreement — the gap is where the flag is the finer signal (a highway crossing
   a city box is not flagged; a city street just outside one is).
4. **City anchors** from CityArea items (`token name | f32 w | f32 h | u64 node`),
   each snapped to the nearest graph node; Dijkstra between anchors on map metres,
   then the chosen path's city/normal metres are scaled separately.

Per-sector provenance (#326): each source is `LABEL=DIR`; every edge is tagged
with its source archive, and `--only L1,L2` rebuilds the graph for a DLC subset.
The spike runs base game only (`base_map.scs`); overlaying `dlc_north` etc. is
the same call with more sources.

## Findings (base_map.scs, 1.61, europe)

- 247,124 nodes, 75,546 road edges (**22,314 flagged `IsCityRoad`, 23.7% by
  length**) from 277 sectors (5 empty). Build ~10 s, `--validate` ~70 s
  (1,960 path-reconstructing Dijkstras); no archive data committed.
- One giant road component (68,176 nodes) spans the whole base-game footprint;
  65 cities anchor onto it. 1,960 oracle pairs lie on it.
- **Stored road lengths sum +1.37% over straight-line chord** — the curvature a
  geometry graph captures and a chord estimate misses; the right sign for #320's
  "`citykm` reads ~1% low".
- `europe.mbd` yields **NormalScale 19.0, CityScale 3.0** (floats at offsets
  60/64) — ETS2's documented defaults, read directly.

### Single vs dual scale

The game distance of a route is `normal_m·NormalScale + city_m·CityScale`, with
the city/normal split taken along the (map-metre shortest) path. The tables below
fix *one* global scale per model so the single-scale distance bias is visible —
the spike refit a scale per band, which hid it.

**Single scale (18.50):** a distance-dependent bias. Band medians drift as hauls
lengthen and the short end carries a fat +15.6% tail.

| oracle band | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| ≥0 km | 1960 | −8.7% / +15.6% | +0.0% | 12% |
| ≥400 km | 1527 | −8.6% / +8.6% | −1.1% | 14% |
| ≥800 km | 781 | −8.9% / +3.6% | −2.4% | 15% |
| ≥1200 km | 150 | −8.7% / +1.2% | −3.7% | 15% |

**Dual scale, mbd 19.0 / 3.0:** the short-pair over-read collapses (p90 +15.6% →
+7.0%), at the cost of a uniform −2.5% offset.

| oracle band | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| ≥0 km | 1960 | −10.7% / +7.0% | −2.5% | 12% |
| ≥400 km | 1527 | −10.0% / +4.4% | −2.8% | 12% |
| ≥800 km | 781 | −9.6% / +2.2% | −3.5% | 12% |
| ≥1200 km | 150 | −8.2% / +1.6% | −3.5% | 9% |

**Dual scale, oracle-fitted 19.63 / 1.61:** the bias is gone — band medians flat
across all distances, tightest tails, best ±1% share.

| oracle band | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| ≥0 km | 1960 | −8.2% / +9.8% | +0.2% | 15% |
| ≥400 km | 1527 | −7.5% / +7.4% | −0.1% | 16% |
| ≥800 km | 781 | −7.0% / +5.1% | −0.7% | 19% |
| ≥1200 km | 150 | −5.6% / +4.8% | −0.6% | 21% |

The fit confirms the model: its **normal scale (19.63) is the authored 19**. The
authored **CityScale 3 is directionally right but the observed oracle wants city
≈ 1.6** — hauls compress city driving even harder than the editor value — so 19/3
verbatim collapses the short-pair tail yet leaves a −2.5% offset that the fitted
city scale removes.

### 10 sample pairs (short → long; `single` 18.50 vs `dual` 19/3)

| pair | oracle | map_km | city% | single | dual |
|---|--:|--:|--:|--:|--:|
| dortmund:duisburg | 31 | 6.3 | 74% | 116 (+274%) | 45 (+45%) |
| mannheim:strasbourg | 258 | 10.6 | 4% | 195 (−24%) | 193 (−25%) |
| linz:prague | 276 | 17.4 | 6% | 322 (+17%) | 315 (+14%) |
| kassel:prague | 447 | 23.5 | 4% | 435 (−3%) | 433 (−3%) |
| bratislava:innsbruck | 600 | 32.0 | 12% | 592 (−1%) | 548 (−9%) |
| kiel:strasbourg | 797 | 45.5 | 7% | 842 (+6%) | 813 (+2%) |
| dresden:trieste | 962 | 52.2 | 6% | 965 (0%) | 945 (−2%) |
| lille:wien | 1164 | 60.3 | 3% | 1116 (−4%) | 1119 (−4%) |
| geneve:rostock | 1312 | 68.9 | 4% | 1275 (−3%) | 1269 (−3%) |
| calais:rijeka | 1524 | 77.7 | 2% | 1438 (−6%) | 1451 (−5%) |

The win is on city-heavy routes: `dortmund:duisburg` (74% city) +274% → +45%.
Long hauls (2–7% city) barely move. `mannheim:strasbourg` stays −24%: at 4% city
this is not a scale problem — its map path is too short (anchoring/routing, below),
and the spike mis-attributed it. The clean short-pair case is `dortmund:duisburg`.

**Slice 1 clears its bar**: the all-pairs residual band narrows (−8.7%/+15.6% →
−8.2%/+9.8% fitted) and the distance-dependent bias is removed. The residual that
remains (±~8%) is anchoring and routing, not scale — the open bullets below.

## What this does not do (cost of the full build)

- ~~**Dual scale.**~~ Done (slice 1): `NormalScale`/`CityScale` from the `.mbd`,
  per-edge `IsCityRoad`. Largest residual term, closed.
- **Depot-accurate terminals.** Anchor on company depot nodes (the Q59 Company
  scan already yields `city → node`), not CityArea label centroids. ~44 of 107
  base cities currently snap poorly or land off the giant component. This now
  dominates the residual (e.g. `mannheim:strasbourg` −24%, only 4% city).
- **Game-faithful routing.** `citykm` is the *median observed* route; strict
  shortest-path diverges where GPS avoids roads or prefers ferries. Ferry links
  (Ferry items) are not yet edges, so islands/Scandinavia/UK are separate
  components — needed once DLC maps are overlaid.
- **Productionize.** Port the sector reader into the parse pipeline (Go, beside
  `scs-extract`, or TS in `parse-game-defs.ts`) so `route_km` regenerates with
  `game-defs.json` on every reparse, per-DLC (#326), replacing `citykm.json`. A
  full item parser there would read `IsCityRoad` from the item head directly,
  retiring the shared-UID lookup this spike uses.
