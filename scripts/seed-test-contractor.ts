
import 'dotenv/config';
import { db } from '../server/db';
import { users, handymanProfiles } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';

async function seed() {
    console.log('Seeding test contractor...');

    const passwordHash = await bcrypt.hash('password123', 10);
    const userId = uuidv4();
    const profileId = uuidv4();

    // Create User
    try {
        await db.insert(users).values({
            id: userId,
            username: 'test_contractor',
            password: passwordHash,
            role: 'contractor',
            firstName: 'Test',
            lastName: 'Handyman',
            email: 'test@handy.contractors',
        });
        console.log('User created:', userId);
    } catch (e) {
        console.log('User might already exist, skipping...');
    }

    // Create Profile
    try {
        // Check if profile exists for this user (if we skipped user creation)
        // Actually, we generated a new ID, so just insert.
        // If user existed, we might fail foreign key if we didn't query the existing user.
        // Ideally we find existing user or creating new.

        // Let's just create a unique one each time or handle conflict.

        await db.insert(handymanProfiles).values({
            id: profileId,
            userId: userId,
            bio: 'Expert general handyman with 10 years experience.',
            city: 'London',
            postcode: 'SW1A 1AA',
            latitude: '51.50101',
            longitude: '-0.141563',
            radiusMiles: 20,
            hourlyRate: 60,
            slug: 'test-handyman',
            publicProfileEnabled: true,
            verificationStatus: 'verified',
            heroImageUrl: 'https://images.unsplash.com/photo-1581578731117-104f2a8d4ee6?auto=format&fit=crop&q=80',
            profileImageUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80',
        });
        console.log('Profile created:', profileId);

    } catch (e) {
        console.error('Failed to create profile (might exist):', e);
    }

    console.log('Seeding complete.');
    process.exit(0);
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
