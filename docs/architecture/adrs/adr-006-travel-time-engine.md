# ADR-006: Travel-Time Engine

## Status
Accepted

## Context
Routing without travel-time is bin-packing in 2D when reality is 3D. The day-pack solver (Module 06) needs to know: if Builder Mark goes from NG2 → NG9 → NG5 → NG14, how many minutes does that consume? What's the total mileage cost? Without this, packs look feasible on paper but bust the working day in practice — Builders run late, the last job gets cut, customer trust erodes.

We also need a visualisation of each day-pack on the offer page so the Builder can see the run before accepting. That's a different problem (rendering, not computing) with different cost/accuracy trade-offs.

## Options considered

**A: Postcode centroid + Haversine + avg speed.** Straight-line × 1.4 / 25mph. Pros: free, instant, offline. Cons: ignores roads + traffic, off 30–40% in dense urban areas.

**B: Google Maps Distance Matrix API.** Real driving time with traffic. Pros: accurate, traffic-aware. Cons: ~$5/1000 elements, online-only, needs key.

**C: OSRM self-hosted.** Open-source on OSM data. Pros: free at scale. Cons: server + OSM import + maintenance, no traffic data.

**D: Mapbox Matrix API.** Pros: cheaper at scale, generous free tier. Cons: another vendor, smaller UK traffic dataset.

## Decision

**Hybrid two-component setup:**

- **Visualisation: Google Maps Static API** — one PNG per offer with markers + path polyline, no interactive chrome. Already in use (test page shipped during MVP), enabled in the GCP project, served via `VITE_GOOGLE_MAPS_API_KEY` on the client.
- **Solver computation: Google Maps Distance Matrix API (Option B)** — server-side key, accurate driving time + distance per pack-construction decision. Used by Module 06 (day-pack solver) and Module 05 (routing engine, scoring stage).

Dev/CI fallback: Option A (Haversine × 1.4 / 25mph) when no API key is present. Saves cost in non-prod and removes external deps from tests.

## Caching strategy

Distance Matrix results cache for 24h, keyed by `(origin_postcode, dest_postcode, time_of_week_bucket)`. Time bucket = day-of-week + peak/off-peak/weekend. Cache lives in `route_distance_cache`:

```sql
CREATE TABLE route_distance_cache (
  id SERIAL PRIMARY KEY,
  origin_postcode VARCHAR(10) NOT NULL,
  dest_postcode VARCHAR(10) NOT NULL,
  time_bucket VARCHAR(20) NOT NULL,    -- "monday_peak", "saturday_offpeak", etc.
  drive_minutes INT NOT NULL,
  drive_miles DECIMAL(5,2) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(origin_postcode, dest_postcode, time_bucket)
);
```

Cache hits avoid the API call entirely. Miss → API call → write-through cache. TTL of 24h is the cache-invalidation safety net for shifting traffic patterns.

## Solver integration (Module 06 hooks)

The day-pack solver requests travel times in batch:

```ts
const travelMatrix = await getTravelTimes(
  [NG2, NG9, NG5, NG14],
  dayOfWeek,
);
// Returns 4×4 matrix of drive_minutes; diagonal = 0
```

Module 06 uses these in its proximity rules:
- Hub check: distance from Builder home to each stop ≤ 8 miles
- Chain check: drive_minutes between consecutive stops ≤ 25 minutes
- Total day: sum of drive_minutes + work_minutes + setup/cleanup ≤ 7h

Add a 10–20% buffer to all drive_minutes to cover parking + getting tools out — solver-time, not API-time.

## Mobilisation + return-to-base

The Builder's `home_postcode` (Module 03) is both origin and destination of every day. Distance Matrix calls always include:
- (home → first stop): mobilisation
- (last stop → home): return-to-base

Both count toward `total_travel_minutes` and the day's overall window.

## Consequences

Positive:
- Solver decisions reflect real roads + real traffic
- Visualisation is brand-coloured (no Google UI chrome via Static API style params)
- Cache keeps API costs trivial (~£0.005 per pack at our volume)
- Haversine fallback means dev/test runs without an API key

Negative / accepted:
- Two Google products to maintain (Static + Distance Matrix)
- Cache-invalidation strategy needed if Google traffic patterns shift (24h TTL is the safety)
- Costs scale with pack volume — modelled at ~£15/month at 1000 packs/month

## Cross-references
- Module 03 (unit bench) — `home_postcode` field
- Module 06 (day-pack solver) — primary consumer of Distance Matrix
- Module 05 (routing engine) — proximity scoring uses cached matrix
- ADR-005 (real-time vs pricing-time) — travel adds to `real_work_minutes` total
