import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from './db';
import {
    users,
    handymanProfiles,
    handymanSkills,
    handymanAvailability,
    contractorAvailabilityDates,
    contractorJobs,
    productizedServices,
    personalizedQuotes
} from '../shared/schema';
import { eq, desc, count, and, gte, inArray, sql } from 'drizzle-orm';
import { startOfWeek, startOfMonth } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';

// Multer config for admin contractor profile image uploads
const profileImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'server/storage/media/contractors/profile');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        const ext = path.extname(file.originalname);
        cb(null, `profile-${uniqueSuffix}${ext}`);
    }
});

const imageFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPG, PNG, and WebP images are allowed') as any, false);
    }
};

const uploadProfileImage = multer({
    storage: profileImageStorage,
    fileFilter: imageFileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

const router = Router();

// GET /api/admin/contractors
// List all contractors with summary data
router.get('/', async (req: Request, res: Response) => {
    try {
        // Get all contractor profiles with user info
        const contractors = await db.select({
            id: handymanProfiles.id,
            userId: handymanProfiles.userId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            postcode: handymanProfiles.postcode,
            city: handymanProfiles.city,
            radiusMiles: handymanProfiles.radiusMiles,
            bio: handymanProfiles.bio,
            availabilityStatus: handymanProfiles.availabilityStatus,
            publicProfileEnabled: handymanProfiles.publicProfileEnabled,
            slug: handymanProfiles.slug,
            createdAt: handymanProfiles.createdAt,
            insuranceUrl: handymanProfiles.publicLiabilityInsuranceUrl,
            stripeAccountId: handymanProfiles.stripeAccountId,
            lastAvailabilityRefresh: handymanProfiles.lastAvailabilityRefresh,
            verificationStatus: handymanProfiles.verificationStatus,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .orderBy(desc(handymanProfiles.createdAt));

        // Get skills for all contractors
        const allSkills = await db.select({
            handymanId: handymanSkills.handymanId,
            serviceId: handymanSkills.serviceId,
            serviceName: productizedServices.name,
            hourlyRate: handymanSkills.hourlyRate,
            categorySlug: handymanSkills.categorySlug,
            dayRate: handymanSkills.dayRate,
        })
        .from(handymanSkills)
        .leftJoin(productizedServices, eq(handymanSkills.serviceId, productizedServices.id));

        // Get job counts for all contractors
        const jobCounts = await db.select({
            contractorId: contractorJobs.contractorId,
            totalJobs: count(),
        })
        .from(contractorJobs)
        .groupBy(contractorJobs.contractorId);

        // Get weekly patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability);

        // Build response with aggregated data
        const contractorIds = contractors.map(c => c.id);

        // Get upcoming availability overrides
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        const dateOverrides = contractorIds.length > 0
            ? await db.select()
                .from(contractorAvailabilityDates)
                .where(and(
                    inArray(contractorAvailabilityDates.contractorId, contractorIds),
                    gte(contractorAvailabilityDates.date, today)
                ))
            : [];

        // Get earnings for all contractors (completed jobs)
        const now = new Date();
        const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
        const monthStart = startOfMonth(now);

        const earningsData = await db.select({
            contractorId: contractorJobs.contractorId,
            earningsAllTimePence: sql<number>`coalesce(sum(${contractorJobs.payoutPence}), 0)`.as('earnings_all_time'),
            earningsThisMonthPence: sql<number>`coalesce(sum(case when ${contractorJobs.createdAt} >= ${monthStart} then ${contractorJobs.payoutPence} else 0 end), 0)`.as('earnings_month'),
            earningsThisWeekPence: sql<number>`coalesce(sum(case when ${contractorJobs.createdAt} >= ${weekStart} then ${contractorJobs.payoutPence} else 0 end), 0)`.as('earnings_week'),
        })
        .from(contractorJobs)
        .where(eq(contractorJobs.status, 'completed'))
        .groupBy(contractorJobs.contractorId);

        // Get margin health from personalizedQuotes
        const marginData = contractorIds.length > 0
            ? await db.select({
                contractorId: personalizedQuotes.matchedContractorId,
                avgMarginPercent: sql<number | null>`avg(${personalizedQuotes.marginPercent})`.as('avg_margin'),
                quotesWithThinMargin: sql<number>`count(case when ${personalizedQuotes.marginFlags} is not null and jsonb_array_length(${personalizedQuotes.marginFlags}) > 0 then 1 end)`.as('thin_margin_count'),
            })
            .from(personalizedQuotes)
            .where(inArray(personalizedQuotes.matchedContractorId, contractorIds))
            .groupBy(personalizedQuotes.matchedContractorId)
            : [];

        // Map data to contractors
        const result = contractors.map(contractor => {
            const contractorSkills = allSkills.filter(s => s.handymanId === contractor.id);

            const skills = contractorSkills.map(s => ({
                serviceId: s.serviceId,
                serviceName: s.serviceName,
                hourlyRate: s.hourlyRate,
            }));

            const categorySkills = contractorSkills
                .filter(s => s.categorySlug)
                .map(s => ({
                    categorySlug: s.categorySlug!,
                    hourlyRate: s.hourlyRate,
                    dayRate: s.dayRate,
                }));

            const jobs = jobCounts.find(j => j.contractorId === contractor.id);

            const patterns = weeklyPatterns
                .filter(p => p.handymanId === contractor.id)
                .map(p => ({
                    dayOfWeek: p.dayOfWeek,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    isActive: p.isActive,
                }));

            const overrides = dateOverrides
                .filter(o => o.contractorId === contractor.id)
                .map(o => ({
                    date: o.date,
                    isAvailable: o.isAvailable,
                    startTime: o.startTime,
                    endTime: o.endTime,
                }));

            const earnings = earningsData.find(e => e.contractorId === contractor.id);
            const margin = marginData.find(m => m.contractorId === contractor.id);

            const isStaleAvailability = !contractor.lastAvailabilityRefresh ||
                (now.getTime() - new Date(contractor.lastAvailabilityRefresh).getTime()) > 7 * 24 * 60 * 60 * 1000;

            return {
                ...contractor,
                skills,
                categorySkills,
                totalJobs: jobs?.totalJobs || 0,
                weeklyPatterns: patterns,
                upcomingOverrides: overrides,
                earningsThisWeekPence: Number(earnings?.earningsThisWeekPence ?? 0),
                earningsThisMonthPence: Number(earnings?.earningsThisMonthPence ?? 0),
                earningsAllTimePence: Number(earnings?.earningsAllTimePence ?? 0),
                insuranceUrl: contractor.insuranceUrl,
                stripeAccountId: contractor.stripeAccountId,
                isStaleAvailability,
                verificationStatus: contractor.verificationStatus,
                avgMarginPercent: margin?.avgMarginPercent != null ? Number(margin.avgMarginPercent) : null,
                quotesWithThinMargin: Number(margin?.quotesWithThinMargin ?? 0),
            };
        });

        res.json(result);
    } catch (error) {
        console.error('[AdminContractors] Error fetching contractors:', error);
        res.status(500).json({ error: 'Failed to fetch contractors' });
    }
});

// GET /api/admin/contractors/:id
// Get single contractor with full details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const contractor = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.id, id),
            with: {
                user: true,
                skills: {
                    with: {
                        service: true
                    }
                }
            }
        });

        if (!contractor) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        // Get jobs
        const jobs = await db.select()
            .from(contractorJobs)
            .where(eq(contractorJobs.contractorId, id))
            .orderBy(desc(contractorJobs.createdAt))
            .limit(20);

        // Get weekly patterns
        const patterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, id));

        // Get date overrides
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(eq(contractorAvailabilityDates.contractorId, id))
            .orderBy(desc(contractorAvailabilityDates.date))
            .limit(30);

        res.json({
            ...contractor,
            recentJobs: jobs,
            weeklyPatterns: patterns,
            dateOverrides: overrides,
        });
    } catch (error) {
        console.error('[AdminContractors] Error fetching contractor:', error);
        res.status(500).json({ error: 'Failed to fetch contractor' });
    }
});

