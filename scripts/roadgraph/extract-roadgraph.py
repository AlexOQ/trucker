#!/usr/bin/env python3
"""#320 build, slice 1: a city-pair road-distance graph from ETS2 map sectors,
with separate city/normal road scales.

Answers "can route_km come out of base_map.scs, to retire the save-derived
citykm.json?".  It reads the `.base` sector files that `scripts/scs-extract`
pulls out of a map archive (ROOTPATH `map/<name>`) and reconstructs the drivable
road graph, WITHOUT a full map-item parser, then runs Dijkstra between cities.

Why no full item parser: the `.base` item array has no per-item length prefix, so
skipping an item requires knowing every one of ~40 item types' byte layout. We
avoid that entirely by reading only the node array (fixed-size records) plus two
targeted byte scans, because the node array already encodes the road topology.

.base layout (map format v907 — see README.md and TruckLib):
    header             u32 core_ver(907) | token game_id | u32 game_map_ver(3)  16 B
    items              u32 item_count, then item_count variable-size items
    nodes              u32 node_count,  then node_count * 56 B node records
    vis-area children  u32 count, then count * u64
  Node (56 B): u64 uid | i32 x,y,z (/256 -> metres) | f32 quat[4] |
               u64 backward_item(@36) | u64 forward_item(@44) | u32 flags(@52)
  Item head:   u64 uid | f32 kdop_min[5] kdop_max[5] (40 B) | u32 flags(@uid+48)
  Road item tail: ... | u64 node0 | u64 node1 | f32 length(metres)

Method:
  1. Locate each sector's node array by the tail equation
         O + 4 + node_count*56 + 4 + vis_count*8 == filesize
     validated by unit-norm quaternions, and decode node positions + the two
     item UIDs each node touches.
  2. Phase-scan the item bytes for runs of consecutive known-node UIDs (every
     node-ref list — prefab Nodes[], company spawn groups, a road's node pair —
     is such a run, all at one offset-phase mod 8). Clique each run:
       - a 2-run whose trailing f32 is a plausible road length  -> road edge (m)
       - any other run                                          -> junction/prefab,
         cliqued at straight-line cost (prefab interiors are short)
  3. Tag each road edge city/normal via its IsCityRoad flag (slice 1): a road's
     own item UID is the one item BOTH its endpoint nodes reference, so it is
     locatable in the item bytes; the flag is bit 23 of the u32 at uid+48 (byte
     uid+50 bit 0x80). The full item parser (productionize bullet) would read it
     directly. Verified against a CityArea-box ground truth at 94.5% agreement.
  4. Anchor cities from CityArea items (token name | f32 w | f32 h | u64 node),
     snap each to the nearest graph node, and shortest-path between them.

Distances come out in MAP metres. ETS2 compresses the world, but by two factors:
NormalScale (~19) for open road, CityScale (~3) for city streets. Both are read
from the map's `.mbd` (floats at offsets 60 and 64). The game distance of a route
is normal_m*NormalScale + city_m*CityScale, decomposed along the chosen (map-metre
shortest) path. A single scale cannot model this: short, city-heavy pairs read
too high — the largest residual term the spike (#345) left open.

Usage:
    extract-roadgraph.py SRC [SRC ...] --pairs a:b,c:d [--mbd PATH]
    extract-roadgraph.py SRC [SRC ...] --citykm PATH --validate [--mbd PATH]
  SRC is DIR (labelled by its basename) or LABEL=DIR; the label is the DLC
  provenance (#326).  --only L1,L2 restricts the graph to those sources.
  --mbd auto-locates `<first SRC>.mbd`; when it is unreadable the two scales are
  fitted from the oracle (least squares) if --citykm is given, else defaulted.
"""
import sys, os, struct, glob, json, heapq, math, time, argparse
from collections import defaultdict

NODE = 56
TBL = "\0" "0123456789" "abcdefghijklmnopqrstuvwxyz" "_"


