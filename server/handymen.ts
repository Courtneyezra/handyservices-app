import { Router } from 'express';
import { db } from './db';
import { handymanProfiles, handymanSkills, handymanAvailability, users } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper to calculate distance in miles
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Get all handymen (with optional radius filter)
router.get('/', async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;

        const allProfiles = await db.query.handymanProfiles.findMany({
            with: {
                user: true,
                skills: {
                    with: {
                        service: true
                    }
                },
                availability: true
            }
        });

        // If no coords provided, return all
        if (!lat || !lng) {
            return res.json(allProfiles);
        }

        const centerLat = parseFloat(lat as string);
        const centerLng = parseFloat(lng as string);
        const searchRadius = parseFloat(radius as string) || 10;

        const filtered = allProfiles.filter(profile => {
            if (!profile.latitude || !profile.longitude) return false;
            const distance = calculateDistance(
                centerLat,
                centerLng,
                parseFloat(profile.latitude),
                parseFloat(profile.longitude)
            );
            return distance <= searchRadius;
        });

        res.json(filtered);
    } catch (error) {
        console.error("Failed to fetch handymen:", error);
        res.status(500).json({ error: "Failed to fetch handymen" });
    }
});

// GET /api/handymen/availability
// Returns aggregate availability (days of week and typical slots) for pros in an area
router.get('/availability', async (req, res) => {
    try {
        const { lat, lng, radius = '10' } = req.query;

        // 1. Get profiles in range
        const profiles = await db.query.handymanProfiles.findMany({
            with: {
                availability: true
            }
        });

        const centerLat = lat ? parseFloat(lat as string) : null;
        const centerLng = lng ? parseFloat(lng as string) : null;
        const searchRadius = parseFloat(radius as string);

        const profilesInRange = profiles.filter(p => {
            if (!p.latitude || !p.longitude || !centerLat || !centerLng) return true; // Default to all if no filter
            const dist = calculateDistance(centerLat, centerLng, parseFloat(p.latitude), parseFloat(p.longitude));
            return dist <= searchRadius;
        });

        // 2. Aggregate availability
        // Group by dayOfWeek: { day: number, slots: { AM: boolean, PM: boolean } }
        const aggregate: Record<number, { am: boolean, pm: boolean }> = {};

        profilesInRange.forEach(p => {
            p.availability.forEach(a => {
                if (a.dayOfWeek === null) return;
                if (!aggregate[a.dayOfWeek]) {
                    aggregate[a.dayOfWeek] = { am: false, pm: false };
                }

                const startH = parseInt(a.startTime.split(':')[0]);
                const endH = parseInt(a.endTime.split(':')[0]);

                if (startH < 12) aggregate[a.dayOfWeek].am = true;
                if (endH >= 12) aggregate[a.dayOfWeek].pm = true;
            });
        });

        // Convert to array
        const result = Object.entries(aggregate).map(([day, slots]) => ({
            dayOfWeek: parseInt(day),
            ...slots
        }));

        res.json(result);
    } catch (error) {
        console.error("Failed to fetch aggregate availability:", error);
        res.status(500).json({ error: "Failed to fetch aggregate availability" });
    }
});

// Get profile for a specific handyman
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.id, id),
            with: {
                user: true,
                skills: {
                    with: {
                        service: true
                    }
                },
                availability: true
            }
        });

        if (!profile) return res.status(404).json({ error: "Handyman not found" });

        res.json(profile);
    } catch (error) {
        console.error("Failed to fetch handyman profile:", error);
        res.status(500).json({ error: "Failed to fetch handyman profile" });
    }
});

// Create/Update profile
router.post('/profile', async (req, res) => {
    try {
        const { userId, ...data } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        // Search for existing profile
        const existing = await db.select().from(handymanProfiles).where(eq(handymanProfiles.userId, userId)).limit(1);

        if (existing.length > 0) {
            await db.update(handymanProfiles)
                .set({ ...data, updatedAt: new Date() })
                .where(eq(handymanProfiles.userId, userId));
            res.json({ success: true, id: existing[0].id });
        } else {
            const id = uuidv4();
            await db.insert(handymanProfiles).values({ id, userId, ...data });
            res.json({ success: true, id });
        }
    } catch (error) {
        console.error("Failed to save handyman profile:", error);
        res.status(500).json({ error: "Failed to save handyman profile" });
    }
});

// Manage Skills
router.post('/:id/skills', async (req, res) => {
    try {
        const { id } = req.params;
        const { serviceIds } = req.body; // Array of SKU IDs

        // Simple approach: delete all and re-insert
        await db.delete(handymanSkills).where(eq(handymanSkills.handymanId, id));

        if (serviceIds && serviceIds.length > 0) {
            const skillEntries = serviceIds.map((sid: string) => ({
                id: uuidv4(),
                handymanId: id,
                serviceId: sid
            }));
            await db.insert(handymanSkills).values(skillEntries);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Failed to update handyman skills:", error);
        res.status(500).json({ error: "Failed to update handyman skills" });
    }
});

// Manage Availability
router.post('/:id/availability', async (req, res) => {
    try {
        const { id } = req.params;
        const { availability } = req.body; // Array of { dayOfWeek, startTime, endTime }

        await db.delete(handymanAvailability).where(eq(handymanAvailability.handymanId, id));

        if (availability && availability.length > 0) {
            const entries = availability.map((a: any) => ({
                id: uuidv4(),
                handymanId: id,
                ...a
            }));
            await db.insert(handymanAvailability).values(entries);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Failed to update handyman availability:", error);
        res.status(500).json({ error: "Failed to update handyman availability" });
    }
});

export default router;
