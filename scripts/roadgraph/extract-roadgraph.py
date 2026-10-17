#!/usr/bin/env python3
"""Spike (#320): build a city-pair road-distance graph from ETS2 map sectors.

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
               u64 backward_item | u64 forward_item | u32 flags
  Road item tail: ... | u64 node0 | u64 node1 | f32 length(metres)

Method:
  1. Locate each sector's node array by the tail equation
         O + 4 + node_count*56 + 4 + vis_count*8 == filesize
     validated by unit-norm quaternions, and decode node positions.
  2. Phase-scan the item bytes for runs of consecutive known-node UIDs (every
     node-ref list — prefab Nodes[], company spawn groups, a road's node pair —
     is such a run, all at one offset-phase mod 8). Clique each run:
       - a 2-run whose trailing f32 is a plausible road length  -> road edge (m)
       - any other run                                          -> junction/prefab,
         cliqued at straight-line cost (prefab interiors are short)
  3. Anchor cities from CityArea items (token name | f32 w | f32 h | u64 node),
     snap each to the nearest graph node, and shortest-path between them.

Distances come out in MAP metres; ETS2 compresses the world ~1:19, so multiply by
the map scale for in-game km.  With --citykm the scale is fitted from the oracle.

Usage:
    extract-roadgraph.py SRC [SRC ...] --pairs a:b,c:d [--scale N]
    extract-roadgraph.py SRC [SRC ...] --citykm PATH [--validate]
  SRC is DIR (labelled by its basename) or LABEL=DIR; the label is the DLC
  provenance (#326).  --only L1,L2 restricts the graph to those sources.
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
        self.adj = defaultdict(dict)     # uid -> {uid: weight_metres}
        self.edge_src = {}               # frozenset({u,v}) -> source label
        self.regions = []                # (bytes, item_start, item_end, source)
        self.sectors = self.empty = 0
        self.road_edges = 0
        self.real_sum = self.chord_sum = 0.0

    def _d3(self, u, v):
        return math.dist(self.pos[u], self.pos[v])

    def _link(self, u, v, w, src):
        if v not in self.adj[u] or w < self.adj[u][v]:
            self.adj[u][v] = w
            self.adj[v][u] = w
            self.edge_src[frozenset((u, v))] = src

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
            self.regions.append((b, 20, O, source))

    def build_edges(self):
        nodeset = set(self.pos)
        for (b, s, e, src) in self.regions:
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
                            self._link(run[0], run[1], L, src)
                            self.road_edges += 1
                            self.real_sum += L
                            self.chord_sum += ch
                        else:                            # a 2-node connector/prefab
                            self._link(run[0], run[1], ch, src)
                    elif len(run) > 2:                   # junction / prefab: clique
                        r = run if len(run) <= 16 else run[:16]
                        for a in range(len(r)):
                            for c in range(a + 1, len(r)):
                                self._link(r[a], r[c], self._d3(r[a], r[c]), src)
                    i = j

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sources', nargs='+', help='DIR or LABEL=DIR of extracted .base sectors')
    ap.add_argument('--pairs', help='comma list of a:b city-id pairs to route')
    ap.add_argument('--citykm', help='oracle JSON ("a|b": km) for scale fit + validation')
    ap.add_argument('--validate', action='store_true', help='full residual report vs the oracle')
    ap.add_argument('--only', help='comma list of source labels to keep (DLC subset, #326)')
    ap.add_argument('--scale', type=float, default=19.0, help='map->game scale when no --citykm')
    ap.add_argument('--snap-max', type=float, default=1500.0, help='max city snap distance, metres')
    args = ap.parse_args()

    t0 = time.time()
    g = Graph()
    for label, d in parse_sources(args.sources):
        files = sorted(glob.glob(os.path.join(d, '**', '*.base'), recursive=True))
        if not files:
            sys.exit('no .base files under %s' % d)
        g.load_nodes(files, label)
    g.build_edges()
    g.restrict(set(args.only.split(',')) if args.only else None)
    comps = g.components()
    giant = set(comps[0]) if comps else set()
    print("nodes=%d  graph_nodes=%d  road_edges=%d  sectors=%d (+%d empty)  %.1fs"
          % (len(g.pos), len(g.adj), g.road_edges, g.sectors, g.empty, time.time() - t0))
    print("components=%d  giant=%d  top=%s"
          % (len(comps), len(giant), [len(c) for c in comps[:5]]))
    if g.chord_sum:
        print("road length vs straight-line chord: +%.2f%% (real %.0f km / chord %.0f km)"
              % (100 * (g.real_sum / g.chord_sum - 1), g.real_sum / 1000, g.chord_sum / 1000))

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
    print("cities anchored=%d  on giant network (<%.0fm)=%d" % (len(anchored), args.snap_max, len(on_net)))

    scale = args.scale
    if citykm:
        data = []
        for key, km in citykm.items():
            a, b = key.split('|')
            if a in on_net and b in on_net:
                d = g.dijkstra(on_net[a][0], on_net[b][0])
                if d and d > 0:
                    data.append((a, b, d, km))
        if data:
            ratios = sorted(km * 1000.0 / m for (_, _, m, km) in data)
            scale = ratios[len(ratios) // 2]
            print("\noracle pairs on network=%d  fitted scale=%.2f (ETS2 documented 1:19)"
                  % (len(data), scale))
            if args.validate:
                for lo in (0, 400, 800, 1200):
                    sub = [(m, km) for (_, _, m, km) in data if km >= lo]
                    if len(sub) < 20:
                        continue
                    rr = sorted(k * 1000.0 / m for m, k in sub)
                    sc = rr[len(rr) // 2]
                    res = sorted(100.0 * ((m / 1000.0 * sc) / k - 1.0) for m, k in sub)
                    w1 = 100.0 * sum(1 for r in res if abs(r) <= 1.0) / len(res)
                    print("  oracle>=%4dkm n=%4d scale=%.2f resid p10/p90 %+.1f/%+.1f%% |r|<=1%%:%.0f%%"
                          % (lo, len(sub), sc, res[len(res) // 10], res[9 * len(res) // 10], w1))

    if args.pairs:
        print("\n%-28s %9s %9s" % ("pair", "map_km", "game_km"))
        for p in args.pairs.split(','):
            a, b = p.split(':')
            if a not in anchored or b not in anchored:
                print("%-28s  unanchored (not a base_map city?)" % p)
                continue
            d = g.dijkstra(anchored[a][0], anchored[b][0])
            if d is None:
                print("%-28s  disconnected" % p)
                continue
            line = "%-28s %9.1f %9.0f" % (p, d / 1000, d / 1000 * scale)
            if citykm and ('%s|%s' % (a, b) in citykm or '%s|%s' % (b, a) in citykm):
                km = citykm.get('%s|%s' % (a, b), citykm.get('%s|%s' % (b, a)))
                line += "   oracle=%d (%+.1f%%)" % (km, 100 * (d / 1000 * scale / km - 1))
            print(line)


if __name__ == '__main__':
    main()
