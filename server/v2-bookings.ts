import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { v2Bookings } from "@shared/schema";
import { desc } from "drizzle-orm";

const router = Router();

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
