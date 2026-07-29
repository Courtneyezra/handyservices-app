# City Expansion Scan — where to break in next (Jul 2026)

GBP-first local-competition scan across delivery-feasible Midlands towns.
Sources (Apify, 29 Jul 2026): `johnvc/google-maps-places-api` (map-pack incumbents +
review counts, "handyman {town}", 20/town) + `aitorsm/keyword-volume` (demand, geo=gb).
Signal for "easy to break in" = **weak top-3 map-pack review counts** (proxy for how
beatable the incumbents' GBPs are) × real demand × deliverability from Nottingham/Derby.
Noise filtered (US franchises, non-handyman firms).

## Tier 1 — break in first (real demand × weak incumbents)
| Town | Demand /mo | Top-3 incumbents (reviews) | Keyword comp | ~Distance | Verdict |
|---|---|---|---|---|---|
| **Chesterfield** | 210 | 19 · 7 · 44 (weak) | Med | 25mi (Derby) | Best all-round; soft top of pack |
| **Grantham** | 140 | only 2 GBPs (45 · 3) | **LOW** (idx 26) | 30mi | Land-grab; near-empty market |
| **Lincoln** | 170 | 12 · 2 · 15 (weak local) | Med | 40mi | Good demand, weak locals; deliverability is the question |

## Tier 2 — doorstep fill-ins (trivial delivery, weak comp, smaller demand)
| Town | Demand | Top incumbents | ~Distance |
|---|---|---|---|
| Long Eaton | 50 | 8 · 11 · 12 (weak) | between Notts & Derby |
| Ilkeston | 40 | only 4 GBPs (top 85) | adjacent to Derby |
| Sutton-in-Ashfield | 50 | 3 · 7 · 18 (weak) | near Mansfield |
| Mansfield | 140 | 86 · 129 (moderate) | 15mi N of Notts |

## Tier 3 — the prize, later
| Town | Demand | Incumbents | Note |
|---|---|---|---|
| Leicester | 590 (biggest) | 73 · 109 · 231 (deeper) | Go with GBP muscle + capacity |

**Skip for now:** Newark (dominant incumbent 186 reviews vs 90 demand); Loughborough / Burton / Worksop middling.

## Reads
- **Grantham** is the clearest easy win: the only LOW-competition keyword *and* a near-empty map pack (2 profiles, top 45 reviews).
- **Chesterfield** is the best winnable-and-worth-it, and genuinely serviceable from Derby.
- Demand shown is only "handyman {town}"; the full trade portfolio (fencing, plasterer, gutters…) ≈ 10× that (as seen in Nottingham/Derby).
- Review-count is a proxy — proximity + relevance also drive map rank — but weak top-3 counts are the best quick tell.

## Recommended sequence (GBP-first)
1. Stand up **Chesterfield + Grantham Google Business Profiles**; start collecting real reviews / NAP consistency.
2. Seed their SEO spine pages **unpublished** (rendered, noindex, off-sitemap) — done in code, gated `pagePublished=false`.
3. Flip `pagePublished` per city once the GBP exists + a crew can service it (RANK ≠ FULFIL).
