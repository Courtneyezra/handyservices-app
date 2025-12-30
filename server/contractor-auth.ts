import { Router, Request, Response, NextFunction } from 'express';
import { db } from './db';
import { users, handymanProfiles } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
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
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

// Simple session store (in production, use Redis or database sessions)
const contractorSessions: Map<string, { userId: string; expiresAt: Date }> = new Map();

// Generate session token
function generateSessionToken(): string {
    return uuidv4() + '-' + uuidv4();
}

// Auth middleware for contractor routes
export async function requireContractorAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!sessionToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const session = contractorSessions.get(sessionToken);
    if (!session || session.expiresAt < new Date()) {
        contractorSessions.delete(sessionToken);
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

// POST /api/contractor/register - Create new contractor account
router.post('/register', async (req: Request, res: Response) => {
    try {
        // Validate request body
        const validation = registerSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors
            });
        }

        const { email, password, firstName, lastName, phone, postcode } = validation.data;

        // Check if email already exists
        const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

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

        // Create handyman profile (linked to user)
        const profileId = uuidv4();
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId,
            postcode,
            radiusMiles: 10, // Default radius
        });

        // Create session
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        contractorSessions.set(sessionToken, { userId, expiresAt });

        // Update last login
        await db.update(users)
            .set({ lastLogin: new Date() })
            .where(eq(users.id, userId));

        res.status(201).json({
            success: true,
            token: sessionToken,
            user: {
                id: userId,
                email: email.toLowerCase(),
                firstName,
                lastName,
                role: 'contractor',
            },
            profileId,
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
        contractorSessions.set(sessionToken, { userId: user.id, expiresAt });

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
        contractorSessions.delete(sessionToken);
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
        const { firstName, lastName, phone, bio, address, city, postcode, radiusMiles } = req.body;

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
            await db.update(handymanProfiles)
                .set({
                    bio: bio || undefined,
                    address: address || undefined,
                    city: city || undefined,
                    postcode: postcode || undefined,
                    ...(radiusMiles !== undefined && { radiusMiles }),
                    ...(req.body.latitude !== undefined && { latitude: req.body.latitude.toString() }),
                    ...(req.body.longitude !== undefined && { longitude: req.body.longitude.toString() }),
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