def tok(s):
    """Encode a unit name as its SCS base-38 token (little-endian digit weights)."""
    v = 0
    for i, c in enumerate(s):
        v += TBL.index(c) * (38 ** i)
    return v


def tokenizable(s):
    return 0 < len(s) <= 12 and all(c in TBL for c in s)


DEFAULT_SCALES = (19.0, 3.0)  # ETS2 documented NormalScale / CityScale


def find_mbd(sources):
    """Guess the map's `.mbd` path from the first source dir (`<dir>.mbd`)."""
    for _label, d in sources:
        cand = os.path.normpath(d) + '.mbd'
        if os.path.isfile(cand):
            return cand
    return None


def read_mbd(path):
    """(normal_scale, city_scale) from a map `.mbd`, or None if unreadable.

    Header is the same 16 B as a `.base` (core_ver 907 | token game_id | u32).
    The two scales are the floats at offsets 60 (NormalScale) and 64 (CityScale);
    verified against ETS2 1.61 europe.mbd (19.0 / 3.0, the documented defaults).
    """
    try:
        b = open(path, 'rb').read()
        if len(b) < 68 or struct.unpack_from('<I', b, 0)[0] != 907:
            return None
        normal = struct.unpack_from('<f', b, 60)[0]
        city = struct.unpack_from('<f', b, 64)[0]
        if not (1.0 < normal < 100.0 and 0.5 < city <= normal):
            return None
        return normal, city
    except (OSError, struct.error):
        return None


def _valid_node(b, o):
    if o + NODE > len(b):
        return False
    qw, qx, qy, qz = struct.unpack_from('<ffff', b, o + 20)
    if not (0.98 < qw * qw + qx * qx + qy * qy + qz * qz < 1.02):
        return False
    x, y, z = struct.unpack_from('<iii', b, o + 8)
    return abs(x) < 0x3000000 and abs(y) < 0x3000000 and abs(z) < 0x3000000  # < ~196 km


