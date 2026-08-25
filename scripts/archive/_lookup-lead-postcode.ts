import 'dotenv/config';
import { db } from '../server/db';
import { leads, conversations } from '../shared/schema';
import { like, desc } from 'drizzle-orm';

// READ-ONLY. Look up a lead by phone and show what location data (if any) was
// actually persisted. Matches on the significant digits so it catches
// 07384291225 / +447384291225 / 447384291225 formatting variants.
const SUFFIX = process.argv[2] || '7384291225';

const rows = await db
  .select()
  .from(leads)
  .where(like(leads.phone, `%${SUFFIX}%`))
  .orderBy(desc(leads.createdAt));

console.log(`\n=== leads matching %${SUFFIX}% : ${rows.length} found ===`);
for (const l of rows) {
  console.log('-------------------------------------------');
  console.log('id            :', l.id);
  console.log('createdAt     :', l.createdAt);
  console.log('customerName  :', l.customerName);
  console.log('phone         :', l.phone);
  console.log('source        :', l.source);
  console.log('status        :', l.status);
  console.log('postcode      :', JSON.stringify(l.postcode));
  console.log('address       :', JSON.stringify(l.address));
  console.log('addressRaw    :', JSON.stringify(l.addressRaw));
  console.log('addressCanon. :', JSON.stringify(l.addressCanonical));
  console.log('placeId       :', JSON.stringify(l.placeId));
  console.log('coordinates   :', JSON.stringify(l.coordinates));
  console.log('jobDescription:', l.jobDescription);
  console.log('transcriptJson:', JSON.stringify(l.transcriptJson));

  // Did a conversation get created for this phone? Its metadata may hold context.
  const convs = await db
    .select()
    .from(conversations)
    .where(like(conversations.phoneNumber, `%${SUFFIX}%`));
  console.log(`conversations : ${convs.length} found`);
  for (const c of convs) {
    console.log('   conv.id        :', c.id);
    console.log('   conv.metadata  :', JSON.stringify(c.metadata));
    console.log('   lastMsgPreview :', c.lastMessagePreview);
  }
}

process.exit(0);
