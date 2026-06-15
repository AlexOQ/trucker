// Command scs-extract lists or extracts files from an SCS# (HashFS) archive,
// the container format used by Euro Truck Simulator 2 and American Truck
// Simulator `.scs` files.
//
// Why this exists: the upstream github.com/Luzifer/scs-extract CLI parses the
// HashFS v2 metadata table sequentially and aborts ("unhandled file type") on
// the texture/sample/mip entry types that ship inside DLC archives. This tool
// never walks the metadata table sequentially. The metadata table is a flat
// array of 4-byte words; a catalog entry's MetadataIndex is the word offset of
// its own metadata record, so we seek straight to meta[MetadataIndex*4] for the
// one file we want. Directory contents are themselves plain files listing their
// children, so a recursive walk from a root path reaches every `.sii`/`.sui`
// def file without ever decoding a texture entry.
//
// Only plain files (type 0x80) and directories (type 0x81) are decoded; other
// entry types (textures, samples, mip levels) are listed but skipped on
// extract, which is exactly what the def/ extraction the data pipeline needs.
//
// Usage:
//
//	go run . [-x] [-o DIR] ARCHIVE.scs [ROOTPATH]
//
//	-x         extract instead of list
//	-o DIR     output directory for -x (default "extracted")
//	ROOTPATH   limit the walk to this subtree (default "def"; pass "" for all)
//
// Example — extract the def tree the parser reads:
//
//	go run . -x -o /tmp/ats_def "$ATS/def.scs" def
//
// CityHash64 is the SCS-specific ("b0rked") variant from
// github.com/Luzifer/scs-extract/b0rkhash (Apache-2.0); reused via go.mod so the
// path→hash lookups match the game exactly.
package main

import (
	"compress/flate"
	"compress/zlib"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Luzifer/scs-extract/b0rkhash"
)

const (
	typePlainFile = 0x80
	typeDirectory = 0x81
	metaWordSize  = 4  // metadata table is a flat array of 4-byte words
	offsetBlock   = 16 // file offsets are stored in 16-byte blocks
	zipHeader     = 2  // 2-byte zlib header prefixing each compressed payload
	compressedBit = 0x10
)

type fileHeader struct {
	Magic                    [4]byte
	Version                  uint16
	Salt                     uint16
	HashMethod               [4]byte
	EntryCount               uint32
	EntryTableLength         uint32
	MetadataEntriesCount     uint32
	MetadataTableLength      uint32
	EntryTableStart          uint64
	MetadataTableStart       uint64
	SecurityDescriptorOffset uint32
	Platform                 byte
}

type catalogEntry struct {
	Hash          uint64
	MetadataIndex uint32
	MetadataCount uint16
	Flags         uint16
}

type archive struct {
	r       io.ReaderAt
	entries map[uint64]catalogEntry
	meta    []byte
}

func u24(b []byte) uint32 { return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 }

func openArchive(r io.ReaderAt) (*archive, error) {
	var h fileHeader
	if err := binary.Read(io.NewSectionReader(r, 0, int64(binary.Size(fileHeader{}))), binary.LittleEndian, &h); err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}
	if string(h.Magic[:]) != "SCS#" {
		return nil, fmt.Errorf("not an SCS# archive (magic %q)", h.Magic)
	}
	if h.Version != 2 {
		return nil, fmt.Errorf("unsupported HashFS version %d (only v2 handled)", h.Version)
	}

	// Catalog (entry) table: zlib-compressed array of catalogEntry.
	ez, err := zlib.NewReader(io.NewSectionReader(r, int64(h.EntryTableStart), int64(h.EntryTableLength)))
	if err != nil {
		return nil, fmt.Errorf("opening entry table: %w", err)
	}
	defer ez.Close()
	entries := make(map[uint64]catalogEntry, h.EntryCount)
	for i := uint32(0); i < h.EntryCount; i++ {
		var e catalogEntry
		if err := binary.Read(ez, binary.LittleEndian, &e); err != nil {
			return nil, fmt.Errorf("reading entry %d: %w", i, err)
		}
		entries[e.Hash] = e
	}

	// Metadata table: zlib-compressed flat blob, indexed by word offset.
	mz, err := zlib.NewReader(io.NewSectionReader(r, int64(h.MetadataTableStart), int64(h.MetadataTableLength)))
	if err != nil {
		return nil, fmt.Errorf("opening metadata table: %w", err)
	}
	defer mz.Close()
	meta, err := io.ReadAll(mz)
	if err != nil {
		return nil, fmt.Errorf("reading metadata table: %w", err)
	}
	return &archive{r: r, entries: entries, meta: meta}, nil
}

