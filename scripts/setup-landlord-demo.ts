/**
 * Setup Landlord Demo Data
 * Creates comprehensive test data for the landlord portal
 */

import { db } from '../server/db';
import { leads, properties, tenants, tenantIssues, landlordSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

async function setupLandlordDemo() {
    console.log('\n📋 LANDLORD PORTAL DEMO SETUP\n');
    console.log('='.repeat(60));

    // Demo landlord ID
    const landlordId = 'demo-landlord-001';
    const landlordName = 'Sarah Thompson';
    const landlordEmail = 'sarah@thompsonproperties.co.uk';
    const landlordPhone = '+447700123456';

    // Check if demo landlord exists
    const existing = await db.query.leads.findFirst({
        where: eq(leads.id, landlordId)
    });

    if (!existing) {
        console.log('Creating demo landlord...');
        await db.insert(leads).values({
            id: landlordId,
            customerName: landlordName,
            email: landlordEmail,
            phone: landlordPhone,
            segment: 'LANDLORD',
            source: 'demo_setup',
            status: 'active',
            createdAt: new Date()
        });

        // Create settings
        await db.insert(landlordSettings).values({
            id: nanoid(),
            landlordLeadId: landlordId,
            autoApproveUnderPence: 15000,
            requireApprovalAbovePence: 50000,
            autoApproveCategories: ['plumbing_emergency', 'heating', 'security'],
            alwaysRequireApprovalCategories: ['cosmetic', 'upgrade'],
            notifyOnAutoApprove: true,
            notifyOnCompletion: true,
            preferredChannel: 'whatsapp',
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    // Create/ensure properties
    const demoProperties = [
        {
            id: 'demo-prop-001',
            address: '42 Victoria Road',
            postcode: 'NG1 2AB',
            propertyType: 'flat' as const,
            nickname: 'Victoria Flat'
        },
        {
            id: 'demo-prop-002',
            address: '15 Baker Street',
            postcode: 'NG5 3CD',
            propertyType: 'house' as const,
            nickname: 'Baker House'
        },
        {
            id: 'demo-prop-003',
            address: '8 Derby Road',
            postcode: 'NG7 4EF',
            propertyType: 'flat' as const,
            nickname: 'Derby Studio'
        }
    ];

    for (const prop of demoProperties) {
        const existingProp = await db.query.properties.findFirst({
            where: eq(properties.id, prop.id)
        });

        if (!existingProp) {
            console.log(`Creating property: ${prop.nickname}...`);
            await db.insert(properties).values({
                id: prop.id,
                landlordLeadId: landlordId,
                address: prop.address,
                postcode: prop.postcode,
                propertyType: prop.propertyType,
                nickname: prop.nickname,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }
    }

    // Create tenants
    const demoTenants = [
        { id: 'demo-tenant-001', propertyId: 'demo-prop-001', name: 'Emma Wilson', phone: '+447700200001' },
        { id: 'demo-tenant-002', propertyId: 'demo-prop-002', name: 'James Chen', phone: '+447700200002' },
        { id: 'demo-tenant-003', propertyId: 'demo-prop-003', name: 'Priya Patel', phone: '+447700200003' }
    ];

    for (const tenant of demoTenants) {
        const existingTenant = await db.query.tenants.findFirst({
            where: eq(tenants.id, tenant.id)
        });

        if (!existingTenant) {
            console.log(`Creating tenant: ${tenant.name}...`);
            await db.insert(tenants).values({
                id: tenant.id,
                propertyId: tenant.propertyId,
                name: tenant.name,
                phone: tenant.phone,
                isPrimary: true,
                isActive: true,
                whatsappOptIn: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }
    }

    // Create demo issues with various statuses
    const demoIssues = [
        {
            id: 'demo-issue-001',
            tenantId: 'demo-tenant-001',
            propertyId: 'demo-prop-001',
            status: 'quoted' as const,
            issueDescription: 'The kitchen tap is dripping constantly. Water bill going up.',
            issueCategory: 'plumbing' as const,
            urgency: 'medium' as const,
            photos: [
                'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=400',
                'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=400'
            ],
            aiResolutionAttempted: true,
            aiResolutionAccepted: false,
            quoteAmount: 12500 // £125
        },
        {
            id: 'demo-issue-002',
            tenantId: 'demo-tenant-002',
            propertyId: 'demo-prop-002',
            status: 'reported' as const,
            issueDescription: 'Front door lock is sticking and difficult to open. Security concern.',
            issueCategory: 'locksmith' as const,
            urgency: 'high' as const,
            photos: [
                'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'
            ],
            aiResolutionAttempted: true,
            aiResolutionAccepted: false
        },
        {
            id: 'demo-issue-003',
            tenantId: 'demo-tenant-003',
            propertyId: 'demo-prop-003',
            status: 'completed' as const,
            issueDescription: 'Bathroom extractor fan stopped working.',
            issueCategory: 'electrical' as const,
            urgency: 'low' as const,
            aiResolutionAttempted: false,
            resolvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        },
        {
            id: 'demo-issue-004',
            tenantId: 'demo-tenant-001',
            propertyId: 'demo-prop-001',
            status: 'resolved_diy' as const,
            issueDescription: 'Radiator not heating up properly.',
            issueCategory: 'heating' as const,
            urgency: 'medium' as const,
            aiResolutionAttempted: true,
            aiResolutionAccepted: true,
            resolvedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        },
        {
            id: 'demo-issue-005',
            tenantId: 'demo-tenant-002',
            propertyId: 'demo-prop-002',
            status: 'ai_helping' as const,
            issueDescription: 'Smoke detector keeps beeping occasionally.',
            issueCategory: 'electrical' as const,
            urgency: 'low' as const,
            aiResolutionAttempted: true
        }
    ];

    for (const issue of demoIssues) {
        const existingIssue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, issue.id)
        });

        if (!existingIssue) {
            console.log(`Creating issue: ${issue.issueDescription?.slice(0, 40)}...`);
            await db.insert(tenantIssues).values({
                id: issue.id,
                tenantId: issue.tenantId,
                propertyId: issue.propertyId,
                landlordLeadId: landlordId,
                status: issue.status,
                issueDescription: issue.issueDescription,
                issueCategory: issue.issueCategory,
                urgency: issue.urgency,
                photos: issue.photos || null,
                aiResolutionAttempted: issue.aiResolutionAttempted,
                aiResolutionAccepted: issue.aiResolutionAccepted || null,
                reportedToLandlordAt: issue.status === 'quoted' || issue.status === 'reported' ? new Date() : null,
                resolvedAt: issue.resolvedAt || null,
                createdAt: new Date(Date.now() - Math.random() * 14 * 24 * 60 * 60 * 1000),
                updatedAt: new Date()
            });
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ DEMO SETUP COMPLETE!\n');
    console.log('📱 TEST URLs:\n');
    console.log('LANDLORD PORTAL:');
    console.log(`  Dashboard:    http://localhost:5000/landlord/${landlordId}`);
    console.log(`  Issues:       http://localhost:5000/landlord/${landlordId}/issues`);
    console.log(`  Properties:   http://localhost:5000/landlord/${landlordId}/properties`);
    console.log(`  Settings:     http://localhost:5000/landlord/${landlordId}/settings`);
    console.log('\nONBOARDING:');
    console.log('  Signup Page:  http://localhost:5000/landlord');
    console.log('  Alt URL:      http://localhost:5000/for-landlords');

    console.log('\n📋 OTHER EXISTING LANDLORDS:\n');
    const allLandlords = await db.select({
        id: leads.id,
        name: leads.customerName,
        email: leads.email,
        segment: leads.segment
    }).from(leads)
    .where(eq(leads.segment, 'LANDLORD'));

    for (const ll of allLandlords.slice(0, 5)) {
        console.log(`  ${ll.name}: http://localhost:5000/landlord/${ll.id}`);
    }

    console.log('\n');
    process.exit(0);
}

setupLandlordDemo().catch(console.error);
