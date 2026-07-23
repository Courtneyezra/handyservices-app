# Ben — Earnings Report, June 2026

**Status:** Final (complete month)
**Generated:** 2026-07-10

## Pay model

| Component | Basis |
|---|---|
| **Retainer** | £600 / month, fixed |
| **Commission** | 10% of **labour** per **accepted** quote |
| Labour | quote revenue − materials (with markup) |
| "Accepted" | deposit paid (`selectedAt`) dated within the month, regardless of when the quote was sent |

## Summary

| | Amount |
|---|---|
| Quotes sent (June) | 76 |
| **Quotes accepted online (June)** | **26** (9 later booked) |
| Offline-accepted (June) | 1 — see below |
| Total revenue (accepted) | £6,771.00 |
| Materials (with markup) | £921.00 |
| **Labour base** | **£5,850.00** |
| Commission @ 10% | £585.00 |
| Retainer | £600.00 |
| **TOTAL DUE — JUNE** | **£1,185.00** |

### Offline acceptances (June)

Quotes accepted offline (no online deposit, so no `selectedAt` — added manually):

| Slug | Customer | Accepted | Revenue | Materials | Labour | Commission |
|---|---|---|--:|--:|--:|--:|
| 7x9y56z8 | Olivia | 2026-06-24 | £730.00 | £160.00 | £570.00 | £57.00 |

Three further offline acceptances by Ben were credited to **other** pay periods (accepted-month basis):
`ofqxglfz` (Olivia Wynn, £40.50) → **May**; `23mi2kmb` (Lewis, £16.00) → **May**; `9c6fp1mh` (Lewis, £11.20) → **July**.

## Accepted quotes (commission detail)

| Date accepted | Customer | Revenue | Materials | Labour | Commission (10%) | Booked |
|---|---|--:|--:|--:|--:|:-:|
| 2026-06-01 | Lee | £163.00 | £19.00 | £144.00 | £14.40 | |
| 2026-06-01 | Alison | £114.00 | £0.00 | £114.00 | £11.40 | ✓ |
| 2026-06-01 | Gavin | £75.00 | £0.00 | £75.00 | £7.50 | |
| 2026-06-01 | Dave | £195.00 | £19.00 | £176.00 | £17.60 | |
| 2026-06-05 | Helen | £106.00 | £0.00 | £106.00 | £10.60 | |
| 2026-06-05 | Lewis | £91.00 | £0.00 | £91.00 | £9.10 | |
| 2026-06-06 | Christopher | £80.00 | £0.00 | £80.00 | £8.00 | |
| 2026-06-08 | JWong | £91.00 | £0.00 | £91.00 | £9.10 | |
| 2026-06-08 | Shaun | £336.00 | £64.00 | £272.00 | £27.20 | ✓ |
| 2026-06-09 | Jaymie | £480.00 | £0.00 | £480.00 | £48.00 | |
| 2026-06-15 | Tara | £198.00 | £32.00 | £166.00 | £16.60 | |
| 2026-06-15 | Rebecca | £385.00 | £0.00 | £385.00 | £38.50 | ✓ |
| 2026-06-16 | Nicola | £784.00 | £127.00 | £657.00 | £65.70 | |
| 2026-06-17 | Tam | £368.00 | £0.00 | £368.00 | £36.80 | |
| 2026-06-17 | Michael | £380.00 | £100.00 | £280.00 | £28.00 | |
| 2026-06-19 | Carrie | £184.00 | £0.00 | £184.00 | £18.40 | ✓ |
| 2026-06-20 | Hafsah | £55.00 | £0.00 | £55.00 | £5.50 | |
| 2026-06-22 | V | £87.00 | £32.00 | £55.00 | £5.50 | |
| 2026-06-22 | Andy | £581.00 | £229.00 | £352.00 | £35.20 | ✓ |
| 2026-06-25 | Meen | £90.00 | £0.00 | £90.00 | £9.00 | ✓ |
| 2026-06-25 | Tim | £109.00 | £13.00 | £96.00 | £9.60 | ✓ |
| 2026-06-25 | Steph | £592.00 | £82.00 | £510.00 | £51.00 | |
| 2026-06-26 | Maaria | £84.00 | £19.00 | £65.00 | £6.50 | ✓ |
| 2026-06-27 | Richie Heath | £65.00 | £0.00 | £65.00 | £6.50 | ✓ |
| 2026-06-29 | Darian | £199.00 | £25.00 | £174.00 | £17.40 | |
| 2026-06-29 | Saira Imran | £149.00 | £0.00 | £149.00 | £14.90 | |
| **Totals** | **26** | **£6,041.00** | **£761.00** | **£5,280.00** | **£528.00** | **9** |

## Notes & caveats

- **Accepted (26) vs booked (9):** commission is earned on *acceptance* (deposit paid), per the pay model. Only 9 of the 26 were subsequently booked/scheduled. If the intent is to pay on *booking* rather than *acceptance*, the commission base changes materially — flag if so.
- **Accrual basis:** a quote sent in May but accepted in June counts here; a quote sent in June but accepted in July counts in July, not here. This matches "commission per accepted quote."
- **Materials with markup:** taken from each quote's line items (`materialsWithMarginPence`), falling back to the quote-level `materialsCostWithMarkupPence`. Labour = revenue − that figure, so commission is on Ben's value-add, not pass-through materials.
- **Test/dummy quotes excluded:** synthetic quotes (test phone patterns, @example.com, Test/QA/Phase/Sample names) are scrubbed before totalling.
- **Source of truth:** `personalized_quotes` where `createdBy = Ben`. Reproduce via `scripts/_ben-earnings-month.ts 2026-06`.
