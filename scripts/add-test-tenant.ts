/**
 * Add a real phone number as a test tenant for WhatsApp testing
 *
 * Usage: npx tsx scripts/add-test-tenant.ts +447XXXXXXXXX "Your Name"
 */

import 'dotenv/config';
import { db } from '../server/db';
import { tenants, properties } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function addTestTenant() {
    const phone = process.argv[2];
    const name = process.argv[3] || 'Test Tenant';

    if (!phone) {
        console.log('\n❌ Please provide a phone number');
        console.log('\nUsage: npx tsx scripts/add-test-tenant.ts +447XXXXXXXXX "Your Name"\n');
        process.exit(1);
    }

    // Normalize phone
    let normalizedPhone = phone.replace(/[^\d+]/g, '');
    if (normalizedPhone.startsWith('0')) {
        normalizedPhone = '+44' + normalizedPhone.substring(1);
    }
    if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+' + normalizedPhone;
    }

    console.log('\n📱 Adding test tenant...');
    console.log('Phone:', normalizedPhone);
    console.log('Name:', name);

    // Check if already exists
    const existing = await db.query.tenants.findFirst({
        where: eq(tenants.phone, normalizedPhone)
    });

    if (existing) {
        console.log('\n✅ Tenant already exists!');
        const prop = await db.query.properties.findFirst({
            where: eq(properties.id, existing.propertyId)
        });
        console.log('Property:', prop?.address);
        console.log('\n🎯 Ready to test! Send a WhatsApp message to:', process.env.TWILIO_WHATSAPP_NUMBER || '+15558874602');
        process.exit(0);
    }

    // Get first property (Baker Street)
    const property = await db.query.properties.findFirst();

    if (!property) {
        console.log('\n❌ No properties found. Run seed script first.');
        process.exit(1);
    }

    // Add tenant
    const { nanoid } = await import('nanoid');
    await db.insert(tenants).values({
        id: nanoid(),
        propertyId: property.id,
        name,
        phone: normalizedPhone,
        isPrimary: false,
        isActive: true,
        whatsappOptIn: true,
        createdAt: new Date()
    });

    console.log('\n✅ Tenant added successfully!');
    console.log('Property:', property.address);
    console.log('\n🎯 Ready to test!');
    console.log('1. Send a WhatsApp message from', normalizedPhone);
    console.log('2. To the Twilio number:', process.env.TWILIO_WHATSAPP_NUMBER || '+15558874602');
    console.log('\nExample message: "Hi, I have a problem with my tap"');

    process.exit(0);
}

addTestTenant().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
