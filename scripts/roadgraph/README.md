# roadgraph — spike (#320)

Can city-pair road distances come out of `base_map.scs`, to retire the
save-derived `playthrough/tools/citykm.json`? **Yes.** This spike extracts the
drivable road graph from ETS2 map sectors and shortest-paths between cities. It
is a feasibility probe, not the production pipeline — see "What this does not do".

Context: issues #320 (retire `citykm.json`) and #326 (per-DLC `route_km`). The
`citykm.json` oracle is 47,108 observed haul medians over 372 of ~400 cities
(`playthrough/research-register.md` Q59/Q60). It is the system's only non-def
input; everything else is derived from game files.

## Pipeline

`scripts/scs-extract` (Go) already opens the HashFS v2 archive. It extracts the
`map/<name>` sector tree; this script turns those `.base` files into a graph.

```sh
# 1. extract the europe sector tree (game data -> a scratch dir, never the repo)
cd scripts/scs-extract
ETS2="$HOME/Library/Application Support/Steam/steamapps/common/Euro Truck Simulator 2"
go run . -x -o /tmp/ets2map "$ETS2/base_map.scs" map/europe

# 2a. route named city pairs (map km and game km at the 1:19 scale)
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map \
    --pairs geneve:paris,prague:rotterdam,berlin:milano

# 2b. fit the scale and validate against the oracle
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map \
    --citykm playthrough/tools/citykm.json --validate
```

No game data is committed. `citykm.json` lives under the git-ignored
`playthrough/`; validation needs a local ETS2 install and that file.

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
             | u64 backward_item_uid | u64 forward_item_uid | u32 flags
Road tail:   ... | u64 node0 | u64 node1 | f32 length (metres)   # length is STORED
```

Node positions are world metres; a sector spans 4096 m and `sector_coord*4096 ≈
node position`. A node names the (≤2) items it touches; a road's two endpoint
nodes each name it, so **road topology is recoverable from the node array alone**.

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
3. **City anchors** from CityArea items (`token name | f32 w | f32 h | u64 node`),
   each snapped to the nearest graph node; Dijkstra between anchors.

Per-sector provenance (#326): each source is `LABEL=DIR`; every edge is tagged
with its source archive, and `--only L1,L2` rebuilds the graph for a DLC subset.
The spike runs base game only (`base_map.scs`); overlaying `dlc_north` etc. is
the same call with more sources.

## Findings (base_map.scs, 1.61, europe)

- 247,124 nodes, 75,546 road edges from 277 sectors (5 are 28-byte empty
  corners). Runtime ~7 s; no archive data committed.
- One giant road component (68,176 nodes) spans the whole base-game footprint;
  65 cities anchor onto it. 1,960 oracle pairs lie on it.
- **Stored road lengths sum +1.37% over straight-line chord** — the curvature
  that a geometry graph captures and an observation/chord estimate misses. This
  is the right sign for #320's "`citykm` reads ~1% low".
- **Fitted map scale 18.5×**, converging to **19.2× on long hauls** (ETS2's
  documented 1:19). Median scaled error vs the oracle is 0% by construction;
  per-pair residual tightens with distance:

  | oracle band | n | scale | resid p10/p90 |
  |---|--:|--:|--:|
  | ≥0 km | 1960 | 18.50 | −8.7% / +15.6% |
  | ≥400 km | 1527 | 18.70 | −7.6% / +9.7% |
  | ≥800 km | 781 | 18.95 | −6.7% / +6.1% |
  | ≥1200 km | 150 | 19.21 | −5.2% / +5.1% |

  Short, city-heavy pairs read lowest (`mannheim:strasbourg` −24%): a single
  scale cannot model ETS2's **dual NormalScale/CityScale** (inner-city roads are
  compressed more). The `.mbd` carries both constants and the road `IsCityRoad`
  flag marks city segments — both available to a real build.

**The spike does not reach the ~1% target** (±5% at best, ±16% overall). It
proves the data is there and the graph is faithful in map space; closing the gap
is the full build below.

## What this does not do (cost of the full build)

- **Dual scale.** Read `NormalScale`/`CityScale` from `europe.mbd` and tag each
  road with `IsCityRoad` (bit already in the road kdop flags), scaling city vs
  highway metres separately. This is the largest residual term.
- **Depot-accurate terminals.** Anchor on company depot nodes (the Q59 Company
  scan already yields `city → node`), not CityArea label centroids. ~44 of 107
  base cities currently snap poorly or land off the giant component.
- **Game-faithful routing.** `citykm` is the *median observed* route; strict
  shortest-path diverges where GPS avoids roads or prefers ferries. Ferry links
  (Ferry items) are not yet edges, so islands/Scandinavia/UK are separate
  components — needed once DLC maps are overlaid.
- **Productionize.** Port the sector reader into the parse pipeline (Go, beside
  `scs-extract`, or TS in `parse-game-defs.ts`) so `route_km` regenerates with
  `game-defs.json` on every reparse, per-DLC (#326), replacing `citykm.json`.
