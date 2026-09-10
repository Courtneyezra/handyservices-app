---
name: apple-pay-domain
description: Use when Apple Pay fails to appear or verify on a domain, when registering a new payment method domain with Stripe, or before touching the /.well-known route in server/index.ts or the files under client/public/.well-known/.
---

# Apple Pay domain verification

## The file is served by this app

`/.well-known/apple-developer-merchantid-domain-association` is served by an explicit
Express route in `server/index.ts`, from the file at `client/public/.well-known/`.

Do not remove the route or the file. A previously documented Cloudflare-served copy was
found not to exist: the path fell through to the SPA catch-all and returned `index.html`,
which silently broke Apple Pay verification on www.handyservices.app. Cloudflare proxies
the path straight through, so the Express route is authoritative.

The route resolves the built copy under `dist/public/.well-known/` first and falls back to
the source copy, so it works in dev and in production.

## Registering a new domain

Stripe Dashboard → Settings → Payment method domains → Add domain.

Or by API with the secret key: `POST /v1/payment_method_domains`, then `/validate`.

Stripe's association file is universal — the same for every Stripe merchant — and
downloads from
https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association

## Checking it

Fetch the path on the live domain and confirm the response is the association file and not
HTML. An `index.html` body is the failure mode described above.
