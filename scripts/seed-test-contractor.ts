
import 'dotenv/config';
import { db } from '../server/db';
import {
  users,
  handymanProfiles,
  handymanSkills,
  handymanAvailability,
  contractorAvailabilityDates,
} from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';

async function seed() {
  console.log('Seeding test contractor "Mike Thompson"...');

  const passwordHash = await bcrypt.hash('password123', 10);
  const userId = uuidv4();
  const profileId = uuidv4();

  // 1. Create User
  try {
    await db.insert(users).values({
      id: userId,
      email: 'mike.test@handyservices.co.uk',
      firstName: 'Mike',
      lastName: 'Thompson',
      phone: '07700900001',
      password: passwordHash,
      role: 'contractor',
      isActive: true,
    });
    console.log('User created:', userId);
  } catch (e: any) {
    if (e.message?.includes('duplicate') || e.code === '23505') {
      console.log('User with that email already exists, looking up...');
      const existing = await db.select().from(users).where(eq(users.email, 'mike.test@handyservices.co.uk'));
      if (existing.length > 0) {
        // Reuse the existing user's ID
        const existingUserId = existing[0].id;
        console.log('Using existing user:', existingUserId);
        return seedProfile(existingUserId, uuidv4(), passwordHash);
      }
    }
    throw e;
  }

  await seedProfile(userId, profileId, passwordHash);
}

async function seedProfile(userId: string, profileId: string, _passwordHash: string) {
  // 2. Create Handyman Profile
  try {
    // Check if profile already exists for this user
    const existingProfiles = await db.select().from(handymanProfiles).where(eq(handymanProfiles.userId, userId));
    if (existingProfiles.length > 0) {
      console.log('Profile already exists for user, using existing profile:', existingProfiles[0].id);
      profileId = existingProfiles[0].id;
    } else {
      await db.insert(handymanProfiles).values({
        id: profileId,
        userId: userId,
        bio: 'Experienced multi-trade handyman covering Greater Nottingham. 10+ years in domestic and commercial maintenance.',
        city: 'Nottingham',
        postcode: 'NG1 5AW',
        latitude: '52.9548',
        longitude: '-1.1581',
        radiusMiles: 15,
        hourlyRate: 45,
        slug: 'mike-thompson',
        publicProfileEnabled: true,
        verificationStatus: 'verified',
        stripeAccountId: 'acct_test_mike',
        stripeAccountStatus: 'active',
        availabilityStatus: 'available',
        heroImageUrl: 'https://images.unsplash.com/photo-1581578731117-104f2a8d4ee6?auto=format&fit=crop&q=80',
        profileImageUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80',
      });
      console.log('Profile created:', profileId);
    }
  } catch (e: any) {
    if (e.message?.includes('duplicate') || e.code === '23505') {
      console.log('Profile might already exist (slug conflict?), continuing...');
      const existing = await db.select().from(handymanProfiles).where(eq(handymanProfiles.userId, userId));
      if (existing.length > 0) {
        profileId = existing[0].id;
      }
    } else {
      throw e;
    }
  }

  // 3. Create Skills across multiple categories
  const categorySkills: Array<{ categorySlug: string; proficiency: string }> = [
    { categorySlug: 'plumbing_minor', proficiency: 'expert' },
    { categorySlug: 'general_fixing', proficiency: 'expert' },
    { categorySlug: 'shelving', proficiency: 'expert' },
    { categorySlug: 'carpentry', proficiency: 'competent' },
    { categorySlug: 'painting', proficiency: 'competent' },
    { categorySlug: 'door_fitting', proficiency: 'expert' },
    { categorySlug: 'tv_mounting', proficiency: 'expert' },
    { categorySlug: 'flat_pack', proficiency: 'expert' },
    { categorySlug: 'electrical_minor', proficiency: 'competent' },
    { categorySlug: 'tiling', proficiency: 'competent' },
  ];

  // Delete any existing skills for this profile first
  await db.delete(handymanSkills).where(eq(handymanSkills.handymanId, profileId));
  console.log('Cleared existing skills.');

  for (const skill of categorySkills) {
    await db.insert(handymanSkills).values({
      id: uuidv4(),
      handymanId: profileId,
      categorySlug: skill.categorySlug,
      proficiency: skill.proficiency,
    });
  }
  console.log(`Created ${categorySkills.length} skills.`);

  // 4. Create weekly availability pattern
  // dayOfWeek: 0=Sunday, 1=Monday, ... 6=Saturday
  await db.delete(handymanAvailability).where(eq(handymanAvailability.handymanId, profileId));
  console.log('Cleared existing weekly availability.');

  const weeklySlots = [
    // Monday-Friday: 8:00-18:00
    { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
    { dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
    { dayOfWeek: 3, startTime: '08:00', endTime: '18:00' },
    { dayOfWeek: 4, startTime: '08:00', endTime: '18:00' },
    { dayOfWeek: 5, startTime: '08:00', endTime: '18:00' },
    // Saturday: 8:00-13:00
    { dayOfWeek: 6, startTime: '08:00', endTime: '13:00' },
    // Sunday: not available (no entry)
  ];

  for (const slot of weeklySlots) {
    await db.insert(handymanAvailability).values({
      id: uuidv4(),
      handymanId: profileId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      isActive: true,
    });
  }
  console.log(`Created ${weeklySlots.length} weekly availability slots.`);

  // 5. Create specific date availability for next 14 days (April 12-25, 2026)
  await db.delete(contractorAvailabilityDates).where(eq(contractorAvailabilityDates.contractorId, profileId));
  console.log('Cleared existing date-specific availability.');

  const startDate = new Date('2026-04-12');
  let dateCount = 0;

  for (let i = 0; i < 14; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday

    if (dayOfWeek === 0) continue; // Skip Sunday

    const startTime = '08:00';
    const endTime = dayOfWeek === 6 ? '13:00' : '18:00';

    await db.insert(contractorAvailabilityDates).values({
      id: uuidv4(),
      contractorId: profileId,
      date: date,
      isAvailable: true,
      startTime,
      endTime,
      notes: dayOfWeek === 6 ? 'Saturday half-day' : undefined,
    });
    dateCount++;
  }
  console.log(`Created ${dateCount} date-specific availability entries.`);

  console.log('\n--- Seed Complete ---');
  console.log(`User ID:    ${userId}`);
  console.log(`Profile ID: ${profileId}`);
  console.log(`Email:      mike.test@handyservices.co.uk`);
  console.log(`Password:   password123`);
  console.log(`Location:   Nottingham (52.9548, -1.1581)`);
  console.log(`Skills:     ${categorySkills.map(s => s.categorySlug).join(', ')}`);

  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
