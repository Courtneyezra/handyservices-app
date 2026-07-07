import 'dotenv/config';
import Stripe from 'stripe';
const key = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = new Stripe(key);
const gbp = (p?: number | null) => p == null ? '—' : '£' + (p / 100).toFixed(2);
async function main() {
  const pi = await stripe.paymentIntents.retrieve('pi_3TkNPo4p9GekG4mY0mE2l4se', { expand: ['latest_charge'] });
  console.log('PI status        ', pi.status);
  console.log('amount           ', gbp(pi.amount), '(', pi.currency, ')');
  console.log('amount_received  ', gbp(pi.amount_received));
  console.log('created          ', new Date(pi.created * 1000).toISOString());
  console.log('--- metadata ---');
  for (const [k, v] of Object.entries(pi.metadata || {})) console.log('  ', k, '=', v);
  const ch: any = pi.latest_charge;
  if (ch && typeof ch === 'object') {
    console.log('--- charge ---');
    console.log('  amount       ', gbp(ch.amount), ' captured=', ch.captured, ' refunded=', ch.refunded, ' amount_refunded=', gbp(ch.amount_refunded));
    console.log('  description  ', ch.description);
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
