import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { db } from "./db";
import { v2Bookings } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

const router = Router();

// Stripe instance — lazy singleton, matches the pattern in stripe-routes.ts so
// /v2 payments inherit the same secret-key validation logic.
function getStripe(): Stripe | null {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "")
        .replace(/^["']|["']$/g, "")
        .trim();
    if (!stripeSecretKey || !stripeSecretKey.startsWith("sk_")) {
        return null;
    }
    return new Stripe(stripeSecretKey);
}

function makeRef(): string {
    const year = new Date().getFullYear();
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return `HS-${year}-${id}`;
}

router.post("/api/v2/bookings", async (req: Request, res: Response) => {
    try {
        const body = req.body ?? {};
        const reference = makeRef();
        const [row] = await db.insert(v2Bookings).values({
            reference,
            customerFirstName: body.contact?.firstName ?? "",
            customerLastName: body.contact?.lastName ?? "",
            customerEmail: body.contact?.email ?? "",
            customerPhone: body.contact?.phone ?? "",
            addressLine1: body.address?.line1 ?? "",
            addressLine2: body.address?.line2 ?? null,
            town: body.address?.town ?? "",
            postcode: body.address?.postcode ?? "",
            services: body.services ?? [],
            slotDate: body.slotDate ?? "",
            slotLabel: body.slotLabel ?? "",
            slotSurcharge: body.slotSurcharge ?? 0,
            subtotal: body.subtotal ?? 0,
            visitFee: body.visitFee ?? 0,
            weekendSurcharge: body.weekendSurcharge ?? 0,
            eveningSurcharge: body.eveningSurcharge ?? 0,
            total: body.total ?? 0,
            variant: body.variant ?? null,
            notes: body.notes ?? null,
        }).returning();
        res.json({ id: row.id, reference, total: row.total });
    } catch (e) {
        console.error("v2 booking failed", e);
        res.status(500).json({ error: "booking_failed" });
    }
});

// Create a Stripe PaymentIntent for an existing pending_payment booking.
// Full-amount upfront — no deposit logic. Returns the clientSecret which the
// client-side Stripe Elements use to confirm the payment.
router.post("/api/v2/bookings/:id/payment-intent", async (req: Request, res: Response) => {
    try {
        const stripe = getStripe();
        if (!stripe) {
            console.error("[v2 payment-intent] Stripe not initialised — STRIPE_SECRET_KEY missing or malformed");
            return res.status(500).json({ error: "stripe_not_configured" });
        }

        const { id } = req.params;
        const [row] = await db
            .select()
            .from(v2Bookings)
            .where(eq(v2Bookings.id, id))
            .limit(1);

        if (!row) {
            return res.status(404).json({ error: "booking_not_found" });
        }
        if (row.status !== "pending_payment") {
            return res.status(400).json({ error: "booking_not_payable", status: row.status });
        }

        const amountPence = Math.round(Number(row.total) * 100);
        if (!Number.isFinite(amountPence) || amountPence <= 0) {
            return res.status(400).json({ error: "invalid_amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountPence,
            currency: "gbp",
            automatic_payment_methods: { enabled: true },
            metadata: {
                bookingId: row.id,
                reference: row.reference,
                source: "v2",
            },
        });

        await db
            .update(v2Bookings)
            .set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() })
            .where(eq(v2Bookings.id, row.id));

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        });
    } catch (e) {
        console.error("v2 payment-intent failed", e);
        res.status(500).json({ error: "payment_intent_failed" });
    }
});

router.get("/api/v2/bookings", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(v2Bookings).orderBy(desc(v2Bookings.createdAt));
        res.json(rows);
    } catch (e) {
        console.error("v2 bookings list failed", e);
        res.status(500).json({ error: "list_failed" });
    }
});

export default router;
