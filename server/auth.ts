
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "./db";
import { users, contractorSessions, handymanProfiles } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";

// ... existing code ...

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
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

    const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
    });

    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).user = user;
    next();
}


// Environment variables should be checked
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Google Auth will not work.");
}

const BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5000";

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID || "placeholder",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "placeholder",
            callbackURL: `${BASE_URL}/api/auth/google/callback`,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;
                if (!email) {
                    return done(new Error("No email found from Google"), undefined);
                }

                // 1. Check if user exists
                let user = await db.query.users.findFirst({
                    where: eq(users.email, email),
                });

                if (!user) {
                    // 2. If not, create new user (Default to contractor role for Google Sign-ups?)
                    // The request implies "onboard via google log in", so yes.
                    const userId = uuidv4();

                    await db.insert(users).values({
                        id: userId,
                        email: email,
                        firstName: profile.name?.givenName || "New",
                        lastName: profile.name?.familyName || "User",
                        role: "contractor", // Default role
                        emailVerified: true, // Google verified
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });

                    // Create empty handyman profile for them
                    await db.insert(handymanProfiles).values({
                        id: uuidv4(),
                        userId: userId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });

                    user = await db.query.users.findFirst({
                        where: eq(users.email, email),
                    });
                }

                if (!user) return done(new Error("Failed to create user"), undefined);

                return done(null, user);
            } catch (err) {
                return done(err as Error, undefined);
            }
        }
    )
);

// We are not using passport.session() with cookies, but we need these to satisfy passport if we used sessions.
// Since we are manual, we might skip these, but good to have if we switch.
passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.id, id),
        });
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});


/**
 * Generates a session token and stores it in the DB.
 * Returns the token string.
 */
export async function createSessionForUser(userId: string): Promise<string> {
    const token = (uuidv4() + '-' + uuidv4()).replace(/[^a-zA-Z0-9-]/g, '');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 day session

    await db.insert(contractorSessions).values({
        sessionToken: token,
        userId: userId,
        expiresAt: expiresAt,
    });

    return token;
}

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
    try {
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const { email, password } = validation.data;

        // Find user - ADMIN ONLY
        const userResult = await db.select().from(users)
            .where(and(
                eq(users.email, email.toLowerCase()),
                eq(users.role, 'admin')
            ))
            .limit(1);

        if (userResult.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userResult[0];

        if (!user.isActive) {
            return res.status(403).json({ error: 'Account deactivated' });
        }

        if (!user.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Create session
        const token = await createSessionForUser(user.id);

        // Update last login
        await db.update(users)
            .set({ lastLogin: new Date() })
            .where(eq(users.id, user.id));

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role
            }
        });

    } catch (error) {
        console.error('[AdminAuth] Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=google_auth_failed', session: false }),
    async (req: Request, res: Response) => {
        try {
            // User is verified and attached to req.user
            const user = req.user as typeof users.$inferSelect;

            // Create session manually (our custom bearer token system)
            const token = await createSessionForUser(user.id);

            // Redirect to frontend with token
            // We'll use a special frontend route to capture this token: /auth/callback
            const frontendUrl = process.env.NODE_ENV === 'production'
                ? '' // In prod, same domain usually, or separate if configured
                : 'http://localhost:5173'; // Dev default for Vite

            // Note: If served by the same express app (production), relative path works.
            // If dev, we might be on port 5000 (server) vs 5173 (client).
            // Let's assume relative path /auth/callback if we are serving client assets, 
            // but for safety in dev we might need absolute.

            // Best bet: use the referer or just /auth/callback and let the proxy handle it?
            // For now, let's just do a relative redirect which works if on same domain/port or proxy.
            res.redirect(`/auth/callback?token=${token}`);
        } catch (error) {
            console.error('Auth callback error:', error);
            res.redirect('/login?error=session_creation_failed');
        }
    }
);

export default router;
