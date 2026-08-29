# Automated GMB Posting System

Writes a brand-voice post to the Google Business Profile on a schedule.
Built 13 Aug 2026.

## How it works

```
cron (Mon/Wed/Fri 10:05, override via GMB_POST_CRON)
  └─ runGmbPostCycle()                server/gmb-posts/index.ts
       ├─ pickTheme()                 least-recently-used theme + detail, from gmb_posts history
       ├─ generatePostBody()          server/gmb-posts/generator.ts
       │    └─ loads brand-voice/*.md fresh every run (edit = live, no deploy)
       │       model: claude-opus-5 via server/llm.ts
       ├─ createLocalPost()           server/gmb-posts/gbp-client.ts → My Business v4 localPosts
       │    └─ media failure ⇒ one retry without the photo
       └─ gmb_posts row               draft → posted | failed (audit + rotation history)
```

- **Voice**: `brand-voice/{beliefs,tone,vocabulary,humour}.md` — see `brand-voice/README.md`.
- **Themes**: `server/gmb-posts/themes.ts` — service_spotlight (9 services, each with a
  matching quote-library image), seasonal_tip, proof_point, faq_buster,
  landlord_corner, local_area. Add a theme = add an entry.
- **Preview**: `npx tsx scripts/_gmb-post-preview.ts [theme]` — dry run, no Google, no DB.
- **Table**: `gmb_posts` (created via `scripts/_create-gmb-posts-table.ts` — never db:push).

## Credentials — the gotcha

Posting uses the **same `GOOGLE_GBP_*` OAuth credential set as the SEO metrics
pull** (`server/seo-gmb-connector.ts` header documents the setup): CLIENT_ID,
CLIENT_SECRET, REFRESH_TOKEN (scope `business.manage`), and
`GOOGLE_GBP_LOCATIONS` (JSON of `key → accounts/{a}/locations/{l}`).

A plain Google **API key does not work** for posts — the localPosts endpoint
only accepts OAuth, and the GCP project needs approved Business Profile API
access. The cron self-activates once the env vars are present (identical
gating to the metrics pull); until then it logs "NOT scheduled" and does
nothing.

### Setup path (run these yourself — secrets stay in your terminal)

1. In Google Cloud Console: request Business Profile API access if not yet
   approved (form at developers.google.com/my-business/content/prereqs —
   default quota is zero), enable the three My Business APIs, create a
   **Desktop app** OAuth client.
2. `npx tsx scripts/_gbp-oauth-setup.ts <client_id> <client_secret>` — opens
   the consent screen, captures the refresh token, auto-discovers locations,
   prints the four env lines for `.env` + the production host.
3. `npx tsx scripts/_gbp-verify.ts` — proves auth + location access without
   posting.
4. `npx tsx scripts/_gmb-post-once.ts` — one real post, on demand.

## Known risks / next steps

- Post images come from `client/public/assets/quote-images/*.webp` via public
  URL. Google may reject WebP — the cycle already falls back to text-only, but
  converting the post set to JPG is the clean fix if rejections show up.
- No review-spotlight theme yet: the repo has no established review-ask voice,
  and quoting real reviews needs a Places/GBP reviews fetch.
- Voice files are v1, mined from repo copy only — refine with real WhatsApp/IG
  material dropped in `brand-voice/sources/`.
