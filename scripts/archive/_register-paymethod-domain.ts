import Stripe from 'stripe';
import 'dotenv/config';

// Register + validate www.handyservices.app as a Stripe payment method domain
// (gates Apple Pay & Google Pay). Usage:
//   npx tsx scripts/_register-paymethod-domain.ts            → create/list + status
//   npx tsx scripts/_register-paymethod-domain.ts validate   → re-validate (run AFTER
//     the association file is live at /.well-known/… on the domain)
const DOMAIN = 'www.handyservices.app';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('STRIPE_SECRET_KEY missing'); process.exit(1); }
  const stripe = new Stripe(key);

  const existing = await stripe.paymentMethodDomains.list({ domain_name: DOMAIN, limit: 3 });
  let dom = existing.data[0];
  if (!dom) {
    dom = await stripe.paymentMethodDomains.create({ domain_name: DOMAIN });
    console.log('created domain registration:', dom.id);
  } else {
    console.log('domain already registered:', dom.id);
  }

  if (process.argv[2] === 'validate') {
    dom = await stripe.paymentMethodDomains.validate(dom.id);
    console.log('validation run.');
  }

  console.log(JSON.stringify({
    id: dom.id,
    domain: dom.domain_name,
    enabled: dom.enabled,
    apple_pay: dom.apple_pay?.status,
    apple_pay_error: (dom.apple_pay as any)?.status_details?.error_message ?? null,
    google_pay: dom.google_pay?.status,
    link: dom.link?.status,
  }, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
