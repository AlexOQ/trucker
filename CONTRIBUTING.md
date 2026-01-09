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

For simple fixes, edit the JSON file and submit a PR:

1. Fork the repository
2. Edit the relevant file in `/data/`
3. Submit a pull request with a clear description

### 3. Add New Content

When new DLC or updates add content:

1. Check existing data to understand the format
2. Add new entries following the conventions in [DATA.md](DATA.md)
3. Submit a PR with all related changes

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

## File Formats

### cities.json
```json
[
  { "id": 1, "name": "Berlin", "country": "Germany" }
]
```

### companies.json
```json
[
  { "id": 1, "name": "Scania" }
]
```

### cargo.json
```json
[
  {
    "id": 1,
    "name": "Electronics",
    "value": 1850,
    "excluded": false,
    "high_value": true,
    "fragile": true
  }
]
```

### trailers.json
```json
[
  { "id": 1, "name": "Curtain Sider", "ownable": true }
]
```

### city-companies.json
```json
[
  { "cityId": 1, "companyId": 5, "count": 2 }
]
```

### company-cargo.json
```json
[
  { "companyId": 5, "cargoId": 12 }
]
```

### cargo-trailers.json
```json
[
  { "cargoId": 12, "trailerId": 3 }
]
```

## Code Contributions

### Setup

```bash
git clone https://github.com/your-username/trucker.git
cd trucker
npm install
```

### Testing Changes

```bash
# Start local server
npx serve .

# Open http://localhost:3000
```

### Code Style

- Use ES modules (`import`/`export`)
- Keep functions small and focused
- Add comments for complex logic
- Follow existing code patterns

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
