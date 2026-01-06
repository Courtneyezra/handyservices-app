import { Router, Request, Response } from 'express';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';
import {
    handymanProfiles,
    users,
    contractorAvailabilityDates,
    handymanAvailability,
    contractorBookingRequests
} from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

const router = Router();

// GET /api/public/contractor/:slug
// Get contractor public profile by slug
router.get('/contractor/:slug', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;

        // Find profile by slug
        const profileWithUser = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            with: {
                user: true, // Join with users table
                skills: {
                    with: {
                        service: true // Join with productizedServices to get skill names
                    }
                }
            }
        });

        if (!profileWithUser) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Check if public profile is enabled
        if (!profileWithUser.publicProfileEnabled) {
            return res.status(403).json({ error: 'Profile is not public' });
        }

        // Construct safe public response
        const response = {
            id: profileWithUser.id,
            firstName: profileWithUser.user.firstName,
            lastName: profileWithUser.user.lastName ? profileWithUser.user.lastName[0] + '.' : '',
            fullName: `${profileWithUser.user.firstName} ${profileWithUser.user.lastName}`,
            bio: profileWithUser.bio,
            city: profileWithUser.city,
            postcode: profileWithUser.postcode,
            phone: profileWithUser.user.phone, // Expose phone for WhatsApp
            heroImageUrl: profileWithUser.heroImageUrl,
            mediaGallery: profileWithUser.mediaGallery, // ARRAY of {type, url, caption}
            socialLinks: profileWithUser.socialLinks,
            skills: profileWithUser.skills.map(s => s.service.name),
            services: profileWithUser.skills.map(s => ({
                id: s.service.id,
                name: s.service.name,
                description: s.service.description,
                pricePence: s.hourlyRate ? (s.hourlyRate * 100) : s.service.pricePence, // Use override (pounds -> pence) or default
                category: s.service.category
            })),
            radiusMiles: profileWithUser.radiusMiles,
        };

        res.json(response);
    } catch (error) {
        console.error('[PublicAPI] Get contractor error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// GET /api/public/contractor/:slug/availability
// Get upcoming availability for public calendar
router.get('/contractor/:slug/availability', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;

        // 1. Get Contractor ID from Slug
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            columns: { id: true, publicProfileEnabled: true }
        });

        if (!profile || !profile.publicProfileEnabled) {
            return res.status(404).json({ error: 'Profile not found or private' });
        }

        const contractorId = profile.id;

        // 2. Fetch Availability (Next 14 Days)
        // Similar logic to internal /upcoming route
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        // Date Overrides
        const dateAvailability = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, today),
                lte(contractorAvailabilityDates.date, twoWeeksOut)
            ));

        // Weekly Patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        // Build result
        const availability: Array<any> = [];

        for (let i = 0; i < 14; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            const dayOfWeek = date.getDay();
            const dateStr = date.toISOString().split('T')[0];

            // Check override first
            const override = dateAvailability.find(d =>
                new Date(d.date).toISOString().split('T')[0] === dateStr
            );

            if (override) {
                if (override.isAvailable) {
                    availability.push({
                        date: dateStr,
                        startTime: override.startTime,
                        endTime: override.endTime
                    });
                }
                // If isAvailable=false, we just don't push it
            } else {
                // Check pattern
                const pattern = weeklyPatterns.find(w => w.dayOfWeek === dayOfWeek && w.isActive);
                if (pattern) {
                    availability.push({
                        date: dateStr,
                        startTime: pattern.startTime,
                        endTime: pattern.endTime
                    });
                }
            }
        }

        res.json({ availability });
    } catch (error) {
        console.error('[PublicAPI] Get availability error:', error);
        res.status(500).json({ error: 'Failed to fetch availability' });
    }
});

// POST /api/public/contractor/:slug/book
// Submit a booking request
router.post('/contractor/:slug/book', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const { name, email, phone, date, slot, description } = req.body;

        if (!name || !phone || !date || !slot) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get Contractor
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            columns: { id: true }
        });

        if (!profile) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        // 2. Create Booking Request
        await db.insert(contractorBookingRequests).values({
            id: uuidv4(),
            contractorId: profile.id,
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            requestedDate: new Date(date),
            requestedSlot: slot,
            description: description || '',
            status: 'pending'
        });

        res.json({ success: true });

    } catch (error) {
        console.error('[PublicAPI] Booking request error:', error);
        res.status(500).json({ error: 'Failed to submit booking' });
    }
});

export default router;
