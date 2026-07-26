# SEO Hero Image Spec (locked 26 Jul 2026)

Rebuild all 23 SEO trade hero images to a single, real-team, photographic standard.
Current set is rejected: soft/incorrect logo, plasticky AI look, generic (not our team).

**Blocked on:** Higgsfield connector re-auth (do it in claude.ai connector settings
or `/mcp`). Everything below is prepped so generation is a clean batch once connected.

## Where they live / how they're cropped
- Files: `client/public/assets/seo-heroes/{trade}.webp` (overwrite in place — no code change).
- Rendered by `heroSection()` as `.hero-img`: desktop card ≈ **4:3**, mobile banner **16:9**
  capped 230px, `object-fit:cover`. → **Generate 16:9 landscape; keep the subject + chest
  logo within the centre 4:3 safe zone** so neither crop cuts them.

## Locked visual spec (every image)
1. **Real team member** — a recognisable face from the roster (`client/src/lib/contractor-roster.ts`):
   Craig, Joe, Emile, Courtnee, Neil, Bezent. Use each person's real photo as a Higgsfield
   **reference element** so faces match the landing avatars. NOT generic AI people.
2. **Workwear** — plain solid **NAVY BLUE** polo (explicitly "NOT royal blue" in prompt),
   with the **hand logo as a crisp EMBROIDERED badge on the upper LEFT breast** — added via
   the image-to-image pass (never prompt a text logo; it garbles).
3. **Setting** — consistent UK residential: **red-brick British home**, natural **overcast
   daylight**, realistic/gritty (drop cloths, tools, a bit of mess). Same grade across all 23.
4. **Realism** — "candid documentary photo, realistic imperfections, subtle film grain, NOT
   over-polished, no plastic skin". Model **nano_banana_2** (elements don't work with soul_2).
5. **Composition** — landscape, subject mid-frame doing the trade action, torso turned slightly
   to camera so the left chest (logo) is visible; nothing important at the extreme edges.
6. **Exclusions** — "no text, no letters, no watermark, no extra logos".
7. **Output** — ~2752×1536, export **WebP** (~150–400KB) to `seo-heroes/{trade}.webp`.

## Two-pass pipeline (per image) — the proven method
1. **Scene pass:** `generate_image`, model `nano_banana_2`, with the person's reference element
   `<<<element_id>>>` + the scene prompt (navy polo, trade action, UK setting, realism cues,
   **clean chest — no logo yet**).
2. **Logo pass (image-to-image):** `generate_image` `nano_banana_2`, `medias=[{value:<scene job_id>,
   role:image},{value:<logo media_id>, role:image}]`, prompt: *"Add the circular hand logo from the
   second image as a small embroidered badge on the upper LEFT chest of the polo, following the
   fabric folds and lighting; keep everything else identical."*
3. Download → convert to WebP → overwrite `seo-heroes/{trade}.webp`.

## First steps when Higgsfield reconnects (IDs from memory may be stale)
- `show_reference_elements` — reuse or recreate person elements. If missing, create one per team
  member from their avatar/portrait (`/assets/avatars/*.webp`, `/assets/quote-images/*-banner.webp`).
- `show_medias` — get the current **logo media_id** (or re-upload `client/public/logo.png`).
- Higgsfield plus plan = 8 concurrent jobs → run in waves of 8.

## Per-trade assignment (member + scene) — 23 images
| Trade | Team member | Scene |
|---|---|---|
| handyman | Craig | mounting a shelf / TV bracket indoors, drill in hand |
| painter-decorator | Emile | cutting-in a wall edge with a brush, dust sheets down |
| gutter-cleaning | Neil | ground-based vacuum pole up to the gutter (keep current framing) |
| fencing | Craig | setting a fence post, spirit level on the panel (current is good) |
| plasterer | Emile | skimming a wall with a trowel, fresh plaster |
| kitchen-fitting | Joe | fitting a kitchen cabinet / worktop |
| carpenter | Joe | cutting/fixing timber, tape measure + saw |
| tiler | Emile | tiling a wall, spacer + adhesive |
| bathroom-fitting | Courtnee | fitting a basin/shower, pipe work |
| landscaping | Neil | laying turf / edging a border |
| pressure-washing | Neil | jet-washing a driveway, spray fan |
| decking | Craig | screwing down deck boards |
| fitted-wardrobes | Joe | fitting a sliding wardrobe / shelving |
| flooring | Joe | laying LVT / laminate flooring |
| artificial-grass | Neil | rolling out artificial grass on a prepared base |
| garage-door | Craig | adjusting/installing a garage door |
| roof-cleaning | Neil | soft-washing / scraping moss off a roof (safe, low pitch) |
| loft-boarding | Joe | laying loft boards over joists |
| ev-charger | Courtnee | mounting an EV charger on an exterior wall |
| roofer | Bezent | replacing a roof tile (low pitch, safe) |
| locksmith | Bezent | fitting a door lock / cylinder on a front door |
| plumber | Courtnee | fixing under-sink pipework / a valve |
| electrician | Courtnee | wiring a socket / consumer unit (cover off) |

Members rotate for variety but each keeps a consistent identity; setting + grade stay uniform.
