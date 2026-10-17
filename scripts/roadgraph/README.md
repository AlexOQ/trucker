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

**Slice 2 (depot-accurate terminals)** is landed: cities now anchor on their
company depot nodes (the Q59 Company scan), not the CityArea label centroid. Over
466 base-game depots the typical (per-city-pair **median** over depot pairs)
anchor narrows the all-pairs residual band from **−10.7/+7.0% to −8.1/+5.5%** and
grows the on-giant city count **65 → 67**, and pulls the oracle-fitted city scale
back from 1.6 toward the authored 3.0 — slice 1's low city scale was partly an
anchoring artifact. The remaining large residuals (e.g. `mannheim:strasbourg`)
are now shown to be *routing*, not anchoring — see "Depot anchoring (slice 2)".

**Slice 3 (ferry edges)** is landed (`--ferry-def`): the base-game giant stopped
at the water, so the UK sat in its own component and every oracle pair the game
routes across a ferry went unrouted. Parsing `def/ferry/connection/*.sii` for the
authored crossing km and the Ferry map items for each port's terminal node adds
the base crossings as edges of their own kind. The UK's 18 cities join the giant
(**67 → 85 cities**, giant 68,176 → 72,888 nodes) and routed oracle pairs grow
**2,079 → 3,221**. The crossing is billed at the authored length: counting it as 0
under-reads ferry pairs by a median −14% (p10 −46%); the authored length fits
(median +3.4%, oracle-fit factor 1.06). The all-pairs band *widens* (−8.1/+5.5 →
−9.2/+19.0) because the newly-reachable UK pairs carry the sparse UK road graph's
**path-fidelity** inflation (UK-internal pairs median +29%), not a ferry defect —
the mainland 2,079 are unchanged. See "Ferries (slice 3)".

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
go run . -x -o /tmp/ets2def "$ETS2/def.scs" def/ferry   # ferry connections live in def.scs

# 2a. route named city pairs (centroid vs depot-min vs depot-median game km)
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map/map/europe \
    --ferry-def /tmp/ets2def/def/ferry --pairs london:paris,geneve:paris,berlin:milano

# 2b. validate against the oracle (per-anchor, per-distance-band residuals, the
#     ferry-crossing accounting, and the default 10-pair sample).
python3 scripts/roadgraph/extract-roadgraph.py base=/tmp/ets2map/map/europe \
    --ferry-def /tmp/ets2def/def/ferry --citykm playthrough/tools/citykm.json --validate
