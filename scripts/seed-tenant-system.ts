/**
 * Seed script for Property Maintenance AI Platform
 *
 * Creates test data:
 * - 2 landlords (LANDLORD and PROP_MGR segment)
 * - 3 properties per landlord
 * - 1-2 tenants per property
 * - Mix of issue statuses for testing
 * - Landlord settings with different rule configurations
 */

import { db } from "../server/db";
import {
    leads,
    properties,
    tenants,
    tenantIssues,
    landlordSettings,
    TenantIssueStatusValues,
    IssueCategoryValues,
    TenantIssueUrgencyValues,
    PropertyTypeValues
} from "../shared/schema";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

async function seedTenantSystem() {
    console.log("🌱 Seeding Property Maintenance AI Platform data...\n");

    // Step 1: Create or find landlord leads
    console.log("📋 Creating landlord leads...");

    const landlord1Id = `landlord-${nanoid(8)}`;
    const landlord2Id = `landlord-${nanoid(8)}`;

    // Landlord 1: Sebastian - PROP_MGR segment (portfolio manager)
    await db.insert(leads).values({
        id: landlord1Id,
        customerName: "Sebastian Holmes",
        phone: "+447700900001",
        email: "sebastian@holmesproperties.co.uk",
        segment: "PROP_MGR",
        status: "active",
        source: "manual",
        jobDescription: "Property portfolio manager - 6 properties",
        address: "Baker Street Management, London",
        postcode: "NW1 6XE"
    }).onConflictDoNothing();

    // Landlord 2: Jason - LANDLORD segment (individual landlord)
    await db.insert(leads).values({
        id: landlord2Id,
        customerName: "Jason Martinez",
        phone: "+447700900002",
        email: "jason.martinez@email.com",
        segment: "LANDLORD",
        status: "active",
        source: "manual",
        jobDescription: "Individual landlord - 3 buy-to-let properties",
        address: "25 Electric Avenue, London",
        postcode: "SW9 8JP"
    }).onConflictDoNothing();

    console.log(`  ✓ Created landlord: Sebastian Holmes (PROP_MGR)`);
    console.log(`  ✓ Created landlord: Jason Martinez (LANDLORD)`);

    // Step 2: Create landlord settings with different rules
    console.log("\n⚙️ Creating landlord settings...");

    // Sebastian: Higher thresholds (manages multiple properties)
    await db.insert(landlordSettings).values({
        id: nanoid(),
        landlordLeadId: landlord1Id,
        autoApproveUnderPence: 25000, // £250
        requireApprovalAbovePence: 75000, // £750
        autoApproveCategories: ['plumbing', 'plumbing_emergency', 'heating', 'security', 'water_leak', 'locksmith'],
        alwaysRequireApprovalCategories: ['cosmetic', 'upgrade', 'garden'],
        emergencyAutoDispatch: true,
        monthlyBudgetPence: 100000, // £1000/month
        budgetAlertThreshold: 75,
        notifyOnAutoApprove: false, // Only notify for approvals needed
        notifyOnCompletion: true,
        preferredChannel: 'whatsapp',
        isPartnerMember: true,
        partnerDiscountPercent: 10
    }).onConflictDoNothing();

    // Jason: Lower thresholds (more cautious, individual landlord)
    await db.insert(landlordSettings).values({
        id: nanoid(),
        landlordLeadId: landlord2Id,
        autoApproveUnderPence: 10000, // £100
        requireApprovalAbovePence: 30000, // £300
        autoApproveCategories: ['plumbing_emergency', 'heating', 'security', 'water_leak'],
        alwaysRequireApprovalCategories: ['cosmetic', 'upgrade', 'appliance'],
        emergencyAutoDispatch: true,
        monthlyBudgetPence: 50000, // £500/month
        budgetAlertThreshold: 80,
        notifyOnAutoApprove: true, // Wants to know everything
        notifyOnCompletion: true,
        preferredChannel: 'whatsapp'
    }).onConflictDoNothing();

    console.log(`  ✓ Created settings for Sebastian (high threshold)`);
    console.log(`  ✓ Created settings for Jason (low threshold)`);

    // Step 3: Create properties for Sebastian (PROP_MGR)
    console.log("\n🏠 Creating properties for Sebastian...");

    const sebastianProperties = [
        { address: "221B Baker Street", postcode: "NW1 6XE", nickname: "Baker Street Flat", type: "flat" as const },
        { address: "45 Marylebone Road", postcode: "NW1 5JD", nickname: "Marylebone Apartment", type: "flat" as const },
        { address: "12 Regent's Park Road", postcode: "NW1 7AY", nickname: "Regent's Park House", type: "house" as const }
    ];

    const sebastianPropertyIds: string[] = [];
    for (const prop of sebastianProperties) {
        const propId = nanoid();
        sebastianPropertyIds.push(propId);
        await db.insert(properties).values({
            id: propId,
            landlordLeadId: landlord1Id,
            address: prop.address,
            postcode: prop.postcode,
            nickname: prop.nickname,
            propertyType: prop.type,
            isActive: true
        });
        console.log(`  ✓ Created property: ${prop.nickname}`);
    }

    // Step 4: Create properties for Jason (LANDLORD)
    console.log("\n🏠 Creating properties for Jason...");

    const jasonProperties = [
        { address: "25 Electric Avenue", postcode: "SW9 8JP", nickname: "Electric Ave Flat", type: "flat" as const },
        { address: "78 Brixton Road", postcode: "SW9 6BT", nickname: "Brixton Road Unit", type: "flat" as const },
        { address: "15 Coldharbour Lane", postcode: "SW9 8PS", nickname: "Coldharbour Maisonette", type: "flat" as const }
    ];

    const jasonPropertyIds: string[] = [];
    for (const prop of jasonProperties) {
        const propId = nanoid();
        jasonPropertyIds.push(propId);
        await db.insert(properties).values({
            id: propId,
            landlordLeadId: landlord2Id,
            address: prop.address,
            postcode: prop.postcode,
            nickname: prop.nickname,
            propertyType: prop.type,
            isActive: true
        });
        console.log(`  ✓ Created property: ${prop.nickname}`);
    }

    // Step 5: Create tenants for each property
    console.log("\n👤 Creating tenants...");

    const tenantData = [
        // Sebastian's tenants
        { propertyIndex: 0, name: "John Watson", phone: "+447700100001", email: "john.watson@email.com", landlord: "sebastian" },
        { propertyIndex: 0, name: "Mary Watson", phone: "+447700100002", email: "mary.watson@email.com", landlord: "sebastian", isPrimary: false },
        { propertyIndex: 1, name: "Sarah Chen", phone: "+447700100003", email: "sarah.chen@email.com", landlord: "sebastian" },
        { propertyIndex: 2, name: "David Patel", phone: "+447700100004", email: "david.patel@email.com", landlord: "sebastian" },
        // Jason's tenants
        { propertyIndex: 0, name: "Emma Williams", phone: "+447700200001", email: "emma.w@email.com", landlord: "jason" },
        { propertyIndex: 1, name: "Marcus Johnson", phone: "+447700200002", email: "marcus.j@email.com", landlord: "jason" },
        { propertyIndex: 2, name: "Lisa Brown", phone: "+447700200003", email: "lisa.brown@email.com", landlord: "jason" },
        { propertyIndex: 2, name: "Tom Brown", phone: "+447700200004", email: "tom.brown@email.com", landlord: "jason", isPrimary: false }
    ];

    const tenantIds: Record<string, string> = {};
    for (const tenant of tenantData) {
        const tenantId = nanoid();
        const propertyId = tenant.landlord === "sebastian"
            ? sebastianPropertyIds[tenant.propertyIndex]
            : jasonPropertyIds[tenant.propertyIndex];

        tenantIds[tenant.phone] = tenantId;

        await db.insert(tenants).values({
            id: tenantId,
            propertyId,
            name: tenant.name,
            phone: tenant.phone,
            email: tenant.email,
            isPrimary: tenant.isPrimary !== false,
            isActive: true,
            whatsappOptIn: true
        });
        console.log(`  ✓ Created tenant: ${tenant.name} (${tenant.landlord})`);
    }

    // Step 6: Create sample tenant issues
    console.log("\n🔧 Creating sample tenant issues...");

    const sampleIssues = [
        // Active issues for Sebastian's properties
        {
            tenantPhone: "+447700100001",
            description: "Kitchen tap is dripping constantly. Tried turning off the water under the sink but it's still going.",
            category: "plumbing" as const,
            urgency: "medium" as const,
            status: "reported" as const,
            aiAttempted: true,
            landlord: landlord1Id
        },
        {
            tenantPhone: "+447700100003",
            description: "Boiler making strange noises and radiators not heating up properly.",
            category: "heating" as const,
            urgency: "high" as const,
            status: "approved" as const,
            aiAttempted: true,
            landlord: landlord1Id
        },
        {
            tenantPhone: "+447700100004",
            description: "Small crack in the ceiling paint, looks cosmetic but wanted to report it.",
            category: "cosmetic" as const,
            urgency: "low" as const,
            status: "new" as const,
            aiAttempted: false,
            landlord: landlord1Id
        },
        // Issues for Jason's properties
        {
            tenantPhone: "+447700200001",
            description: "Front door lock is sticking and sometimes won't open. Worried about security.",
            category: "locksmith" as const,
            urgency: "high" as const,
            status: "awaiting_details" as const,
            aiAttempted: true,
            landlord: landlord2Id
        },
        {
            tenantPhone: "+447700200002",
            description: "Blocked sink in bathroom. Water draining very slowly.",
            category: "plumbing" as const,
            urgency: "medium" as const,
            status: "resolved_diy" as const,
            aiAttempted: true,
            landlord: landlord2Id
        },
        {
            tenantPhone: "+447700200003",
            description: "Gas smell near boiler. Very worried!",
            category: "heating" as const,
            urgency: "emergency" as const,
            status: "scheduled" as const,
            aiAttempted: false, // Emergency bypasses AI
            landlord: landlord2Id
        }
    ];

    for (const issue of sampleIssues) {
        const tenantId = tenantIds[issue.tenantPhone];
        const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.id, tenantId)
        });

        if (!tenant) continue;

        await db.insert(tenantIssues).values({
            id: nanoid(),
            tenantId,
            propertyId: tenant.propertyId,
            landlordLeadId: issue.landlord,
            status: issue.status,
            issueDescription: issue.description,
            issueCategory: issue.category,
            urgency: issue.urgency,
            aiResolutionAttempted: issue.aiAttempted,
            aiResolutionAccepted: issue.status === 'resolved_diy' ? true : null,
            priceEstimateLowPence: issue.urgency === 'emergency' ? 15000 : 5000,
            priceEstimateHighPence: issue.urgency === 'emergency' ? 25000 : 12000,
            landlordNotifiedAt: ['reported', 'approved', 'scheduled'].includes(issue.status)
                ? new Date(Date.now() - 24 * 60 * 60 * 1000) // 24h ago
                : null,
            landlordApprovedAt: ['approved', 'scheduled'].includes(issue.status)
                ? new Date(Date.now() - 12 * 60 * 60 * 1000) // 12h ago
                : null
        });

        console.log(`  ✓ Created issue: ${issue.description.substring(0, 50)}... (${issue.status})`);
    }

    console.log("\n✅ Seed complete!\n");
    console.log("Summary:");
    console.log("  - 2 landlords created (Sebastian PROP_MGR, Jason LANDLORD)");
    console.log("  - 6 properties created (3 per landlord)");
    console.log("  - 8 tenants created");
    console.log("  - 6 sample issues created with various statuses");
    console.log("  - 2 landlord settings configured with different thresholds");
    console.log("\nTest accounts:");
    console.log("  Sebastian Holmes: +447700900001 (PROP_MGR, high threshold)");
    console.log("  Jason Martinez: +447700900002 (LANDLORD, low threshold)");
}

// Run the seed
seedTenantSystem()
    .then(() => {
        console.log("Done!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Seed failed:", error);
        process.exit(1);
    });
