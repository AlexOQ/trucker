# Data Sources and Conventions

This document explains where the data comes from and the conventions used.

## Data Sources

### Cities

Cities are sourced from the in-game map. Each city entry includes:
- **Name**: Official in-game name with proper Unicode/diacritics (e.g., "Zürich" not "Zurich")
- **Country**: The country where the city is located

### Companies (Depot Types)

Company/depot data comes from in-game observation. Each company entry represents a **type of depot** (not a specific location). For example:
- "Scania" = Scania dealership depot
- "Posped" = Posped warehouse depot
- "ITCC Factory" = ITCC industrial factory

**Multi-type companies**: Some companies have different depot types that export different cargo. These are split into separate entries:
- "ITCC Factory" - produces industrial goods
- "ITCC Scrapyard" - produces scrap metal

### Cargo Types

Cargo data is extracted from game files and in-game freight market. Each cargo includes:
- **Name**: Official cargo name
- **Value**: Base value in € per km (approximate)
- **Excluded**: Whether this is a trailer delivery job (no trailer choice)
- **High Value**: Premium cargo with special handling
- **Fragile**: Requires careful driving

### Trailer Types

Trailer data comes from in-game dealer listings. Each trailer includes:
- **Name**: Trailer type name
- **Ownable**: Whether players can purchase this trailer

**Non-ownable trailers** include:
- Car transporters (used for vehicle cargo)
- Special industry trailers
- Some DLC-specific trailers

### Relationships

#### City → Depots
The `city-companies.json` file maps each city to its depot types with counts:
```json
[
  { "cityId": 1, "companyId": 5, "count": 2 }
]
```
A count of 2 means there are two depots of that type in the city.

#### Company → Cargo
The `company-cargo.json` file maps depot types to the cargo they export:
```json
[
  { "companyId": 5, "cargoId": 12 }
]
```

#### Cargo → Trailers
The `cargo-trailers.json` file maps cargo types to compatible trailers:
```json
[
  { "cargoId": 12, "trailerId": 3 }
]
```

## Data Conventions

### City Names
- Use proper Unicode characters and diacritics
- Match the exact in-game spelling
- Examples: "Córdoba", "Zürich", "Göteborg"

### Excluded Cargo
Cargo marked `excluded: true` represents **trailer delivery jobs**:
- Krone trailers
- Feldbinder trailers
- Other branded trailer deliveries

These jobs assign a specific trailer to deliver - you're hauling the trailer itself, not cargo inside it. They don't require your own trailer, so they're excluded from optimization.

### Non-Ownable Trailers
Some cargo requires trailers that can't be purchased:
- Car transporters (for Cars, Vans, SUVs)
- Truck transporters (for Trucks, Pickups)
- Special industry trailers (Blade Hauler)
- Trailer delivery trailers (Feldbinder, Krone)

The algorithm includes these in calculations but notes them as non-ownable, since you'd rely on company-provided trailers.

### Dominated Trailers (Not Recommended)

Some trailers are **strictly dominated** by others - meaning another trailer can haul all the same cargo types plus additional exclusive cargo. These are marked as non-ownable since purchasing them would always be suboptimal:

| Dominated Trailer | Cargo Types | Superseded By | Cargo Types | Exclusive Bonus |
|-------------------|-------------|---------------|-------------|-----------------|
| **Dry Freighter** | 127 | **Curtainsider** | 132 | +5 (Aircraft Tyres, Ammunition, Dynamite, Explosives, Fireworks) |
| **Insulated** | 36 | **Refrigerated** | 43 | +7 (Caviar, Cheese, Fish, Frozen Vegetables, Ice Cream, Prawns, Smoked Eel) |

**Why this matters**: The greedy optimization algorithm might otherwise recommend Dry Freighter or Insulated due to diminishing returns on repeated trailer selections. By marking them non-ownable, the algorithm correctly chooses the superior alternatives.

**Note on Container Carrier vs Flatbed**: While real flatbed trailers with container pins can carry containers, in the game these are distinct trailer types. Container Carrier has 2 exclusive cargo types (Hydrogen, Motorcycle Tyres) that Flatbed cannot haul, so both remain valid choices.

### Value Estimation
Cargo values are approximate and may vary based on:
- Game updates and patches
- DLC content
- Market fluctuations

Values represent typical €/km rates observed in-game.

## File Structure

```
/data
  cities.json         # City definitions
  companies.json      # Depot type definitions
  cargo.json          # Cargo type definitions (optional, reviewed separately)
  trailers.json       # Trailer type definitions (optional, reviewed separately)
  city-companies.json # City → Depot mappings with counts
  company-cargo.json  # Depot → Cargo mappings
  cargo-trailers.json # Cargo → Trailer compatibility
```

## Contributing Data

### Adding a New City
1. Add entry to `cities.json` with proper Unicode name
2. Add depot mappings to `city-companies.json`
3. Ensure depot types exist in `companies.json`

### Adding a New Company/Depot Type
1. Add entry to `companies.json`
2. Add cargo mappings to `company-cargo.json`
3. Ensure cargo types exist in `cargo.json`

### Fixing Data Issues
Common issues to look for:
- Duplicate cities (ASCII vs Unicode names)
- Missing depot counts
- Cargo without trailer compatibility
- Incorrect value estimates

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.

## Data Quality

### Verification
Data accuracy is verified through:
- In-game observation
- Cross-referencing game files
- Community feedback

### Known Limitations
- Values are estimates, not exact game values
- Some regional/DLC content may be incomplete
- Game updates may introduce new content

### Reporting Issues
If you find incorrect data, please:
1. Open an issue with the specific error
2. Provide the correct information with source
3. Consider submitting a PR with the fix
