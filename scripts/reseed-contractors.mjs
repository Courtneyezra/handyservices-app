/**
 * Wipe existing contractors and reseed with the real Nottingham/Derby crew + a small dummy pool.
 *
 * Real list (provided by user):
 *   Richard, Ryan, Vinny, Barry, Reece, Rowan, Marlo, Matt, Adam — Nottingham
 *   Ibraheim, AK — Derby
 *
 * Dummy pool: 4 placeholder contractors so the picker has filler entries.
 *
 * Run:  node scripts/reseed-contractors.mjs
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

// Phone normaliser: strip spaces & non-digits then convert leading 0 → +44
function normalisePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('44')) return '+' + digits;
  if (digits.startsWith('0')) return '+44' + digits.slice(1);
  return '+' + digits;
}

const REAL = [
  { firstName: 'Richard',  lastName: 'N',   phone: '07491503468', city: 'Nottingham' },
  { firstName: 'Ryan',     lastName: 'N',   phone: '07354419042', city: 'Nottingham' },
  { firstName: 'Vinny',    lastName: 'N',   phone: '07748981448', city: 'Nottingham' },
  { firstName: 'Barry',    lastName: 'N',   phone: '07511846467', city: 'Nottingham' },
  { firstName: 'Ibraheim', lastName: 'D',   phone: '07543458292', city: 'Derby'      },
  { firstName: 'Reece',    lastName: 'N',   phone: '07986944288', city: 'Nottingham' },
  { firstName: 'Rowan',    lastName: 'N',   phone: '07428374408', city: 'Nottingham' },
  { firstName: 'AK',       lastName: 'D',   phone: '07745987930', city: 'Derby'      },
  { firstName: 'Marlo',    lastName: 'N',   phone: '07831812118', city: 'Nottingham' },
  { firstName: 'Matt',     lastName: 'N',   phone: '07873145601', city: 'Nottingham' },
  { firstName: 'Adam',     lastName: 'N',   phone: '07491469191', city: 'Nottingham' },
];

const DUMMIES = [
  { firstName: 'James',   lastName: 'H', phone: '07700900001', city: 'Nottingham' },
  { firstName: 'Liam',    lastName: 'P', phone: '07700900002', city: 'Nottingham' },
  { firstName: 'Connor',  lastName: 'B', phone: '07700900003', city: 'Derby'      },
  { firstName: 'Daniel',  lastName: 'M', phone: '07700900004', city: 'Loughborough' },
  { firstName: 'Joe',     lastName: 'W', phone: '07700900005', city: 'Nottingham' },
  { firstName: 'Sam',     lastName: 'T', phone: '07700900006', city: 'Derby'      },
];

console.log('Step 1 — find existing contractor profiles + users');
const existingProfiles = await sql`SELECT hp.id AS profile_id, hp.user_id FROM handyman_profiles hp`;
const profileIds = existingProfiles.map((r) => r.profile_id);
const userIds = existingProfiles.map((r) => r.user_id).filter(Boolean);
console.log(`  ${profileIds.length} profiles, ${userIds.length} linked users`);

console.log('Step 2 — clear dependents on handyman_profiles');
if (profileIds.length > 0) {
  await sql`DELETE FROM handyman_skills WHERE handyman_id = ANY(${profileIds})`;
  await sql`DELETE FROM handyman_availability WHERE handyman_id = ANY(${profileIds})`;
  await sql`DELETE FROM contractor_availability_dates WHERE contractor_id = ANY(${profileIds})`;
  await sql`DELETE FROM contractor_booking_requests WHERE contractor_id = ANY(${profileIds}) OR assigned_contractor_id = ANY(${profileIds})`;
  await sql`DELETE FROM contractor_reviews WHERE contractor_id = ANY(${profileIds})`;
  // contractor_jobs / contractor_job_links: keep history null-safe (set FK null if column allows, else delete)
  await sql`DELETE FROM contractor_jobs WHERE contractor_id = ANY(${profileIds})`;
  await sql`DELETE FROM contractor_job_links WHERE contractor_id = ANY(${profileIds})`;
}
console.log('  cleared');

console.log('Step 3 — delete handyman_profiles');
await sql`DELETE FROM handyman_profiles`;

console.log('Step 4 — delete contractor users + sessions');
if (userIds.length > 0) {
  await sql`DELETE FROM contractor_sessions WHERE user_id = ANY(${userIds})`;
}
await sql`DELETE FROM contractor_sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'contractor')`;
await sql`DELETE FROM users WHERE role = 'contractor'`;

console.log('Step 5 — insert fresh contractor users + profiles');

async function insertContractor({ firstName, lastName, phone, city, isDummy }) {
  const userId = randomUUID();
  const profileId = `hp_${randomUUID()}`;
  const phoneNorm = normalisePhone(phone);
  const slug = `${firstName.toLowerCase()}-${lastName.toLowerCase()}-${profileId.slice(-6)}`.replace(/[^a-z0-9-]/g, '');
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${profileId.slice(-6)}@contractor.handyservices.local`;
  const businessName = `${firstName} ${lastName}`.trim();

  await sql`
    INSERT INTO users (id, email, first_name, last_name, phone, role, is_active, created_at, updated_at)
    VALUES (${userId}, ${email}, ${firstName}, ${lastName}, ${phoneNorm}, 'contractor', true, NOW(), NOW())
  `;

  await sql`
    INSERT INTO handyman_profiles (
      id, user_id, business_name, city, postcode, radius_miles,
      whatsapp_number, slug, public_profile_enabled,
      verification_status, availability_status,
      subscription_tier, partner_status,
      created_at, updated_at
    ) VALUES (
      ${profileId}, ${userId}, ${businessName}, ${city}, NULL, 15,
      ${phoneNorm}, ${slug}, false,
      ${isDummy ? 'unverified' : 'verified'}, 'available',
      'free', 'not_started',
      NOW(), NOW()
    )
  `;
  return { profileId, userId, businessName, phone: phoneNorm, city, isDummy };
}

const inserted = [];
for (const c of REAL) inserted.push(await insertContractor({ ...c, isDummy: false }));
for (const c of DUMMIES) inserted.push(await insertContractor({ ...c, isDummy: true }));

console.log(`\n✓ Inserted ${inserted.length} contractors:`);
for (const r of inserted) {
  console.log(`  ${r.isDummy ? '[dummy]' : '[real ]'}  ${r.businessName.padEnd(20)}  ${r.city.padEnd(14)}  ${r.phone}`);
}

console.log('\nFinal verification:');
const final = await sql`
  SELECT hp.business_name, hp.city, hp.verification_status, u.phone
  FROM handyman_profiles hp LEFT JOIN users u ON u.id = hp.user_id
  ORDER BY hp.verification_status DESC, hp.business_name
`;
console.table(final);
