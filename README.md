# ETS2 Trucker Advisor

Optimize your AI driver garages in Euro Truck Simulator 2. This tool recommends the best trailer sets for each city based on available cargo and depot types.

## Live Site

Visit the live tool at: **[alexoq.github.io/trucker](https://alexoq.github.io/trucker)**

## Features

- **City Rankings**: See which cities offer the best opportunities for AI drivers
- **Trailer Optimization**: Get recommended trailer sets for any city garage
- **Configurable Algorithm**: Adjust parameters to match your play style
- **Reference Pages**: Browse cities, companies, and cargo types

## How It Works

AI drivers in ETS2 can only take jobs if they have a compatible trailer. This tool analyzes:

1. Which depot types exist in each city
2. What cargo each depot exports
3. Which trailers can haul each cargo type

Then it uses a greedy optimization algorithm to recommend the best mix of trailers for your garage slots.

### Algorithm Controls

- **Scoring Balance**: Trade off between high-value cargo and broad coverage
- **Garage Size**: Number of trailer slots (1-20)
- **Diversity Pressure**: How strongly to avoid duplicate trailers

See [ALGORITHM.md](ALGORITHM.md) for the full technical explanation.

## Data

All data is stored in JSON files for easy contribution. See [DATA.md](DATA.md) for:

- Data sources and verification
- File format conventions
- How to add new cities, companies, or cargo

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- How to report data errors
- How to add new content
- Code contribution guidelines

### Quick Data Fix

Found incorrect data? The easiest way to help:

1. Open an issue describing the error
2. Or edit the JSON file directly and submit a PR

## Local Development

```bash
# Clone the repository
git clone https://github.com/AlexOQ/trucker.git
cd trucker

# Serve locally (any static file server works)
npx serve .

# Open http://localhost:3000
```

### With Database (for data export)

If you need to regenerate JSON data from the source database:

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
npm install

# Run export script
npm run export        # Cities, companies, relationships only
npm run export -- --all  # Include cargo and trailers
```

## Project Structure

```
/
├── index.html          # Main rankings page
├── cities.html         # Cities reference
├── companies.html      # Companies reference
├── cargo.html          # Cargo reference
├── css/style.css       # Shared styles
├── js/
│   ├── data.js         # Data loading
│   ├── optimizer.js    # Optimization algorithm
│   └── storage.js      # localStorage wrapper
├── data/               # JSON data files
├── ALGORITHM.md        # Algorithm documentation
├── DATA.md             # Data documentation
└── CONTRIBUTING.md     # Contribution guide
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Data sourced from Euro Truck Simulator 2 by SCS Software
- Inspired by [MerchantGameDB](https://benzeliden.github.io/MerchantGameDB/)
- Community contributors who help maintain accuracy
