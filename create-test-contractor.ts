import { db } from './server/db';
import { users, contractorProfiles } from './shared/schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

async function createTestContractor() {
    const email = 'test@contractor.com';
    const password = 'test123';

    // Check if user already exists
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existing.length > 0) {
        console.log('✅ Test contractor already exists!');
        console.log('Email:', email);
        console.log('Password:', password);
        console.log('\nLogin at: http://localhost:5001/contractor/login');
        return;
    }

    // Create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
        email,
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Contractor',
        role: 'contractor',
        emailVerified: true
    }).returning();

    // Create contractor profile
    await db.insert(contractorProfiles).values({
        userId: user.id,
        slug: 'test-contractor',
        bio: 'Test contractor for voice-first SmartQuote',
        hourlyRate: 50
    });

    console.log('✅ Test contractor created successfully!');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('\nLogin at: http://localhost:5001/contractor/login');
}

createTestContractor().catch(console.error);