def find_node_array(b):
    """(offset, count, vis_count) of the node section, or None for an empty sector."""
    n = len(b)
    if n < 28:
        return None
    for O in range(16, n - 4):
        N = struct.unpack_from('<I', b, O)[0]
        if N == 0 or N > (n - O) // NODE:
            continue
        p = O + 4 + N * NODE
        if p + 4 > n:
            continue
        V = struct.unpack_from('<I', b, p)[0]
        if p + 4 + V * 8 != n:
            continue
        probe = {j for j in (0, 1, N // 2, N - 1, N - 2) if 0 <= j < N}
        if all(_valid_node(b, O + 4 + i * NODE) for i in probe):
            return O, N, V
    return None


class Graph:
    def __init__(self):
        self.pos = {}                    # uid -> (x, y, z) metres
        self.node_items = {}             # node uid -> (backward_item, forward_item)
        self.adj = defaultdict(dict)     # uid -> {uid: weight_metres}
        self.edge_src = {}               # frozenset({u,v}) -> source label
        self.edge_city = {}              # frozenset({u,v}) -> 1 city road / 0 normal
        self.regions = []                # (bytes, item_start, item_end, source)
        self.sectors = self.empty = 0
        self.road_edges = self.city_edges = 0
        self.real_sum = self.chord_sum = 0.0
        self.city_len = self.normal_len = 0.0

    def _d3(self, u, v):
        return math.dist(self.pos[u], self.pos[v])

    def _link(self, u, v, w, src, city=0):
        if v not in self.adj[u] or w < self.adj[u][v]:
            self.adj[u][v] = w
            self.adj[v][u] = w
            self.edge_src[frozenset((u, v))] = src
            self.edge_city[frozenset((u, v))] = city

    def load_nodes(self, files, source):
        for f in files:
            b = open(f, 'rb').read()
            r = find_node_array(b)
            if r is None:
                self.empty += 1
                continue
            self.sectors += 1
            O, N, _ = r
            for i in range(N):
                o = O + 4 + i * NODE
                uid = struct.unpack_from('<Q', b, o)[0]
                x, y, z = struct.unpack_from('<iii', b, o + 8)
                self.pos.setdefault(uid, (x / 256.0, y / 256.0, z / 256.0))
                self.node_items.setdefault(uid, (struct.unpack_from('<Q', b, o + 36)[0],
                                                 struct.unpack_from('<Q', b, o + 44)[0]))
            self.regions.append((b, 20, O, source))

    def _road_item_flags(self):
        """{(region_idx, road_uid): flags_u32} by locating each road's own item.

        A road's item UID is the single item BOTH its endpoint nodes reference
        (two distinct nodes share exactly the road between them). The item starts
        with that UID, so scanning the item bytes for it finds the record; the
        common flags word sits at uid+48 (after the 40-byte kdop).
        """
        wanted = defaultdict(set)        # region_idx -> set(road_uid)
        for ridx, uids in self._road_uids.items():
            wanted[ridx].update(u for u in uids if u)
        flags = {}
        for ridx, uidset in wanted.items():
            b = self.regions[ridx][0]
            s, e = 20, self.regions[ridx][2]
            for phase in range(8):
                base = s + phase
                k = (e - base) // 8
                if k < 1:
                    continue
                arr = struct.unpack_from('<%dQ' % k, b, base)
                for i, v in enumerate(arr):
                    if v in uidset and (ridx, v) not in flags:
                        o = base + i * 8 + 48
                        if o + 4 <= len(b):
                            flags[(ridx, v)] = struct.unpack_from('<I', b, o)[0]
        return flags

    def build_edges(self):
        nodeset = set(self.pos)
        # Pass 1: collect road 2-runs (deferred so we can tag them), build every
        # connector/prefab edge immediately (always normal road).
        roads = []                       # (region_idx, n0, n1, length)
        self._road_uids = defaultdict(list)
        for ridx, (b, s, e, src) in enumerate(self.regions):
            for phase in range(8):
                base = s + phase
                k = (e - base) // 8
                if k < 2:
                    continue
                arr = struct.unpack_from('<%dQ' % k, b, base)
                i = 0
                while i < k:
                    if arr[i] not in nodeset:
                        i += 1
                        continue
                    j = i
                    while j < k and arr[j] in nodeset:
                        j += 1
                    run = arr[i:j]
                    if len(run) == 2:
                        off = base + j * 8          # bytes right after the two UIDs
                        L = struct.unpack_from('<f', b, off)[0] if off + 4 <= e else -1.0
                        ch = self._d3(run[0], run[1])
                        if ch * 0.98 <= L < 100000.0:   # a stored road length
                            roads.append((ridx, run[0], run[1], L))
                            self._road_uids[ridx].append(self._common_item(run[0], run[1]))
                        else:                            # a 2-node connector/prefab
                            self._link(run[0], run[1], ch, src)
                    elif len(run) > 2:                   # junction / prefab: clique
                        r = run if len(run) <= 16 else run[:16]
                        for a in range(len(r)):
                            for c in range(a + 1, len(r)):
                                self._link(r[a], r[c], self._d3(r[a], r[c]), src)
                    i = j
        # Pass 2: resolve each road's IsCityRoad flag, then create the road edges.
        flags = self._road_item_flags()
        for (ridx, n0, n1, L) in roads:
            uid = self._common_item(n0, n1)
            fl = flags.get((ridx, uid))
            city = 1 if (fl is not None and (fl >> 23) & 1) else 0
            self._link(n0, n1, L, self.regions[ridx][3], city)
            self.road_edges += 1
            self.real_sum += L
            self.chord_sum += self._d3(n0, n1)
            if city:
                self.city_edges += 1
                self.city_len += L
            else:
                self.normal_len += L

    def _common_item(self, n0, n1):
        """The item UID both endpoint nodes reference (the road), or None."""
        c = (set(self.node_items.get(n0, ())) & set(self.node_items.get(n1, ()))) - {0}
        return next(iter(c)) if len(c) == 1 else None

    def restrict(self, allowed):
        """Drop edges whose source is not in `allowed` (the #326 DLC-subset graph)."""
        if allowed is None:
            return
        for key, src in list(self.edge_src.items()):
            if src not in allowed:
                u, v = tuple(key)
                self.adj[u].pop(v, None)
                self.adj[v].pop(u, None)
                del self.edge_src[key]
                self.edge_city.pop(key, None)

    def components(self):
        seen = set()
        comps = []
        for start in self.adj:
            if start in seen:
                continue
            stack = [start]
            seen.add(start)
            cc = []
            while stack:
                u = stack.pop()
                cc.append(u)
                for v in self.adj[u]:
                    if v not in seen:
                        seen.add(v)
                        stack.append(v)
            comps.append(cc)
        comps.sort(key=len, reverse=True)
        return comps

    def city_anchors(self, tokmap):
        """city_id -> [anchor node uid] from CityArea items (phase-scanned)."""
        nodeset = set(self.pos)
        hits = defaultdict(list)
        for (b, s, e, _src) in self.regions:
            for phase in range(8):
                base = s + phase
                k = (e - base) // 8
                for i in range(k):
                    cid = tokmap.get(struct.unpack_from('<Q', b, base + i * 8)[0])
                    if cid is None:
                        continue
                    o = base + i * 8
                    if o + 24 > e:
                        continue
                    w, h = struct.unpack_from('<ff', b, o + 8)
                    node = struct.unpack_from('<Q', b, o + 16)[0]
                    if node in nodeset and 0.0 < w < 20000.0 and 0.0 < h < 20000.0:
                        hits[cid].append(node)
        return hits

    def dijkstra(self, src, dst):
        dist = {src: 0.0}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                return d
            if d > dist.get(u, 1e30):
                continue
            for v, w in self.adj[u].items():
                nd = d + w
                if nd < dist.get(v, 1e30):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        return None

    def route(self, src, dst):
        """Map-metre shortest path, decomposed into (city_m, normal_m, total_m).

        The truck drives the physical shortest path; the game distance is then
        this path's city/normal metres times the two scales. Returns None if
        unreachable.
        """
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, 1e30):
                continue
            for v, w in self.adj[u].items():
                nd = d + w
                if nd < dist.get(v, 1e30):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if dst not in dist:
            return None
        city_m = normal_m = 0.0
        cur = dst
        while cur != src:
            p = prev[cur]
            w = self.adj[p][cur]
            if self.edge_city.get(frozenset((p, cur)), 0):
                city_m += w
            else:
                normal_m += w
            cur = p
        return city_m, normal_m, dist[dst]


def snapper(graph, giant_set):
    pts = [(graph.pos[u][0], graph.pos[u][2], u) for u in giant_set]

    def snap(nodes):
        ps = [graph.pos[u] for u in nodes if u in graph.pos]
        if not ps:
            return None
        cx = sum(p[0] for p in ps) / len(ps)
        cz = sum(p[2] for p in ps) / len(ps)
        best, bd = None, 1e30
        for (x, z, u) in pts:
            dd = (x - cx) ** 2 + (z - cz) ** 2
            if dd < bd:
                bd, best = dd, u
        return best, math.sqrt(bd)
    return snap


def parse_sources(specs):
    out = []
    for spec in specs:
        if '=' in spec:
            label, d = spec.split('=', 1)
        else:
            label, d = os.path.basename(os.path.normpath(spec)) or 'base', spec
        out.append((label, d))
    return out


def fit_single(rows):
    """Median oracle-km-per-map-metre scale (the spike's single-scale fit)."""
    ratios = sorted(km * 1000.0 / (c + n) for (_, _, c, n, km) in rows if c + n > 0)
    return ratios[len(ratios) // 2]


def fit_dual(rows):
    """Least-squares (city_scale, normal_scale) for oracle_m = c*city + n*normal."""
    scc = scn = snn = scy = sny = 0.0
    for (_, _, c, n, km) in rows:
        y = km * 1000.0
        scc += c * c; scn += c * n; snn += n * n; scy += c * y; sny += n * y
    det = scc * snn - scn * scn
    if det == 0:
        return DEFAULT_SCALES[1], DEFAULT_SCALES[0]
    city = (scy * snn - sny * scn) / det
    normal = (scc * sny - scn * scy) / det
    return city, normal


def residual_bands(rows, convert):
    """Print per-oracle-band residuals of a convert(city_m, normal_m)->game_m."""
    for lo in (0, 400, 800, 1200):
        sub = [(c, n, km) for (_, _, c, n, km) in rows if km >= lo]
        if len(sub) < 20:
            continue
        res = sorted(100.0 * (convert(c, n) / (km * 1000.0) - 1.0) for (c, n, km) in sub)
        w1 = 100.0 * sum(1 for r in res if abs(r) <= 1.0) / len(res)
        print("    oracle>=%4dkm n=%4d  resid p10/p90 %+5.1f/%+5.1f%%  med %+4.1f%%  |r|<=1%%:%2.0f%%"
              % (lo, len(sub), res[len(res) // 10], res[9 * len(res) // 10],
                 res[len(res) // 2], w1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sources', nargs='+', help='DIR or LABEL=DIR of extracted .base sectors')
    ap.add_argument('--pairs', help='comma list of a:b city-id pairs to route')
    ap.add_argument('--citykm', help='oracle JSON ("a|b": km) for scale fit + validation')
    ap.add_argument('--validate', action='store_true', help='full residual report vs the oracle')
    ap.add_argument('--only', help='comma list of source labels to keep (DLC subset, #326)')
    ap.add_argument('--mbd', help='map .mbd for the two scales (default: auto <first SRC>.mbd)')
    ap.add_argument('--scale', type=float, default=19.0, help='single map->game scale when no --citykm')
    ap.add_argument('--snap-max', type=float, default=1500.0, help='max city snap distance, metres')
    args = ap.parse_args()

    t0 = time.time()
    sources = parse_sources(args.sources)
    g = Graph()
    for label, d in sources:
        files = sorted(glob.glob(os.path.join(d, '**', '*.base'), recursive=True))
        if not files:
            sys.exit('no .base files under %s' % d)
        g.load_nodes(files, label)
    g.build_edges()
    g.restrict(set(args.only.split(',')) if args.only else None)
    comps = g.components()
    giant = set(comps[0]) if comps else set()
    print("nodes=%d  graph_nodes=%d  road_edges=%d (city %d)  sectors=%d (+%d empty)  %.1fs"
          % (len(g.pos), len(g.adj), g.road_edges, g.city_edges, g.sectors, g.empty,
             time.time() - t0))
    print("components=%d  giant=%d  top=%s"
          % (len(comps), len(giant), [len(c) for c in comps[:5]]))
    if g.chord_sum:
        print("road length vs straight-line chord: +%.2f%% (real %.0f km / chord %.0f km)"
              % (100 * (g.real_sum / g.chord_sum - 1), g.real_sum / 1000, g.chord_sum / 1000))
    if g.city_len + g.normal_len:
        print("city road length fraction: %.1f%% (IsCityRoad flag)"
              % (100 * g.city_len / (g.city_len + g.normal_len)))

    # Two scales: from the .mbd when readable, else fitted from the oracle, else default.
    mbd_path = args.mbd or find_mbd(sources)
    scales = read_mbd(mbd_path) if mbd_path else None
    if scales:
        normal_scale, city_scale = scales
        scale_src = "mbd %s" % mbd_path
    else:
        normal_scale, city_scale = None, None   # resolved below once we have rows
        scale_src = "unreadable mbd" if mbd_path else "no mbd"

    citykm = json.load(open(args.citykm)) if args.citykm else None
    city_ids = set()
    if citykm:
        for key in citykm:
            a, b = key.split('|')
            city_ids.add(a)
            city_ids.add(b)
    if args.pairs:
        for p in args.pairs.split(','):
            a, b = p.split(':')
            city_ids.add(a)
            city_ids.add(b)
    tokmap = {tok(c): c for c in city_ids if tokenizable(c)}
    hits = g.city_anchors(tokmap)
    snap = snapper(g, giant)
    anchored = {cid: snap(ns) for cid, ns in hits.items() if snap(ns)}
    on_net = {c: v for c, v in anchored.items() if v[1] < args.snap_max and v[0] in giant}
    print("cities anchored=%d  on giant network (<%.0fm)=%d"
          % (len(anchored), args.snap_max, len(on_net)))

    single = args.scale
    fit_city = fit_normal = None
    if citykm:
        rows = []   # (a, b, city_m, normal_m, oracle_km)
        for key, km in citykm.items():
            a, b = key.split('|')
            if a in on_net and b in on_net:
                r = g.route(on_net[a][0], on_net[b][0])
                if r and r[2] > 0:
                    rows.append((a, b, r[0], r[1], km))
        if rows:
            single = fit_single(rows)
            fit_city, fit_normal = fit_dual(rows)
            if normal_scale is None:          # mbd unreadable -> derive by fit
                normal_scale, city_scale = fit_normal, fit_city
                scale_src = "fitted from oracle (lsq)"
            print("\noracle pairs on network=%d" % len(rows))
            print("scales: normal=%.2f city=%.2f  [%s]" % (normal_scale, city_scale, scale_src))
            print("        single-scale median=%.2f   oracle-fitted dual city=%.2f normal=%.2f"
                  % (single, fit_city, fit_normal))
            if args.validate:
                print("\n  SINGLE scale %.2f:" % single)
                residual_bands(rows, lambda c, n: (c + n) * single)
                print("  DUAL normal=%.2f city=%.2f [%s]:" % (normal_scale, city_scale, scale_src))
                residual_bands(rows, lambda c, n: n * normal_scale + c * city_scale)
                print("  DUAL oracle-fitted normal=%.2f city=%.2f (diagnostic):"
                      % (fit_normal, fit_city))
                residual_bands(rows, lambda c, n: n * fit_normal + c * fit_city)
    if normal_scale is None:                  # no oracle and no mbd
        normal_scale, city_scale = DEFAULT_SCALES
        scale_src = "default %.0f/%.0f" % DEFAULT_SCALES
        print("scales: normal=%.2f city=%.2f  [%s]" % (normal_scale, city_scale, scale_src))

    if args.pairs:
        # map_km, city share, and single- vs dual-scale game km (+residual vs oracle)
        print("\n%-24s %7s %7s %5s  %8s %8s" %
              ("pair", "oracle", "map_km", "city%", "single", "dual"))
        for p in args.pairs.split(','):
            a, b = p.split(':')
            if a not in anchored or b not in anchored:
                print("%-24s  unanchored (not a base_map city?)" % p)
                continue
            r = g.route(anchored[a][0], anchored[b][0])
            if r is None:
                print("%-24s  disconnected" % p)
                continue
            city_m, normal_m, total_m = r
            single_km = total_m / 1000.0 * single
            dual_km = (normal_m * normal_scale + city_m * city_scale) / 1000.0
            cityp = 100 * city_m / total_m if total_m else 0.0
            km = citykm.get('%s|%s' % (a, b), citykm.get('%s|%s' % (b, a))) if citykm else None
            if km:
                print("%-24s %7d %7.1f %4.0f%%  %4.0f %+5.1f%% %4.0f %+5.1f%%"
                      % (p, km, total_m / 1000, cityp,
                         single_km, 100 * (single_km / km - 1),
                         dual_km, 100 * (dual_km / km - 1)))
            else:
                print("%-24s %7s %7.1f %4.0f%%  %13.0f %8.0f"
                      % (p, "-", total_m / 1000, cityp, single_km, dual_km))


if __name__ == '__main__':
    main()