// POST /api/admin/contractors
// Create a new contractor (user + profile + skills)
router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            bio,
            businessName,
            postcode,
            city,
            radiusMiles = 10,
            profileImageUrl,
            heroImageUrl,
            hourlyRate,
            skills = [],
        } = req.body;

        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: 'firstName, lastName, and email are required' });
        }

        // Hash password (use random if not provided)
        const rawPassword = password || uuidv4().slice(0, 12);
        const passwordHash = await bcrypt.hash(rawPassword, 10);

        const userId = uuidv4();
        const profileId = uuidv4();
        const baseSlug = `${firstName}-${lastName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const slug = `${baseSlug}-${uuidv4().slice(0, 6)}`;

        // 1. Create user
        await db.insert(users).values({
            id: userId,
            email,
            firstName,
            lastName,
            phone,
            password: passwordHash,
            role: 'contractor',
            isActive: true,
        });

        // 2. Create handyman profile
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId,
            bio: bio || null,
            businessName: businessName || null,
            postcode: postcode || null,
            city: city || null,
            radiusMiles,
            hourlyRate: hourlyRate || null,
            slug,
            profileImageUrl: profileImageUrl || null,
            heroImageUrl: heroImageUrl || null,
            publicProfileEnabled: true,
            availabilityStatus: 'available',
            verificationStatus: 'unverified',
        });

        // 3. Create skills
        // Skills can come as an array of objects or a Record<slug, {enabled, ...}> from the form
        const skillsList: Array<{ categorySlug: string; hourlyRate?: string; dayRate?: string; proficiency?: string }> = [];
        if (Array.isArray(skills)) {
            skillsList.push(...skills);
        } else if (skills && typeof skills === 'object') {
            // Record format from form: { "plumbing": { enabled: true, hourlyRate: "", dayRate: "" }, ... }
            for (const [slug, val] of Object.entries(skills as Record<string, any>)) {
                if (val?.enabled) {
                    skillsList.push({ categorySlug: slug, hourlyRate: val.hourlyRate, dayRate: val.dayRate });
                }
            }
        }
        for (const skill of skillsList) {
            await db.insert(handymanSkills).values({
                id: uuidv4(),
                handymanId: profileId,
                categorySlug: skill.categorySlug,
                hourlyRate: skill.hourlyRate || null,
                dayRate: skill.dayRate || null,
                proficiency: skill.proficiency || 'competent',
            });
        }

        // Fetch the created contractor with profile
        const created = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.id, profileId),
            with: {
                user: true,
                skills: true,
            },
        });

        res.status(201).json(created);
    } catch (error: any) {
        console.error('[AdminContractors] Error creating contractor:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'A contractor with that email or slug already exists' });
        }
        res.status(500).json({ error: 'Failed to create contractor' });
    }
});

// PUT /api/admin/contractors/:id
// Update contractor profile and optionally user fields
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            firstName,
            lastName,
            email,
            phone,
            bio,
            businessName,
            postcode,
            city,
            radiusMiles,
            profileImageUrl,
            heroImageUrl,
            hourlyRate,
            skills,
        } = req.body;

        // Verify contractor exists
        const existing = await db.select({ userId: handymanProfiles.userId })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, id));

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        const userId = existing[0].userId;

        // Update user fields if any provided
        const userUpdates: Record<string, any> = {};
        if (firstName !== undefined) userUpdates.firstName = firstName;
        if (lastName !== undefined) userUpdates.lastName = lastName;
        if (email !== undefined) userUpdates.email = email;
        if (phone !== undefined) userUpdates.phone = phone;

        if (Object.keys(userUpdates).length > 0) {
            userUpdates.updatedAt = new Date();
            await db.update(users).set(userUpdates).where(eq(users.id, userId));
        }

        // Update profile fields if any provided
        const profileUpdates: Record<string, any> = {};
        if (bio !== undefined) profileUpdates.bio = bio;
        if (businessName !== undefined) profileUpdates.businessName = businessName;
        if (postcode !== undefined) profileUpdates.postcode = postcode;
        if (city !== undefined) profileUpdates.city = city;
        if (radiusMiles !== undefined) profileUpdates.radiusMiles = radiusMiles;
        if (profileImageUrl !== undefined) profileUpdates.profileImageUrl = profileImageUrl;
        if (heroImageUrl !== undefined) profileUpdates.heroImageUrl = heroImageUrl;
        if (hourlyRate !== undefined) profileUpdates.hourlyRate = hourlyRate;

        if (Object.keys(profileUpdates).length > 0) {
            profileUpdates.updatedAt = new Date();
            await db.update(handymanProfiles).set(profileUpdates).where(eq(handymanProfiles.id, id));
        }

        // Replace skills if provided
        if (skills !== undefined) {
            await db.delete(handymanSkills).where(eq(handymanSkills.handymanId, id));
            for (const skill of skills) {
                await db.insert(handymanSkills).values({
                    id: uuidv4(),
                    handymanId: id,
                    categorySlug: skill.categorySlug,
                    hourlyRate: skill.hourlyRate || null,
                    dayRate: skill.dayRate || null,
                    proficiency: skill.proficiency || 'competent',
                });
            }
        }

        // Return updated contractor
        const updated = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.id, id),
            with: {
                user: true,
                skills: true,
            },
        });

        res.json(updated);
    } catch (error: any) {
        console.error('[AdminContractors] Error updating contractor:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'A contractor with that email or slug already exists' });
        }
        res.status(500).json({ error: 'Failed to update contractor' });
    }
});

// PUT /api/admin/contractors/:id/availability
// Set contractor availability dates
router.put('/:id/availability', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { dates } = req.body;

        if (!dates || !Array.isArray(dates)) {
            return res.status(400).json({ error: 'dates array is required' });
        }

        // Verify contractor exists
        const existing = await db.select({ id: handymanProfiles.id })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, id));

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        const slotTimeMap: Record<string, { startTime: string; endTime: string }> = {
            am: { startTime: '08:00', endTime: '13:00' },
            pm: { startTime: '13:00', endTime: '18:00' },
            full_day: { startTime: '08:00', endTime: '18:00' },
        };

        const created = [];
        for (const entry of dates) {
            const { date, slot, isAvailable } = entry;
            const times = slotTimeMap[slot] || slotTimeMap.full_day;
            const dateObj = new Date(date);

            // Upsert: delete any existing entry for this contractor+date+slot, then insert
            // For simplicity, delete all entries for that date first
            await db.delete(contractorAvailabilityDates).where(
                and(
                    eq(contractorAvailabilityDates.contractorId, id),
                    eq(contractorAvailabilityDates.date, dateObj),
                )
            );

            const record = {
                id: uuidv4(),
                contractorId: id,
                date: dateObj,
                isAvailable: isAvailable ?? true,
                startTime: times.startTime,
                endTime: times.endTime,
            };

            await db.insert(contractorAvailabilityDates).values(record);
            created.push(record);
        }

        // Update lastAvailabilityRefresh on the profile
        await db.update(handymanProfiles)
            .set({ lastAvailabilityRefresh: new Date(), updatedAt: new Date() })
            .where(eq(handymanProfiles.id, id));

        res.json({ success: true, dates: created });
    } catch (error) {
        console.error('[AdminContractors] Error setting availability:', error);
        res.status(500).json({ error: 'Failed to set availability' });
    }
});

// POST /api/admin/contractors/:id/image
// Upload a profile image for a contractor
router.post('/:id/image', uploadProfileImage.single('image'), async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        // Verify contractor exists
        const existing = await db.select({ id: handymanProfiles.id })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, id));

        if (existing.length === 0) {
            // Clean up the uploaded file since the contractor doesn't exist
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Contractor not found' });
        }

        // Construct public URL (served via /api/media static mount)
        const profileImageUrl = `/api/media/contractors/profile/${req.file.filename}`;

        // Update the contractor's profileImageUrl
        await db.update(handymanProfiles)
            .set({ profileImageUrl, updatedAt: new Date() })
            .where(eq(handymanProfiles.id, id));

        console.log(`[AdminContractors] Profile image uploaded for ${id}: ${profileImageUrl}`);

        res.json({ url: profileImageUrl });
    } catch (error) {
        console.error('[AdminContractors] Error uploading profile image:', error);
        res.status(500).json({ error: 'Failed to upload profile image' });
    }
});

// DELETE /api/admin/contractors/:id
// Deactivate a contractor (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Look up the contractor profile to get userId
        const existing = await db.select({ userId: handymanProfiles.userId })
            .from(handymanProfiles)
            .where(eq(handymanProfiles.id, id));

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        const userId = existing[0].userId;

        // Soft delete: set user as inactive
        await db.update(users)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(users.id, userId));

        // Also mark profile availability as unavailable
        await db.update(handymanProfiles)
            .set({ availabilityStatus: 'inactive', updatedAt: new Date() })
            .where(eq(handymanProfiles.id, id));

        res.json({ success: true, message: 'Contractor deactivated' });
    } catch (error) {
        console.error('[AdminContractors] Error deactivating contractor:', error);
        res.status(500).json({ error: 'Failed to deactivate contractor' });
    }
});

export default router;
