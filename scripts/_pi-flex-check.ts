import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { inArray } from 'drizzle-orm';

const slugs = ['ymiabrm9','mwrly4mq','dk50lsrz','091cuqlc','xsbc3ynk','vc0ikyds','xfz2r059','vy3cquby','hnlh21fq','eb6nzh79','zhe17294','r048ep92','rul5gy7d'];
const key = (process.env.STRIPE_SECRET_KEY||'').replace(/^["']|["']$/g,'').trim();
const stripe = new Stripe(key);

async function main() {
  const qs = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
  const bySlug = new Map(qs.map((q:any)=>[q.shortSlug,q]));
  for (const slug of slugs) {
    const q:any = bySlug.get(slug); if(!q){console.log(`${slug}: not found`);continue;}
    const res = await stripe.paymentIntents.search({ query:`metadata['quoteId']:'${q.id}'`, limit:20 });
    const succ = res.data.filter(p=>p.status==='succeeded').sort((a,b)=>b.created-a.created)[0] || res.data[0];
    const m = succ?.metadata || {};
    console.log(`${slug}  ${(q.customerName||'').trim().padEnd(12)} flexBookingWithinDays=${m.flexBookingWithinDays??'—'}  scheduledDate=${m.scheduledDate??'—'}  scheduledSlot=${m.scheduledSlot??'—'}  paymentType=${m.paymentType??'—'}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
