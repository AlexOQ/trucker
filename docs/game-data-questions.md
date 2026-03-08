# Game Data Questions

Questions to verify once extracted game definition files are received.

## Cargo (def/cargo/)

1. Is `group[]` the array that contains `fragile` token for Fragile Cargo skill? (vs `fragility` float which is damage sensitivity)
2. Does `valuable: true` correspond to the High Value Cargo skill requirement?
3. What are all possible `body_types[]` tokens across all cargo? (curtainside, dryvan, refrigerated, flatbed, etc.)
4. What are all possible `group[]` tokens? (machinery, adr, containers, refrigerated, liquid, fragile, construction, bulk, oversize — any others?)
5. Are `adr_class` values 1-9 matching real ADR classes, or game-specific?
6. Does `prob_coef` default to 1.0 when not specified? What's the range in practice?
7. What percentage of cargo has `minimum_distance` or `maximum_distance` set? What are typical values?
8. Is `overweight` a separate flag from `oversize`, or are they the same thing?
9. Are there cargo definitions split across DLC .scs files, or are they all in def.scs? (Forum suggested some like "canned pork" are in dlc_east.scs)

## Trailers (def/vehicle/trailer_defs/)

10. What are all `body_type` tokens used across trailer defs? Do they exactly match the cargo `body_types[]` tokens?
11. What `country_validity[]` restrictions exist? Which trailers have them?
12. What are the `length` values for trailers that have them? Which trailers are "long" (doubles, HCTs)?
13. What is `chain_type` and what values does it take? How does it affect job generation?
14. Can we compute exact unit counts as `floor(trailer_volume / cargo_volume)`? Or does the game use a different formula?
15. Do weight limits ever cap units below what volume allows? (i.e., `gross_trailer_weight_limit` minus `chassis_mass` minus `body_mass` = max cargo weight, then `max_cargo_weight / cargo_mass` might be less than volume-based units)
16. Are there trailers that are NOT ownable? How is that determined — is it a flag in the trailer def or separate?

## Depots / Prefabs

17. Where is `allowed_trailer_length` defined? Is it in depot prefab data (map files) or somewhere in def/?
18. Is `allowed_trailer_length` per-company, per-city, or per-depot instance?
19. Can we extract it from .scs files, or is it baked into map binary data?

## Companies (def/company/)

20. Do `def/company/<name>/out/*.sii` files list all cargo a company ships? Is this the ground truth for our `company_cargo` map?
21. Do `def/company/<name>/editor/*.sii` files contain city placement data? Is this the ground truth for `city_companies`?
22. Are company depot counts (our `city_companies[city][company] = count`) derivable from game defs, or only from save game observation?

## Economy (def/economy_data.sii)

23. What is the full payment formula? We believe: `€600 + (units × unit_reward_per_km × route_km × market_coef) + bonuses`
24. What are the `revenue_coef_per_km` values? (believed: 0.9 freight market, 1.0 cargo market, 0.67 AI drivers)
25. Are there other economy coefficients that affect job value?

## DLC Structure

26. Does each DLC .scs follow the same `def/cargo/`, `def/vehicle/`, `def/company/` structure?
27. Do DLC cargo/trailer defs override or extend base game defs?
28. Is there a manifest or index that lists which DLCs are installed?

## Map / Route Data

29. Is there any route distance data extractable from game files? Or is that purely runtime pathfinding?
30. Are city coordinates or connections available in any extractable format?
31. Are city/company node positions stored in map sector files (.mbd/.base)? Can we extract x,z coordinates?
32. Is there a road network graph or adjacency list anywhere? Or do we need node positions + Euclidean approximation?
33. Does the game pre-compute route distances, or pathfind on the fly? If pre-computed, where stored?

## Trucks (def/vehicle/truck/)

36. What engine options exist per truck brand? What are the torque/HP/consumption_coef values?
37. What chassis configs exist per truck? (4x2, 6x2, 6x4, 8x4) — do heavier configs unlock heavy cargo jobs?
38. What transmission options exist? How many gears, what differential ratios?
39. Is there a direct relationship between axle config and max cargo weight in game mechanics?
40. Does `consumption_coef` scale linearly with fuel usage? What's the base consumption formula?
41. Are retarders defined per truck or as universal accessories?
42. What fuel tank size options exist per chassis config?
43. Is there data on truck price, unlock level, or maintenance cost in the defs?

## Derived Calculations (to validate)

34. Can we compute per-city cargo spawn probability as: `prob_coef × (reachable_destinations / total_destinations)`?
    - Where reachable = destinations accepting that cargo within min/max distance range
    - This would let us estimate spawn rates from game defs + city positions alone
35. How well does this calculated probability match our observed `company_cargo_frequency`?
    - If close: observations become optional validation layer
    - If divergent: game has additional hidden factors (market randomness, player level, etc.)
