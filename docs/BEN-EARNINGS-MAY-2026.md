# Ben — Earnings Report, May 2026

**Status:** Final (complete month)
**Generated:** 2026-07-10

## Pay model

Retainer £600/month + commission of 10% of **labour** (revenue − materials-with-markup) per **accepted** quote (deposit paid / `selectedAt` in-month, plus offline acceptances credited by acceptance month).

## Summary

| | Amount |
|---|---|
| Quotes sent (May) | 70 |
| **Quotes accepted online (May)** | **24** (5 later booked) |
| Offline-accepted (May) | 2 — see below |
| Total revenue (accepted) | £8,129.00 |
| Materials (with markup) | £2,644.00 |
| **Labour base** | **£5,485.00** |
| Commission @ 10% | £548.50 |
| Retainer | £600.00 |
| **TOTAL DUE — MAY** | **£1,148.50** |

## Accepted quotes — online (commission detail)

| Date accepted | Customer | Revenue | Materials | Labour | Commission | Booked |
|---|---|--:|--:|--:|--:|:-:|
| 2026-05-01 | Joe | £763.00 | £267.00 | £496.00 | £49.60 | |
| 2026-05-03 | Matthew | £120.00 | £0.00 | £120.00 | £12.00 | |
| 2026-05-07 | Mario | £143.00 | £13.00 | £130.00 | £13.00 | |
| 2026-05-07 | AJ | £534.00 | £254.00 | £280.00 | £28.00 | |
| 2026-05-07 | Rob | £195.00 | £6.00 | £189.00 | £18.90 | |
| 2026-05-07 | Fiona | £145.00 | £0.00 | £145.00 | £14.50 | |
| 2026-05-08 | Karan | £290.00 | £76.00 | £214.00 | £21.40 | |
| 2026-05-08 | Tony | £251.00 | £13.00 | £238.00 | £23.80 | |
| 2026-05-12 | James | £214.00 | £58.00 | £156.00 | £15.60 | |
| 2026-05-12 | Kate | £151.00 | £13.00 | £138.00 | £13.80 | |
| 2026-05-13 | Andrew | £75.00 | £0.00 | £75.00 | £7.50 | |
| 2026-05-14 | Emma | £266.00 | £0.00 | £266.00 | £26.60 | |
| 2026-05-15 | Michael | £120.00 | £0.00 | £120.00 | £12.00 | |
| 2026-05-15 | Sarah | £1,584.00 | £1,016.00 | £568.00 | £56.80 | |
| 2026-05-15 | Meen | £147.00 | £0.00 | £147.00 | £14.70 | |
| 2026-05-16 | Victoria | £218.00 | £25.00 | £193.00 | £19.30 | |
| 2026-05-19 | Suman | £284.00 | £44.00 | £240.00 | £24.00 | |
| 2026-05-20 | Edward | £940.00 | £572.00 | £368.00 | £36.80 | ✓ |
| 2026-05-20 | Tracey | £113.00 | £0.00 | £113.00 | £11.30 | |
| 2026-05-25 | Tim | £203.00 | £38.00 | £165.00 | £16.50 | |
| 2026-05-26 | Stuart | £90.00 | £0.00 | £90.00 | £9.00 | ✓ |
| 2026-05-26 | Erika | £249.00 | £0.00 | £249.00 | £24.90 | ✓ |
| 2026-05-27 | Linda | £167.00 | £32.00 | £135.00 | £13.50 | ✓ |
| 2026-05-28 | Meen | £105.00 | £20.00 | £85.00 | £8.50 | ✓ |
| **Subtotal** | **24** | **£7,367.00** | **£2,447.00** | **£4,920.00** | **£492.00** | **5** |

## Offline acceptances (May)

Accepted offline (no online deposit, credited by acceptance month):

| Slug | Customer | Accepted | Revenue | Materials | Labour | Commission |
|---|---|---|--:|--:|--:|--:|
| ofqxglfz | Olivia Wynn | 2026-05-12 | £526.00 | £121.00 | £405.00 | £40.50 |
| 23mi2kmb | Lewis | 2026-05-21 | £236.00 | £76.00 | £160.00 | £16.00 |
| **Subtotal** | | | £762.00 | £197.00 | £565.00 | £56.50 |

## Notes

- Test/dummy quotes excluded. Reproduce online figures via `scripts/_ben-earnings-month.ts 2026-05` (detail: `scripts/_ben-detail-month.ts 2026-05`).
- Offline slugs `ofqxglfz` / `23mi2kmb` had no `selectedAt`; commission credited to May by the user (accepted-offline). Not written back to the quote records (would pollute conversion analytics).
