# Instrumentation Plan (Task 13)
_Close the gaps that forced this audit to be reconstructed by hand. The read-only dashboard
(`13-dashboard.ts`) is done; the items below are production changes that need a reviewed PR
(not auto-applied) because they touch logging/schema/secrets._

## 1. Restore WhatsApp inbound logging  ⚠️ highest value
- **Gap:** the `messages` table has recorded **0 inbound since May** (only the dunning bot writes outbound). Real two-way chats live only on the WhatsApp account, so conversation dynamics (time-to-quote, follow-up, post-link silence) needed a manual export.
- **Fix:** persist inbound WhatsApp Web.js messages to `messages` again; verify the listener is attached and not filtered out. Add a daily count alert (`inbound today == 0` → notify).
- **Payoff:** Stage-2 metrics become live instead of forensic.

## 2. Populate `delivery_channel` on quotes
- **Gap:** `personalized_quotes.delivery_channel` (whatsapp|sms|email) is **null for all Apr+ rows**, so we can't cleanly compare conversion by delivery channel (had to proxy via WhatsApp-export phone match).
- **Fix:** set it when the quote link is sent. Backfill where derivable.

## 3. PostHog read access for the quote-page funnel  ⚠️ confirms the big-job hypothesis
- **Gap:** only `VITE_POSTHOG_API_KEY` (client ingest) is available; can't query events. The `cq_*` events (`client/src/lib/quote-analytics.ts`) already capture scroll/section/price-reveal/checkout steps.
- **Fix:** add a PostHog **personal/read API key** to env, then query the quote-page funnel **for big jobs**: viewed → scrolled-to-price → reached-checkout → paid, split pre/post Apr 22. This is the one test that turns the line-item-UI conclusion from *strong-circumstantial* into *proven*.

## 4. Live conversion dashboard  ✓ (done, read-only)
- `13-dashboard.ts` prints the monthly funnel + big/small + lead→quote + current-version cohort.
- **Optional next:** schedule it (cron/RemoteTrigger) to post a weekly snapshot, or wire the same queries into an admin page. Headline metric to watch: **big-job (£300+) conversion** (target back to ~36%).

## 5. Scrub the dummy batch
- 51 rows still match the dummy filter (the `+449900` test-matrix batch). Hard-delete after a final eyeball (per the user's clean-table preference).

---
**Recommended build order:** #3 (confirm the cause) → #1 (stop flying blind on chats) → #2 → #4 schedule → #5.
Each is a small, self-contained PR. None were applied automatically — they await go-ahead.
