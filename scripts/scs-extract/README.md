# scs-extract

Lists or extracts files from an SCS# (HashFS **v2**) archive — the `.scs`
container format used by ETS2 and ATS. Used to pull the `def/` tree out of game
and DLC archives for `scripts/parse-game-defs.ts` (CLAUDE.md step 1, "Extract
`def/` folder … (SCS Extractor)").

## Why not the upstream tool

[`github.com/Luzifer/scs-extract`](https://github.com/Luzifer/scs-extract) parses
the HashFS v2 metadata table sequentially and aborts with
`unhandled file type: 0` on the texture/sample/mip entry types packed inside DLC
archives (e.g. `dlc_bobcat.scs`). This tool never walks the metadata table
sequentially: the table is a flat array of 4-byte words, and a catalog entry's
`MetadataIndex` is the word offset of its own record, so it seeks straight to the
one file it wants. Directory listings drive a recursive walk, so every `.sii`/
`.sui` def file is reachable without ever decoding a texture entry. It reuses
that project's `b0rkhash` CityHash64 (Apache-2.0, via `go.mod`) so path→hash
lookups match the game exactly.

Only plain files (`0x80`) and directories (`0x81`) are decoded; other entry
types are listed but skipped on extract — exactly the `def/` subset the parser
needs.

## Usage

```
go run . [-x] [-o DIR] ARCHIVE.scs [ROOTPATH]

  -x         extract instead of list
  -o DIR     output directory for -x (default "extracted")
  ROOTPATH   limit the walk to this subtree (default "def"; "" = whole archive)
```

List the cargo defs a pack ships:

```sh
go run . "$ATS/dlc_bobcat.scs" def/cargo
```

Extract the def tree for a reparse (overlay base + DLC archives into one folder,
last-write-wins, then point the parser at it):

```sh
ATS="$HOME/Library/Application Support/Steam/steamapps/common/American Truck Simulator"
for a in def base base_share dlc_*; do
  go run . -x -o /tmp/ats_def "$ATS/$a.scs" def
done
npx tsx ../parse-game-defs.ts /tmp/ats_def/def --game ats
```

## Deriving cargo→DLC-pack mappings

Each cargo pack defines its cargo in `def/cargo.<dlc>.sii`, an aggregator of
`@include "cargo/<id>.<dlc>.sui"` lines. The `<id>` tokens are the cargo IDs.
This is how `ATS_CARGO_DLC_MAP` in `parse-game-defs.ts` was sourced (#243), and
the same method populates `ATS_MAP_DLC_CARGO` from a `dlc_<state>.scs` once that
state map DLC is owned.
