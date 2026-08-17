# WhatsApp Coexistence (Route 2) — PAUSED 16 Aug 2026

Everything needed to resume putting **+447508744402** on the Cloud API while it keeps running in the
WhatsApp Business app on a handset. Paused in favour of Route 1; the code is built and deployed, so
resuming is configuration plus one onboarding run.

**Why paused:** Meta lists voice/video calls as *"Not supported"* on Cloud API for coexistence
numbers. Calls to a coexistence number ring the Business app and produce no webhook, no recording
and no transcript — which fails all four stated purposes for call data (quoting accuracy, dispute
evidence, coaching, CRM/AI). Route 1 already delivers those.

**Resume if:** a physical handset for replying becomes a hard requirement, and losing call capture
on that number is acceptable.

---

## Current state

| Thing | Value |
|---|---|
| Target number | `+447508744402` — real company SIM, WhatsApp Business app, on a handset |
| Meta app | `3211240455721990` ("LastTime"), **Development mode** |
| App Review | **Submitted** — needs Advanced Access for `whatsapp_business_messaging` + `whatsapp_business_management` |
| Business portfolio | Handyman Nottingham `150270466214452` — verified |
| Twilio WABA (Route 1) | `1538004761222206` — "Handy Services LTD", holds `+447449501762` |
| Test WABA | `101467983009024` — holds test number `+1 555 091 4717` (`105557289261699`) |
| ES login config | `1378706431130010` (stored in `app_settings.whatsapp_es_config_id`, overrides env) |
| Onboarding page | `/admin/whatsapp-onboard` |

## What is already built and deployed

- `server/whatsapp-onboarding.ts` — Embedded Signup config, code exchange, asset resolution,
  wrong-number guard, `DELETE /onboard/sender` reset, `/onboard/diagnose`
- `client/src/pages/admin/WhatsAppOnboardPage.tsx` — launcher, redirect + popup flows, stall
  detection, wrong-number banner
- `server/meta-whatsapp.ts` — `sendViaMetaCloudApi()` and `sendWhatsAppMessage(..., { via: 'meta' })`
- `scripts/_wa-transport-verify.ts` — verifies transport routing without sending

**Plugging in a coexistence number is config, not code.** Once onboarded, `getCoexistenceSender()`
returns it and `via: 'meta'` routes there.

## Resume steps

1. **Confirm App Review approved** — `devtools_app_review` action `privileges` on app
   `3211240455721990`. Needs non-empty privileges. While `privileges: []`, onboarding fails with
   *"Partner app lacks required advanced WhatsApp Business management and messaging permissions"*.
2. Go to `/admin/whatsapp-onboard` **on the handset** and Launch.
3. At the **phone number screen**, enter `+447508744402`. Do **not** accept a `+1 555…` test number —
   the guard rejects it, but it wastes a run.
4. On the handset: **Connect to the Business Platform** → decide on chat history → paste the code.
5. Send the printed `phoneNumberId` result; the platform picks it up automatically.

## Hard-won gotchas

- **`featureType` must be `whatsapp_business_app_onboarding`.** The older value `coexistence` is
  rejected.
- **Direction is app → Cloud API only.** A number already API-only can never become coexistence.
  This is why `+447449501762` can never do it: Twilio-owned, no SIM.
- **`Login with the JavaScript SDK` must be ON** in Facebook Login for Business settings. With it
  off, `FB.login()` accepts the call and silently does nothing — no popup, no callback, no error.
- **Valid OAuth Redirect URIs** must contain `https://www.handyservices.app/admin/whatsapp-onboard`.
- **Allowed Domains for the JavaScript SDK** must contain `www.handyservices.app` — `www` and the
  apex count separately.
- **Redirect-flow code exchange must echo `redirect_uri`.** The popup flow must not. Sending the
  wrong one fails with an opaque error.
- **App must be in Development mode** for Standard Access to apply to role-holders — but note this
  alone is NOT enough for coexistence, which needs Advanced Access regardless.
- Login configuration needs **login variation General**, **system-user access token**, and
  permissions `whatsapp_business_management` + `whatsapp_business_messaging`. Don't attach Pages,
  Ad accounts, Catalogs, Pixels or Instagram — each adds a grant the flow demands.

## What coexistence costs

From Meta's feature comparison, on the onboarded number:

- **Voice and video calls — not supported on Cloud API.** They ring the Business app only.
- Group chats not synced
- Disappearing messages, view-once and live location **disabled** on all 1:1 chats
- Broadcast lists become **read-only**
- Business tools (catalog, orders, status), messaging tools (greeting/away messages, quick replies,
  labels) and business profile are **not** available via Cloud API
- All **linked devices unlinked** on onboarding; WhatsApp for Windows and WearOS unsupported
- Throughput fixed at **20 mps**
- Only the last **6 months** of history syncs
- Changing device or reinstalling WhatsApp **auto-offboards** the Cloud API companion. Subscribe to
  `account_update` and pause sends on `ACCOUNT_OFFBOARDED`; `ACCOUNT_RECONNECTED` follows within
  minutes.
- Messages sent from the Business app are **free** and do not open, extend or affect the Cloud API
  24-hour window or its pricing.

## Webhooks to subscribe before resuming

Beyond the usual fields:

- `history` — past messages, if chat history sharing is approved
- `smb_app_state_sync` — contacts
- `smb_message_echoes` — messages Ben sends **from the handset**, mirrored into the CRM.
  This is the main prize of coexistence.
- `account_update` — offboard/reconnect events

## Sync has a 24-hour deadline

After onboarding you have **24 hours** to call the SMB App Data API for contacts and message
history, or the number must be offboarded and the whole flow repeated. Each sync can be run
**once**.

## References

- Coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- Reconnecting offboarded clients: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients
- App Review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review/
- Embedded Signup v2 is **deprecated 15 Oct 2026** — migrate to v4 before resuming if that date has passed.