// entryFor returns the catalog entry for a path, or false if absent.
func (a *archive) entryFor(p string) (catalogEntry, bool) {
	e, ok := a.entries[b0rkhash.CityHash64([]byte(p))]
	return e, ok
}

// readFile decodes and returns the bytes of a plain file at the given path.
func (a *archive) readFile(p string) ([]byte, error) {
	e, ok := a.entryFor(p)
	if !ok {
		return nil, fmt.Errorf("not in archive: %s", p)
	}
	return a.readEntry(e)
}

func (a *archive) entryType(e catalogEntry) byte {
	return a.meta[int(e.MetadataIndex)*metaWordSize+3]
}

func (a *archive) readEntry(e catalogEntry) ([]byte, error) {
	off := int(e.MetadataIndex) * metaWordSize
	if off+20 > len(a.meta) {
		return nil, fmt.Errorf("metadata offset out of range")
	}
	p := a.meta[off+4 : off+20] // 16-byte payload after the 4-byte type header
	compSize := u24(p)
	flags := p[3]
	size := binary.LittleEndian.Uint32(p[4:])
	fileOff := uint64(binary.LittleEndian.Uint32(p[12:])) * offsetBlock

	if flags&compressedBit != 0 {
		sr := io.NewSectionReader(a.r, int64(fileOff+zipHeader), int64(compSize))
		return io.ReadAll(flate.NewReader(sr))
	}
	out := make([]byte, size)
	_, err := a.r.ReadAt(out, int64(fileOff))
	return out, err
}

type child struct {
	name  string
	isDir bool
}

// readDir parses a directory listing file into its immediate children.
// Layout: uint32 count, count bytes of name lengths, then the names; a name
// prefixed with '/' denotes a subdirectory.
func (a *archive) readDir(dir string) ([]child, error) {
	data, err := a.readFile(dir)
	if err != nil {
		return nil, err
	}
	if len(data) < 4 {
		return nil, nil
	}
	count := binary.LittleEndian.Uint32(data)
	lengths := data[4 : 4+count]
	pos := 4 + int(count)
	out := make([]child, 0, count)
	for i := uint32(0); i < count; i++ {
		n := int(lengths[i])
		name := string(data[pos : pos+n])
		pos += n
		isDir := strings.HasPrefix(name, "/")
		out = append(out, child{name: strings.TrimPrefix(name, "/"), isDir: isDir})
	}
	return out, nil
}

// walk visits every file under root, calling fn(path, entry). Directory
// listings drive the traversal so no sequential metadata parse is needed.
func (a *archive) walk(root string, fn func(string, catalogEntry)) error {
	children, err := a.readDir(root)
	if err != nil {
		return err
	}
	for _, c := range children {
		full := strings.TrimPrefix(path.Join(root, c.name), "/")
		if c.isDir {
			if err := a.walk(full, fn); err != nil {
				return err
			}
			continue
		}
		if e, ok := a.entryFor(full); ok {
			fn(full, e)
		}
	}
	return nil
}

func main() {
	extract := flag.Bool("x", false, "extract files instead of listing")
	outDir := flag.String("o", "extracted", "output directory for -x")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: scs-extract [-x] [-o DIR] ARCHIVE.scs [ROOTPATH]")
		os.Exit(2)
	}
	root := "def"
	if flag.NArg() >= 2 {
		root = flag.Arg(1)
	}

	f, err := os.Open(flag.Arg(0))
	if err != nil {
		fatal(err)
	}
	defer f.Close()
	a, err := openArchive(f)
	if err != nil {
		fatal(err)
	}

	// Root may be "" (archives rooted at "") or "locale" for locale.scs.
	if root != "" {
		if _, ok := a.entryFor(root); !ok {
			fatal(fmt.Errorf("root path %q not found in archive", root))
		}
	}

	var paths []string
	var skipped int
	err = a.walk(root, func(p string, e catalogEntry) {
		if t := a.entryType(e); t != typePlainFile && t != typeDirectory {
			skipped++ // texture/sample/mip — not a plain def file
			return
		}
		paths = append(paths, p)
	})
	if err != nil {
		fatal(err)
	}
	sort.Strings(paths)

	if !*extract {
		for _, p := range paths {
			fmt.Println(p)
		}
		fmt.Fprintf(os.Stderr, "%d files (%d non-plain entries skipped)\n", len(paths), skipped)
		return
	}
	for _, p := range paths {
		data, err := a.readFile(p)
		if err != nil {
			fatal(fmt.Errorf("reading %s: %w", p, err))
		}
		dest := filepath.Join(*outDir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			fatal(err)
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			fatal(err)
		}
	}
	fmt.Fprintf(os.Stderr, "extracted %d files to %s (%d non-plain entries skipped)\n", len(paths), *outDir, skipped)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
