/**
 * Setup Sandbox Testing
 *
 * Creates test data for Twilio WhatsApp sandbox testing:
 * 1. Test landlord
 * 2. Test property
 * 3. Test tenant (your phone number)
 *
 * Usage: npx tsx scripts/setup-sandbox-testing.ts +447XXXXXXXXX "Your Name"
 */

import 'dotenv/config';
import { db } from '../server/db';
import { leads, properties, tenants, landlordSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { normalizePhoneNumber } from '../server/phone-utils';

async function setupSandboxTesting() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║           TWILIO SANDBOX TESTING SETUP                         ║
╠════════════════════════════════════════════════════════════════╣
║                                                                 ║
║  This script registers your phone as a test tenant.            ║
║                                                                 ║
║  Usage:                                                         ║
║    npx tsx scripts/setup-sandbox-testing.ts +447XXXXXXXXX "Name"║
║                                                                 ║
║  Example:                                                       ║
║    npx tsx scripts/setup-sandbox-testing.ts +447700123456 "John"║
║                                                                 ║
╚════════════════════════════════════════════════════════════════╝
        `);
        process.exit(1);
    }

    const rawPhone = args[0];
    const tenantName = args[1] || 'Test Tenant';

    const phone = normalizePhoneNumber(rawPhone);
    if (!phone) {
        console.error('❌ Invalid phone number format. Use +447XXXXXXXXX');
        process.exit(1);
    }

    console.log('\n🚀 SETTING UP SANDBOX TESTING\n');
    console.log('='.repeat(50));

    // 1. Check if tenant already exists
    const existingTenant = await db.query.tenants.findFirst({
        where: eq(tenants.phone, phone)
    });

    if (existingTenant) {
        console.log(`✅ Tenant already exists: ${existingTenant.name}`);
        console.log(`   Phone: ${existingTenant.phone}`);
        console.log(`   Property ID: ${existingTenant.propertyId}`);

        // Get property details
        if (existingTenant.propertyId) {
            const property = await db.query.properties.findFirst({
                where: eq(properties.id, existingTenant.propertyId),
                with: { landlord: true }
            });
            if (property) {
                console.log(`   Address: ${property.address}`);
                console.log(`   Landlord: ${property.landlord?.customerName || 'Unknown'}`);
            }
        }

        printTestingInstructions(phone);
        return;
    }

    // 2. Create test landlord
    console.log('\n📋 Creating test landlord...');
    const landlordId = `sandbox_landlord_${nanoid(8)}`;

    const [landlord] = await db.insert(leads).values({
        id: landlordId,
        customerName: 'Sandbox Test Landlord',
        phone: '+447700000001', // Fake landlord number
        email: 'sandbox-landlord@test.v6.com',
        source: 'sandbox_test',
        segment: 'LANDLORD',
        status: 'active',
    }).onConflictDoNothing().returning();

    const finalLandlordId = landlord?.id || landlordId;
    console.log(`   ✅ Landlord ID: ${finalLandlordId}`);

    // 3. Create landlord settings
    await db.insert(landlordSettings).values({
        id: nanoid(),
        landlordLeadId: finalLandlordId,
        notifyOnNewIssue: true,
        notifyOnStatusChange: true,
        autoApproveUnder: 100, // Auto-approve jobs under £100
    }).onConflictDoNothing();
    console.log('   ✅ Landlord settings created');

    // 4. Create test property
    console.log('\n🏠 Creating test property...');
    const propertyId = `sandbox_prop_${nanoid(8)}`;

    const [property] = await db.insert(properties).values({
        id: propertyId,
        address: '123 Sandbox Street, Test Town',
        postcode: 'NG1 1AA',
        landlordLeadId: finalLandlordId,
        propertyType: 'flat',
        bedrooms: 2,
    }).returning();

    console.log(`   ✅ Property: ${property.address}`);

    // 5. Create test tenant (YOUR phone)
    console.log('\n👤 Creating test tenant (YOU)...');
    const tenantId = `sandbox_tenant_${nanoid(8)}`;

    const [tenant] = await db.insert(tenants).values({
        id: tenantId,
        name: tenantName,
        phone: phone,
        email: 'sandbox-tenant@test.v6.com',
        propertyId: property.id,
        moveInDate: new Date(),
    }).returning();

    console.log(`   ✅ Tenant: ${tenant.name}`);
    console.log(`   ✅ Phone: ${tenant.phone}`);

    // Print testing instructions
    printTestingInstructions(phone);
}

function printTestingInstructions(phone: string) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    SANDBOX TESTING READY                        ║
╠════════════════════════════════════════════════════════════════╣
║                                                                 ║
║  STEP 1: Join the Twilio Sandbox                                ║
║  ─────────────────────────────────                              ║
║  Send this message to +1 415 523 8886 on WhatsApp:              ║
║                                                                 ║
║     join <your-sandbox-code>                                    ║
║                                                                 ║
║  (Find your code in Twilio Console → Messaging → Try it out)    ║
║                                                                 ║
║  STEP 2: Test the Troubleshooting Flow                          ║
║  ────────────────────────────────────                           ║
║  After joining, send these test messages:                       ║
║                                                                 ║
║  🔥 Boiler Test:                                                ║
║     "Hi, my boiler isn't working"                               ║
║     → "yes it's on"                                             ║
║     → "0.5 bar"                                                 ║
║     → "yes I see the loop"                                      ║
║     → "1.2 bar now"                                             ║
║     → "yes it's working!"                                       ║
║                                                                 ║
║  🚰 Tap Test:                                                   ║
║     "My kitchen tap is dripping"                                ║
║     → "kitchen"                                                 ║
║     → "slow drip"                                               ║
║     → "I tightened it"                                          ║
║     → "yes stopped"                                             ║
║                                                                 ║
║  🚽 Escalation Test:                                            ║
║     "Toilet is blocked"                                         ║
║     → "water almost overflowing"                                ║
║     → "tried plunger"                                           ║
║                                                                 ║
║  STEP 3: Check Results                                          ║
║  ────────────────────                                           ║
║  • View issues: /admin/tenant-issues                            ║
║  • View metrics: /api/admin/deflection-metrics                  ║
║                                                                 ║
╚════════════════════════════════════════════════════════════════╝

Your registered phone: ${phone}

⚠️  SANDBOX LIMITATIONS:
• You must join sandbox every 24 hours
• Only pre-registered numbers can message
• Templates are limited

Happy testing! 🎉
`);
}

setupSandboxTesting().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
});
