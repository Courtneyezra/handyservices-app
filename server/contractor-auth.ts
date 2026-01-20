import { Router, Request, Response, NextFunction } from 'express';
import { geocodeAddress } from './lib/geocoding';
import { AutoSkuGenerator } from './services/auto-sku-generator';
import { db } from './db';
import { users, handymanProfiles, contractorSessions, productizedServices, handymanSkills } from '../shared/schema';
import { eq, and, or } from 'drizzle-orm';

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const router = Router();

// Validation schemas
const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional(),
    postcode: z.string().optional(),
    slug: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

// Simple session store (in production, use Redis or database sessions)
// const contractorSessions: Map<string, { userId: string; expiresAt: Date }> = new Map();


// Generate session token
function generateSessionToken(): string {
    // Ensure absolutely no invalid header characters
    return (uuidv4() + '-' + uuidv4()).replace(/[^a-zA-Z0-9-]/g, '');
}

// Auth middleware for contractor routes
export async function requireContractorAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!sessionToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const sessionResult = await db.select().from(contractorSessions).where(eq(contractorSessions.sessionToken, sessionToken)).limit(1);
    const session = sessionResult[0];

    if (!session || session.expiresAt < new Date()) {
        if (session) {
            await db.delete(contractorSessions).where(eq(contractorSessions.sessionToken, sessionToken));
        }
        return res.status(401).json({ error: 'Session expired' });
    }


    // Attach user to request
    const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (user.length === 0 || user[0].role !== 'contractor') {
        return res.status(401).json({ error: 'Invalid session' });
    }

    (req as any).contractor = user[0];
    (req as any).sessionToken = sessionToken;
    next();
}

// Update Contractor Skills & Rates
router.put('/skills', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { services } = req.body; // Array of { trade: string, hourlyRatePence: number }

        if (!Array.isArray(services)) {
            return res.status(400).json({ error: "Invalid format" });
        }

        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id)
        });

        if (!profile) return res.status(404).json({ error: "Profile not found" });

        // Transaction to update skills
        await db.transaction(async (tx) => {
            // Remove existing skills
            await tx.delete(handymanSkills).where(eq(handymanSkills.handymanId, profile.id));

            // Re-add selected skills with new rates
            for (const s of services) {
                // Find service ID by SKU/Category
                // Note: In a real app we might want a stricter lookup, but for now we search by name/sku
                // We assume 'trade' maps to a serviceSku or category. 
                // Let's search by 'category' or 'skuCode' matching the trade ID (e.g. 'plumbing')

                const service = await tx.select().from(productizedServices)
                    .where(
                        or(
                            eq(productizedServices.skuCode, s.trade.toUpperCase()), // Try SKU
                            eq(productizedServices.category, s.trade.toLowerCase()) // Try Category
                        )
                    )
                    .limit(1);

                if (service.length > 0) {
                    await tx.insert(handymanSkills).values({
                        id: uuidv4(),
                        handymanId: profile.id,
                        serviceId: service[0].id,
                        hourlyRate: Math.round(s.hourlyRatePence / 100)
                    });
                }
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating skills:', error);
        res.status(500).json({ error: "Failed to update skills" });

    }
});

// GET /api/contractor/check-slug - Check if slug is available
router.get('/check-slug', async (req: Request, res: Response) => {
    try {
        const { slug } = req.query;
        if (!slug || typeof slug !== 'string') {
            return res.status(400).json({ error: 'Slug is required' });
        }

        const existing = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug)
        });

        res.json({ available: !existing });
    } catch (error) {
        console.error('Check slug error:', error);
        res.status(500).json({ error: "Failed to check slug" });
    }
});