```

`--ferry-def` points at an extracted `def/ferry` tree (the connection distances
are in `def.scs`, not `base_map.scs`); omit it for the slices 1-2 graph with no
ferry edges. The two scales auto-load from `<first SRC>.mbd` (here `/tmp/ets2map/map/europe.mbd`);
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
4. **City anchors.** The default (slice 2) is the city's **company depot nodes**,
   scanned from Company items (`… token city | u64 prefab | token company |
   u64 node | u32 count | u64 spawn[count] …`) — the real freight terminals, where
   a CityArea label is only a caption. Each depot node is snapped to the nearest
   graph node; a city pair's distance is the **median over its depot pairs** (min
   validates worse — see below). CityArea-centroid anchors (`token name | f32 w |
   f32 h | u64 node`, slice 1) are still computed for the side-by-side comparison
   `--validate` prints. Dijkstra runs on map metres, then the chosen path's
   city/normal metres are scaled separately; the depot×depot matrix is one
   decomposition-tracking Dijkstra per anchor node, not a path-reconstruction per
   pair.
5. **Ferry edges** (slice 3, `--ferry-def`). `def/ferry/connection/*.sii` gives
   each connection's two ports and authored crossing km (symmetric; the two
   directional files collapse onto one key). A **Ferry map item** places one port:
   after the item head its payload is `token port | u64 approach | u64 node |
   f32 unload[3]`. The terminal `node` is a scalar (like a Company depot's), so it
   is not in any node-run and enters the graph isolated. It is found by scanning
   the item bytes for each port token with the node 16 B past it known, three
   filters peeling off the city/CityArea/road items whose token aliases (the
   approach uid 8 B past is *not* a graph node; those bytes as two floats are not
   a CityArea's width/height; the unload offset reads small). Each terminal snaps
   to the nearest road node in a non-trivial component (≥100 nodes, skipping the
   sub-20-node ramp stubs), and a connection whose two terminals land in different
   components becomes an edge that **bridges** them — joining the UK to the giant.
   The edge's Dijkstra weight is `km·1000 / NormalScale` (a road-equivalent length,
   so a ferry weighs against roads rather than teleporting mainland pairs), billed
   as the authored km (scale-free, a third decomposition term beside city/normal).

Per-sector provenance (#326): each source is `LABEL=DIR`; every edge is tagged
with its source archive, and `--only L1,L2` rebuilds the graph for a DLC subset.
The spike runs base game only (`base_map.scs`); overlaying `dlc_north` etc. is
the same call with more sources.

## Findings (base_map.scs, 1.61, europe)

- 247,124 nodes, 75,546 road edges (**22,314 flagged `IsCityRoad`, 23.7% by
  length**) from 277 sectors (5 empty). Build ~10 s; `--validate` ~105 s (a
  326-node depot×depot matrix at 24 s, plus the 1,960 centroid Dijkstras it keeps
  for the comparison); no archive data committed.
- One giant road component (68,176 nodes) spans the whole base-game *mainland*;
  the UK and islands are separate until ferries bridge them (slice 3: 72,888
  nodes). **67 cities anchor onto it by depot (2,079 oracle pairs), 65 by centroid
  (1,960)** without ferries, **85 / 3,221** with — see "Depot anchoring (slice 2)"
  and "Ferries (slice 3)".
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
remains (±~8%) is anchoring and routing, not scale — slice 2 (below) splits those.

### Depot anchoring (slice 2)

Each city now anchors on its **company depot nodes** — the `node` field of every
Company item in the city (466 depots over the 107 base-game cities the oracle
covers, ~4.4 per city), the real freight terminals drivers haul between. A city
pair's distance is taken over the city×city depot pairs two ways, **min** (the
closest facilities) and **median** (the typical haul); the median is kept.

All three anchors under the authored dual scale (19/3), all-pairs (oracle ≥0 km):

| anchor | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| centroid (slice 1) | 1960 | −10.7% / +7.0% | −2.5% | 12% |
| depot, **min** | 2079 | −17.6% / −0.6% | −6.6% | 6% |
| depot, **median** | 2079 | **−8.1% / +5.5%** | **−1.7%** | **15%** |

`min` reads systematically short (it always takes the nearest pair of
facilities); `median` matches the oracle, which is itself a median observed haul.
Depot-median per band:

| oracle band | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| ≥0 km | 2079 | −8.1% / +5.5% | −1.7% | 15% |
| ≥400 km | 1634 | −7.9% / +3.5% | −2.1% | 16% |
| ≥800 km | 851 | −7.9% / +1.8% | −2.8% | 16% |
| ≥1200 km | 183 | −7.9% / −0.3% | −2.9% | 15% |

Oracle-fitting the two scales to the depot-median rows gives **normal 19.46, city
2.73** (band −6.0/+7.8%, median +0.5%). The city scale rebounds from slice 1's
centroid-fitted 1.6 **toward the authored 3.0**: slice 1's suspiciously-low city
scale was partly an anchoring artifact — label centroids sit deeper in the city
grid than depots do, inflating the city-metre share that the fit then had to
discount. Depot anchors carry less spurious city metre, so the authored 3 nearly
fits as-is.

**All 466 depot control nodes land off the giant component** (snap median **9 m**),
and the cause is uniform: a Company item names its control node only as a scalar
`node` field, never inside a node-*run*, and the graph's run-scan (README "Method")
only makes edges from runs of ≥2 consecutive node UIDs. So every depot node enters
the graph isolated and is bridged by the snap to the nearest road node — a 9 m
median gap, four orders below the ~1% residual budget on a multi-hundred-km haul.
**No fix ships**: wiring the control node in would cost a Company-item parser for
sub-0.01% of distance. (The company *spawn* UIDs, by contrast, do form a run and
are already cliqued; they are not needed as anchors.)

Depot-median vs the slice-1 centroid, same 10 sample pairs (dual 19/3):

| pair | oracle | centroid | depot-med | depots |
|---|--:|--:|--:|--:|
| dortmund:duisburg | 31 | 45 (+45%) | 54 (+74%) | 6×6 |
| mannheim:strasbourg | 258 | 193 (−25%) | 172 (−33%) | 5×5 |
| linz:prague | 276 | 315 (+14%) | 303 (+10%) | 5×5 |
| kassel:prague | 447 | 433 (−3%) | 463 (+4%) | 5×5 |
| bratislava:innsbruck | 600 | 548 (−9%) | 538 (−10%) | 4×4 |
| kiel:strasbourg | 797 | 813 (+2%) | 799 (0%) | 5×5 |
| dresden:trieste | 962 | 945 (−2%) | 955 (−1%) | 5×1 |
| lille:wien | 1164 | 1119 (−4%) | 1167 (0%) | 3×6 |
| geneve:rostock | 1312 | 1269 (−3%) | 1252 (−5%) | 5×6 |
| calais:rijeka | 1524 | 1451 (−5%) | 1492 (−2%) | 3×4 |

Most long pairs tighten (`kiel:strasbourg` +2%→0, `lille:wien` −4%→0,
`calais:rijeka` −5%→−2%). The one that does **not** is `mannheim:strasbourg`: the
depot anchor makes it *worse* (−25% → −33%). Slice 1 guessed "anchoring/routing";
slice 2 settles it — better anchoring moved it the wrong way, so its deficit is
**routing**, not anchoring. Its 10.6 map-km shortest path is genuinely shorter
than the ~13.5 the 258 km oracle implies at scale 19; the graph is taking a
crossing the game's GPS does not. That is the routing bullet below, out of slice 2.

**Slice 2 clears its bar**: the all-pairs band narrows (centroid −10.7/+7.0% →
depot-median −8.1/+5.5%) and the on-giant city count grows (65 → 67), while
confirming the stubborn short-read pairs are a routing problem, not an anchor one.

### Ferries (slice 3)

`--ferry-def /tmp/ets2def/def/ferry` finds **11 connections over 19 ports, 15
terminals in base_map, 7 edges added** (4 DLC-only ports — roscoff, trelleborg,
ancona, bari — have no base terminal, so their connections drop):

| edge | km | | edge | km |
|---|--:|---|---|--:|
| calais ↔ dover | 49 | | ijmuiden ↔ tyne | 508 |
| europoort ↔ harwich | 207 | | priwall ↔ travemunde_p | 1 |
| europoort ↔ hull | 370 | | tunnel_c ↔ tunnel_d | 60 |
| gedser ↔ rostock | 65 | | | |

The five UK↔mainland crossings (and the Channel Tunnel) **merge the UK component
into the giant**: 68,176 → 72,888 nodes, **67 → 85 on-giant cities** (+18 UK), and
routed oracle pairs **2,079 → 3,221**. `priwall↔travemunde_p` is a real 1 km local
crossing; `gedser↔rostock` is inert (gedser is a Scandinavia-DLC port whose stub
terminal sits beside Rostock, so its edge is a longer-than-driving detour between
two adjacent mainland nodes — never on a shortest path).

**How the oracle counts a crossing.** Measured on the 1,057 depot-median pairs the
shortest path routes over a ferry:

| crossing billed as | ≥0 km p10/p90 | med | ≥800 km p10/p90 | med |
|---|--:|--:|--:|--:|
| none (factor 0) | −46.0 / +12.6% | **−13.8%** | −47.8 / +8.2% | −19.5% |
| **authored km (factor 1, shipped)** | −12.7 / +23.1% | **+3.4%** | −13.6 / +15.4% | +1.5% |

Counting the crossing as 0 under-reads ferry pairs by a median −14% (−20% on the
long hauls): the oracle **does** include the crossing. The authored length fits
(median +3.4%; least-squares factor **1.059**, i.e. the authored km verbatim), so
the ferry edge is billed on its def distance, not the road scales. The wide p90
(+23%) is **not** the crossing: it is the UK road graph's path fidelity leaking in
(a long-ferry pair like `felixstowe:rotterdam` reads +181% because its UK leg
detours, not because 207 km is wrong) — out of scope, below.

**All-pairs, depot-median, shipped (dual 19/3 + authored ferry km):**

| oracle band | n | resid p10/p90 | median | \|r\|≤1% |
|---|--:|--:|--:|--:|
| ≥0 km | 3221 | −9.2% / +19.0% | −0.7% | 11% |
| ≥400 km | 2667 | −9.4% / +14.6% | −1.1% | 12% |
| ≥800 km | 1661 | −10.1% / +11.4% | −1.7% | 12% |
| ≥1200 km | 700 | −11.1% / +10.6% | −1.7% | 10% |

5 ferry-pair samples (oracle vs routed, shipped):

| pair | oracle | routed | | ferry |
|---|--:|--:|--:|--:|
| calais:london | 124 | 225 | +81% | 49 |
| dover:lille | 127 | 171 | +35% | 49 |
| felixstowe:rotterdam | 134 | 376 | +181% | 207 |
| calais:cambridge | 200 | 315 | +57% | 49 |
| gedser:travemunde | 214 | 267 | +25% | 66 |

**Slice 3 does not clear the band half of its bar.** Routed pairs grow 2,079 →
3,221 (+55%) and the crossing accounting validates, but the all-pairs p90 widens
+5.5% → +19.0%. The cause is isolated: the mainland 2,079 are unchanged
(−8.2/+5.5), while the new **UK-internal** pairs sit at a +29% median and the
cross pairs inherit it — the sparse UK base-game road graph routes long, the same
path-fidelity gap as `mannheim:strasbourg`, now dominant because the UK is reached
for the first time. The oracle scale-fit confirms it: including the UK pairs drives
the fitted city scale from the clean-mainland 2.73 to a nonsensical 12.88, as the
fit tries to absorb UK routing error into a scale. Closing it needs the full item
parser (one-way/road-class/lane links) — the "Path fidelity" bullet, not ferries.
`mannheim:strasbourg` (mainland, no crossing) is unchanged at −33%: ferries don't
touch it, so #347's routing verdict stands.

## What this does not do (cost of the full build)

- ~~**Dual scale.**~~ Done (slice 1): `NormalScale`/`CityScale` from the `.mbd`,
  per-edge `IsCityRoad`. Largest residual term, closed.
- ~~**Depot-accurate terminals.**~~ Done (slice 2): anchor on the Company items'
  depot nodes (median over depot pairs), not CityArea centroids. All-pairs band
  −10.7/+7.0% → −8.1/+5.5%, on-giant cities 65 → 67, fitted city scale 1.6 → 2.73.
  See "Depot anchoring (slice 2)".
- ~~**Ferries.**~~ Done (slice 3, `--ferry-def`): Ferry map items give each port's
  terminal node, `def/ferry/connection/*.sii` the pairs and authored crossing km;
  the base crossings are edges billed on the authored length, merging the UK into
  the giant (67 → 85 cities, 2,079 → 3,221 oracle pairs). See "Ferries (slice 3)".
- **Game-faithful path fidelity** (now the dominant residual). `citykm` is the
  *median observed* route; strict shortest-path diverges where the game's GPS
  takes a longer road (one-way/road-class preferences, avoided links). On the
  mainland this is the ~−8% p10 and `mannheim:strasbourg` −33%; with ferries it is
  acute on the newly-reached UK, whose sparse base-game road graph routes +29%
  long and drags the all-pairs p90 to +19%. Quantifying the gap against a
  GPS-faithful cost needs the full item parser (below) for lane/road attributes;
  out of scope until productionizing.
- **Productionize.** Port the sector reader into the parse pipeline (Go, beside
  `scs-extract`, or TS in `parse-game-defs.ts`) so `route_km` regenerates with
  `game-defs.json` on every reparse, per-DLC (#326), replacing `citykm.json`. A
  full item parser there would read `IsCityRoad` from the item head directly,
  retiring the shared-UID lookup this spike uses.
