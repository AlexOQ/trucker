#!/usr/bin/env python3
"""#320 build, slices 1-2: a city-pair road-distance graph from ETS2 map sectors,
with separate city/normal road scales and depot-node city anchors.

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
  4. Anchor cities on their company depot nodes (slice 2) -- the node field of
     each Company item, the real freight terminals -- snap each to the nearest
     graph node, and take a city pair's distance as the median over its depot
     pairs (min validates worse). CityArea-centroid anchors (token name | f32 w |
     f32 h | u64 node, slice 1) are kept for the side-by-side `--validate` prints.

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


def detok(v):
    """Decode an SCS base-38 token back to its unit name, or None if `v` is not a
    valid token: a zero base-38 digit is the '\\0' char (never inside a real name)
    and names are at most 12 chars. Used to vet a Company item's company token."""
    if v <= 0:
        return None
    s = []
    while v:
        v, d = divmod(v, 38)
        if d == 0 or len(s) >= 12:
            return None
        s.append(TBL[d])
    return ''.join(s)


DEFAULT_SCALES = (19.0, 3.0)  # ETS2 documented NormalScale / CityScale

# The slice-1 sample pairs (short -> long), reused so slice 2 is comparable;
# mannheim:strasbourg is the anchoring probe the README tracks.
DEFAULT_SAMPLE = [
    ('dortmund', 'duisburg'), ('mannheim', 'strasbourg'), ('linz', 'prague'),
    ('kassel', 'prague'), ('bratislava', 'innsbruck'), ('kiel', 'strasbourg'),
    ('dresden', 'trieste'), ('lille', 'wien'), ('geneve', 'rostock'),
    ('calais', 'rijeka'),
]


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
        self.adj_city = defaultdict(dict)  # uid -> {uid: 1 city / 0 normal} (fast decomp)
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
            self.adj_city[u][v] = city
            self.adj_city[v][u] = city
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
                self.adj_city[u].pop(v, None)
                self.adj_city[v].pop(u, None)
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

    def company_anchors(self, tokmap):
        """city_id -> sorted [depot node uid] from Company items (phase-scanned).

        The depot-accurate anchor (slice 2): each company placement in a city is
        a real freight terminal, where the CityArea label is only a map caption.
        Company item payload (TruckLib CompanySerializer), after the item head:
            token city | u64 prefab_uid | token company | u64 node_uid
            | u32 count | u64 spawn_uids[count] | u32 spawn_flags[count]
        We find the city token (a known city id), then read the company token 16 B
        on, the depot node_uid 24 B on, and the spawn-point run. A hit is kept only
        when the company token decodes to a base-38 name, node_uid is a known node,
        and all `count` spawn uids are known nodes -- a structural signature a stray
        byte run cannot meet (a known node is ~1e-14 of the u64 space), so no
        def/company dir cross-check is needed. Deduped per city on node_uid.
        """
        nodeset = set(self.pos)
        hits = defaultdict(set)
        for (b, s, e, _src) in self.regions:
            for phase in range(8):
                base = s + phase
                k = (e - base) // 8
                for i in range(k):
                    o = base + i * 8
                    cid = tokmap.get(struct.unpack_from('<Q', b, o)[0])
                    if cid is None or o + 36 > e:
                        continue
                    comp = struct.unpack_from('<Q', b, o + 16)[0]
                    node = struct.unpack_from('<Q', b, o + 24)[0]
                    count = struct.unpack_from('<I', b, o + 32)[0]
                    if node not in nodeset or not (0 < count <= 64) or detok(comp) is None:
                        continue
                    if o + 36 + count * 8 > e:
                        continue
                    if all(struct.unpack_from('<Q', b, o + 36 + j * 8)[0] in nodeset
                           for j in range(count)):
                        hits[cid].add(node)
        return {cid: sorted(ns) for cid, ns in hits.items()}

    def dijkstra_decomp(self, src, targets):
        """{node: (city_m, normal_m, total_m)} from `src` to each node in `targets`.

        One map-metre Dijkstra, propagating the city/normal split as nodes settle,
        so the whole depot x depot distance matrix is a Dijkstra per source node --
        no per-pair path reconstruction (route()).
        """
        dist = {src: 0.0}
        cm = {src: 0.0}
        nm = {src: 0.0}
        pq = [(0.0, src)]
        want = set(targets)
        out = {}
        adj, adjc = self.adj, self.adj_city
        while pq and want:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            if u in want:
                out[u] = (cm[u], nm[u], d)
                want.discard(u)
                if not want:
                    break
            cmu, nmu, auc = cm[u], nm[u], adjc[u]
            for v, w in adj[u].items():
                nd = d + w
                if nd < dist.get(v, 1e30):
                    dist[v] = nd
                    if auc[v]:
                        cm[v], nm[v] = cmu + w, nmu
                    else:
                        cm[v], nm[v] = cmu, nmu + w
                    heapq.heappush(pq, (nd, v))
        return out

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

    # Two scales: from the .mbd when readable, else the documented defaults (an
    # unreadable .mbd falls back to a least-squares fit from the oracle, below).
    mbd_path = args.mbd or find_mbd(sources)
    scales = read_mbd(mbd_path) if mbd_path else None
    if scales:
        normal_scale, city_scale = scales
        scale_src = "mbd %s" % mbd_path
    else:
        normal_scale, city_scale = DEFAULT_SCALES
        scale_src = "unreadable mbd" if mbd_path else "no mbd"

    citykm = json.load(open(args.citykm)) if args.citykm else None
    sample_pairs = ([tuple(p.split(':')) for p in args.pairs.split(',')]
                    if args.pairs else DEFAULT_SAMPLE)
    city_ids = set()
    if citykm:
        for key in citykm:
            a, b = key.split('|')
            city_ids.add(a); city_ids.add(b)
    for a, b in sample_pairs:
        city_ids.add(a); city_ids.add(b)
    tokmap = {tok(c): c for c in city_ids if tokenizable(c)}
    snap = snapper(g, giant)

    # Slice-1 anchor (CityArea label centroid), kept for the comparison.
    centroid_hits = g.city_anchors(tokmap)
    centroid_net = {}                        # city -> giant node (snap < max, on giant)
    centroid_anchored = 0
    for cid, ns in centroid_hits.items():
        r = snap(ns)
        if not r:
            continue
        centroid_anchored += 1
        if r[1] < args.snap_max and r[0] in giant:
            centroid_net[cid] = r[0]

    # Slice-2 anchor: company depot node_uids, each snapped to the giant net.
    depot_hits = g.company_anchors(tokmap)
    depots_total = iso = small = on_g = 0
    off_snaps = []
    depot_net = {}                           # city -> sorted [giant anchor node]
    for cid, nodes in depot_hits.items():
        gns = []
        for nd in nodes:
            depots_total += 1
            if nd not in g.adj:
                iso += 1
            elif nd in giant:
                on_g += 1
            else:
                small += 1
            r = snap([nd])
            if r is None:
                continue
            gnode, sd = r
            if nd not in giant:
                off_snaps.append(sd)
            if sd < args.snap_max:
                gns.append(gnode)
        if gns:
            depot_net[cid] = sorted(set(gns))

    off_med = sorted(off_snaps)[len(off_snaps) // 2] if off_snaps else 0.0
    print("\ncities anchored (depot)=%d  on giant network=%d   [slice-1 centroid: %d / %d]"
          % (len(depot_hits), len(depot_net), centroid_anchored, len(centroid_net)))
    print("depots=%d  node on giant=%d  off giant=%d (small-comp %d / isolated %d)  off-giant snap median=%.0fm"
          % (depots_total, on_g, small + iso, small, iso, off_med))

    # Depot x depot game-distance matrix (one decomp Dijkstra per needed anchor).
    need_cities = set(depot_net) if citykm else set()
    for a, b in sample_pairs:
        need_cities.add(a); need_cities.add(b)
    need_nodes = sorted({n for c in need_cities if c in depot_net for n in depot_net[c]})
    tset = set(need_nodes)
    tmat = time.time()
    D = {sn: g.dijkstra_decomp(sn, tset) for sn in need_nodes} if need_nodes else {}
    if need_nodes:
        print("depot matrix: %d anchor nodes, %.1fs" % (len(need_nodes), time.time() - tmat))

    def depot_pick(a, b, which):
        """(city_m, normal_m) of the a->b depot pair chosen by min or median game km."""
        cand = []
        for an in depot_net.get(a, ()):
            row = D.get(an, {})
            for bn in depot_net.get(b, ()):
                r = row.get(bn)
                if r:
                    cand.append((r[1] * normal_scale + r[0] * city_scale, r[0], r[1]))
        if not cand:
            return None
        cand.sort()
        _, c, n = cand[0 if which == 'min' else len(cand) // 2]
        return c, n

    def dual(c, n):
        return n * normal_scale + c * city_scale

    def spread(rows):
        if not rows:
            return 1e9
        res = sorted(100.0 * (dual(c, n) / (km * 1000.0) - 1.0) for (_, _, c, n, km) in rows)
        return res[9 * len(res) // 10] - res[len(res) // 10]

    single = args.scale
    if citykm:
        rows_c, rows_min, rows_med = [], [], []
        for key, km in citykm.items():
            a, b = key.split('|')
            if a in centroid_net and b in centroid_net:
                r = g.route(centroid_net[a], centroid_net[b])
                if r and r[2] > 0:
                    rows_c.append((a, b, r[0], r[1], km))
            if a in depot_net and b in depot_net:
                pm, pd = depot_pick(a, b, 'min'), depot_pick(a, b, 'median')
                if pm:
                    rows_min.append((a, b, pm[0], pm[1], km))
                if pd:
                    rows_med.append((a, b, pd[0], pd[1], km))
        win = 'min' if spread(rows_min) <= spread(rows_med) else 'median'
        win_rows = rows_min if win == 'min' else rows_med
        if win_rows:
            single = fit_single(win_rows)
            if not scales and win_rows:              # unreadable mbd -> fit headline scales
                fc, fn = fit_dual(win_rows)
                normal_scale, city_scale = fn, fc
                scale_src = "fitted from oracle (lsq)"
        print("\noracle pairs on net: centroid=%d  depot=%d" % (len(rows_c), len(rows_med)))
        print("scales: normal=%.2f city=%.2f  [%s]" % (normal_scale, city_scale, scale_src))
        print("depot aggregation all-pairs spread: min=%.1f  median=%.1f  -> keep %s"
              % (spread(rows_min), spread(rows_med), win))
        if args.validate:
            print("\n  CENTROID anchor (slice 1), dual %.0f/%.0f:" % (normal_scale, city_scale))
            residual_bands(rows_c, dual)
            print("  DEPOT-MIN anchor, dual %.0f/%.0f:" % (normal_scale, city_scale))
            residual_bands(rows_min, dual)
            print("  DEPOT-MEDIAN anchor, dual %.0f/%.0f:" % (normal_scale, city_scale))
            residual_bands(rows_med, dual)
            fc, fn = fit_dual(win_rows)
            print("  DEPOT-%s oracle-fitted normal=%.2f city=%.2f (diagnostic):"
                  % (win.upper(), fn, fc))
            residual_bands(win_rows, lambda c, n: n * fn + c * fc)

    # Sample table: centroid vs depot (min, median) game km under the dual scale.
    def cell(cn, km):
        if cn is None:
            return "%13s" % "-"
        gk = dual(cn[0], cn[1]) / 1000.0
        return "%4.0f %+6.1f%%" % (gk, 100 * (gk / km - 1)) if km else "%8.0f     " % gk
    print("\n%-22s %7s  %-13s %-13s %-13s %6s"
          % ("pair", "oracle", "centroid", "depot-min", "depot-med", "depots"))
    for a, b in sample_pairs:
        km = citykm.get('%s|%s' % (a, b), citykm.get('%s|%s' % (b, a))) if citykm else None
        cen = None
        if a in centroid_net and b in centroid_net:
            r = g.route(centroid_net[a], centroid_net[b])
            if r:
                cen = (r[0], r[1])
        if a in depot_net and b in depot_net:
            dn = "%dx%d" % (len(depot_net[a]), len(depot_net[b]))
            print("%-22s %7s  %-13s %-13s %-13s %6s"
                  % ('%s:%s' % (a, b), km if km else "-", cell(cen, km),
                     cell(depot_pick(a, b, 'min'), km), cell(depot_pick(a, b, 'median'), km), dn))
        else:
            print("%-22s %7s  %-13s  depot unanchored"
                  % ('%s:%s' % (a, b), km if km else "-", cell(cen, km)))


if __name__ == '__main__':
    main()