// POST /api/contractor/register - Create new contractor account
router.post('/register', async (req: Request, res: Response) => {
    try {
        // Extended schema for consolidated registration
        const extendedRegisterSchema = registerSchema.extend({
            city: z.string().optional(),
            radiusMiles: z.number().optional(),
            bio: z.string().optional(),
            businessName: z.string().optional(), // Added
            latitude: z.number().optional(),
            longitude: z.number().optional(),
            services: z.array(z.object({
                trade: z.string(),
                hourlyRatePence: z.number(),
                dayRatePence: z.number()
            })).optional()
        });

        // Validate request body
        const validation = extendedRegisterSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors
            });
        }

        const { email, password, firstName, lastName, phone, postcode, slug, city, radiusMiles, bio, services, businessName, latitude: latArg, longitude: lngArg } = validation.data;

        // Check if email already exists
        const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Check if slug already exists (to avoid 500)
        if (slug) {
            const existingSlug = await db.query.handymanProfiles.findFirst({
                where: eq(handymanProfiles.slug, slug)
            });
            if (existingSlug) {
                return res.status(409).json({ error: 'Business URL is already taken. Please choose another.' });
            }
        }

        // Transaction removed as neon-http driver doesn't support them
        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user
        const userId = uuidv4();
        await db.insert(users).values({
            id: userId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            phone,
            password: hashedPassword,
            role: 'contractor',
            isActive: true,
            emailVerified: false,
        });

        // Handle geolocation
        let latitude: string | null = latArg ? latArg.toString() : null;
        let longitude: string | null = lngArg ? lngArg.toString() : null;

        if (!latitude && !longitude && postcode) {
            try {
                const geo = await geocodeAddress(postcode);
                if (geo) {
                    latitude = geo.lat.toString();
                    longitude = geo.lng.toString();
                }
            } catch (geoError) {
                console.warn("Geocoding failed, continuing without coords:", geoError);
                // Continue without valid coords, don't crash registration
            }
        }

        // Create handyman profile (linked to user)
        const profileId = uuidv4();
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId,
            postcode,
            city: city, // From new payload
            bio: bio,   // From new payload
            businessName: businessName || undefined,
            latitude,
            longitude,
            radiusMiles: radiusMiles || 10, // From new payload or default
            slug: slug || undefined,
        });

        // Generates SKUs if services are provided
        if (services && services.length > 0) {
            try {
                await AutoSkuGenerator.generateForContractor({
                    userId,
                    profileId,
                    services
                });
            } catch (skuError) {
                console.error("[ContractorAuth] Failed to generate SKUs:", skuError);
                // Non-blocking error, user is still created
            }
        }

        // Create session
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await db.insert(contractorSessions).values({
            sessionToken,
            userId,
            expiresAt
        });

        // Update last login
        await db.update(users)
            .set({ lastLogin: new Date() })
            .where(eq(users.id, userId));

        const result = {
            userId,
            sessionToken,
            profileId
        };

        res.status(201).json({
            success: true,
            token: result.sessionToken,
            user: {
                id: result.userId,
                email: email.toLowerCase(),
                firstName,
                lastName,
                role: 'contractor',
            },
            profileId: result.profileId,
        });

    } catch (error) {
        console.error('[ContractorAuth] Registration error:', error);
        res.status(500).json({ error: 'Failed to register' });
    }
});


// POST /api/contractor/login - Authenticate contractor
router.post('/login', async (req: Request, res: Response) => {
    try {
        // Validate request body
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors
            });
        }

        const { email, password } = validation.data;

        // Find user
        const userResult = await db.select().from(users)
            .where(and(
                eq(users.email, email.toLowerCase()),
                eq(users.role, 'contractor')
            ))
            .limit(1);

        if (userResult.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = userResult[0];

        // Check if account is active
        if (!user.isActive) {
            return res.status(403).json({ error: 'Account is deactivated' });
        }

        // Verify password
        if (!user.password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, user.id))
            .limit(1);

        // Create session
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await db.insert(contractorSessions).values({
            sessionToken,
            userId: user.id,
            expiresAt
        });


        // Update last login
        await db.update(users)
            .set({ lastLogin: new Date() })
            .where(eq(users.id, user.id));

        res.json({
            success: true,
            token: sessionToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
            profileId: profileResult[0]?.id || null,
        });
    } catch (error) {
        console.error('[ContractorAuth] Login error:', error);
        res.status(500).json({ error: 'Failed to login' });
    }
});

// POST /api/contractor/logout - End session
router.post('/logout', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (sessionToken) {
        await db.delete(contractorSessions).where(eq(contractorSessions.sessionToken, sessionToken));
    }


    res.json({ success: true });
});

