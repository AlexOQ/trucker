# Contributing to ETS2 Trucker Advisor

Thank you for your interest in contributing! This guide covers how to report issues, fix data, and add new content.

## Ways to Contribute

### 1. Report Data Issues

Found incorrect data? Open an issue with:

- **What's wrong**: The specific error you found
- **Where it is**: Which city, company, or cargo
- **Correct value**: What it should be (with source if possible)

Example:
> "Rotterdam shows only 1 depot for Posped, but in-game there are 2."

### 2. Fix Data Directly

For simple fixes, edit the data and submit a PR:

1. Fork the repository
2. Edit the relevant file under `public/data/<game>/`. Note: `game-defs.json` is **generated** by the parser — don't hand-edit it (a reparse overwrites your change). The hand-editable supplements are `observations.json`, `manual-prices.json`, and `multi-body-overrides.json`. Trailer prices have a dedicated path — see *Contribute Trailer Price Walks* below.
3. Submit a pull request with a clear description

### 3. Add New Content

When a game update or new DLC adds content, the data is **regenerated**, not hand-edited: extract the game's `def/` folder and re-run the parser (`scripts/parse-game-defs.ts`). See the **Game Data Pipeline** in [CLAUDE.md](CLAUDE.md) for the full procedure, then submit a PR with the regenerated `game-defs.json` plus any updated supplements.

### 4. Contribute Trailer Price Walks

Multi-trailer (HCT/double) and DLC-brand trailer prices are assembled in the in-game customization screen and can't be read from the game files — they're hand-walked into `public/data/<game>/manual-prices.json`. If you own a trailer DLC that's still missing prices, see the walk methodology, the live "wanted" queue, and step-by-step intake in [docs/manual-prices-audit.md](docs/manual-prices-audit.md#contributing-a-walk).

## Data Contribution Guidelines

### City Names

- Use exact in-game spelling
- Include Unicode/diacritics: "Córdoba" not "Cordoba"
- Check for duplicates before adding

### Depot Counts

- Count carefully - some cities have multiple depots of the same type
- Company dealerships often have 1, warehouses/factories may have more

### Cargo Mappings

- Verify which depots export which cargo
- Some companies have depot variants (Factory vs Warehouse)
- Mark trailer delivery jobs as `excluded: true`

### Trailer Compatibility

- Check in-game dealer for trailer/cargo compatibility
- Mark non-purchasable trailers as `ownable: false`
- Car transporters require special handling

## Data Model

The data is **generated**, not maintained as hand-written flat files. Each game has a single `public/data/<game>/game-defs.json` (e.g. `public/data/ets2/game-defs.json`) produced by `scripts/parse-game-defs.ts` from the extracted game `def/` files. It holds cargo, trailers, companies, cities, countries, economy, trucks, and the DLC registry — each section an object keyed by game id (not an array). It's supplemented by three smaller files per game:

- `observations.json` — data parsed from save games (spawn frequencies, unit counts) that validates and fills gaps in the generated defs.
- `manual-prices.json` — hand-walked trailer prices the parser can't recover (see *Contribute Trailer Price Walks*).
- `multi-body-overrides.json` — trailers that physically haul more than their primary `body_type`.

For the authoritative schema and how it's generated, see the **Data Model** and **Game Data Pipeline** sections of [CLAUDE.md](CLAUDE.md). A cargo entry, for example, is keyed by its game id:

```json
"aircond": {
  "name": "aircond",
  "value": 4.7,
  "fragile": true,
  "high_value": true,
  "excluded": false
}
```

(`value` is per-km; the entry carries more fields — `volume`, `mass`, `prob_coef`, `body_types`, … — see `game-defs.json` for the full shape.)

## Code Contributions

### Setup

```bash
git clone https://github.com/AlexOQ/trucker.git
cd trucker
npm install
```

### Testing Changes

```bash
# Start Vite dev server with hot reload
npm run dev:frontend

# Open http://localhost:5173

# Run tests
npm run test

# Type check
npm run lint
```

### Code Style

- TypeScript source in `src/frontend/`
- Use ES modules (`import`/`export`)
- Keep functions small and focused
- Add comments for complex logic
- Follow existing code patterns
- Run `npm run lint` before committing

### Pull Request Process

1. Create a feature branch: `git checkout -b fix/city-data`
2. Make your changes
3. Test locally
4. Commit with clear message: `Fix Rotterdam depot count`
5. Push and create PR
6. Respond to review feedback

## Questions?

- Open an issue for questions about data or features
- Check existing issues before creating new ones
- Be respectful and constructive in discussions

## Recognition

Contributors are appreciated! Significant contributors may be added to the README acknowledgments section.
