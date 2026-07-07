import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const liveKey = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const testKey = env.match(/^STRIPE_TEST_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');

const piId = process.argv[2] || 'pi_3TRDPz4p9GekG4mY1y5qEw6V';

async function probe(name, key) {
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await r.json();
  console.log(`${name}: ${r.status} ${body.error?.code || body.status || 'ok'} | livemode=${body.livemode}`);
}
await probe('LIVE  secret', liveKey);
await probe('TEST  secret', testKey);