// GET /api/contractor/me - Get current authenticated contractor
router.get('/me', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;

        // Get contractor profile with skills
        const profileResult = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.userId, contractor.id),
            with: {
                skills: {
                    with: {
                        service: true
                    }
                },
                availability: true
            }
        });

        res.json({
            user: {
                id: contractor.id,
                email: contractor.email,
                firstName: contractor.firstName,
                lastName: contractor.lastName,
                phone: contractor.phone,
                role: contractor.role,
                emailVerified: contractor.emailVerified,
            },
            profile: profileResult || null,
        });
    } catch (error) {
        console.error('[ContractorAuth] Get me error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// PUT /api/contractor/profile - Update contractor profile
router.put('/profile', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { firstName, lastName, phone, bio, address, city, postcode, radiusMiles, hourlyRate, slug, publicProfileEnabled, heroImageUrl, socialLinks, skills,
            trustBadges, availabilityStatus, introVideoUrl, aiRules, mediaGallery, beforeAfterGallery,
            dbsCertificateUrl, identityDocumentUrl, publicLiabilityInsuranceUrl, publicLiabilityExpiryDate, verificationStatus } = req.body;

        // Update user info
        if (firstName || lastName || phone) {
            await db.update(users)
                .set({
                    firstName: firstName || undefined,
                    lastName: lastName || undefined,
                    phone: phone || undefined,
                    updatedAt: new Date()
                })
                .where(eq(users.id, contractor.id));
        }

        // Update profile info
        if (contractor.role === 'contractor') {
            const profile = await db.query.handymanProfiles.findFirst({
                where: eq(handymanProfiles.userId, contractor.id),
            });

            if (!profile) {
                return res.status(404).json({ error: 'Contractor profile not found' });
            }

            // Handle skills update/insertion
            if (skills && Array.isArray(skills)) {
                // First, delete existing skills for this handyman
                await db.delete(handymanSkills).where(eq(handymanSkills.handymanId, profile.id));

                // Then, insert new skills
                for (const s of skills) {
                    // Assuming s has serviceId and hourlyRatePence
                    // You might need to validate serviceId exists
                    await db.insert(handymanSkills).values({
                        id: uuidv4(),
                        handymanId: profile.id,
                        serviceId: s.serviceId, // Assuming s.serviceId is provided
                        hourlyRate: Math.round(s.hourlyRatePence / 100) // Convert back to pounds for storage or keep consistent
                    });
                }
            }

            // Geocode if postcode changed
            let newLat = req.body.latitude ? req.body.latitude.toString() : undefined;
            let newLng = req.body.longitude ? req.body.longitude.toString() : undefined;

            if (postcode && postcode !== profile.postcode) {
                const geo = await geocodeAddress(postcode);
                if (geo) {
                    newLat = geo.lat.toString();
                    newLng = geo.lng.toString();
                }
            }

            await db.update(handymanProfiles)
                .set({
                    bio: bio || undefined,
                    address: address || undefined,
                    city: city || undefined,
                    postcode: postcode || undefined,
                    ...(radiusMiles !== undefined && { radiusMiles }),
                    ...(hourlyRate !== undefined && { hourlyRate }),
                    ...(newLat !== undefined && { latitude: newLat }),
                    ...(newLng !== undefined && { longitude: newLng }),
                    ...(slug !== undefined && { slug }),
                    ...(publicProfileEnabled !== undefined && { publicProfileEnabled }),
                    ...(heroImageUrl !== undefined && { heroImageUrl }),
                    ...(req.body.profileImageUrl !== undefined && { profileImageUrl: req.body.profileImageUrl }),

                    ...(socialLinks !== undefined && { socialLinks }),
                    ...(mediaGallery !== undefined && { mediaGallery }),
                    ...(trustBadges !== undefined && { trustBadges }),
                    ...(availabilityStatus !== undefined && { availabilityStatus }),
                    ...(introVideoUrl !== undefined && { introVideoUrl }),
                    ...(req.body.whatsappNumber !== undefined && { whatsappNumber: req.body.whatsappNumber }),
                    ...(req.body.reviews !== undefined && { reviews: req.body.reviews }),
                    ...(aiRules !== undefined && { aiRules }),
                    ...(beforeAfterGallery !== undefined && { beforeAfterGallery }),
                    ...(dbsCertificateUrl !== undefined && { dbsCertificateUrl }),
                    ...(identityDocumentUrl !== undefined && { identityDocumentUrl }),
                    ...(publicLiabilityInsuranceUrl !== undefined && { publicLiabilityInsuranceUrl }),
                    ...(publicLiabilityExpiryDate !== undefined && { publicLiabilityExpiryDate: publicLiabilityExpiryDate ? new Date(publicLiabilityExpiryDate) : null }),
                    ...(verificationStatus !== undefined && { verificationStatus }),

                    updatedAt: new Date(),
                })
                .where(eq(handymanProfiles.userId, contractor.id));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[ContractorAuth] Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// PUT /api/contractor/password - Change password
router.put('/password', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        // Verify current password
        const user = await db.select().from(users).where(eq(users.id, contractor.id)).limit(1);
        if (!user[0]?.password) {
            return res.status(400).json({ error: 'Cannot change password' });
        }

        const passwordValid = await bcrypt.compare(currentPassword, user[0].password);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await db.update(users)
            .set({ password: hashedPassword, updatedAt: new Date() })
            .where(eq(users.id, contractor.id));

        res.json({ success: true });
    } catch (error) {
        console.error('[ContractorAuth] Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

export default router;
