import { Router } from "express";
import { db } from "./db";
import { partnerEnquiries } from "@shared/schema";
import { z } from "zod";

export const partnerRouter = Router();

// ---------------------------------------------------------------------------
// Validation Schema
// ---------------------------------------------------------------------------

const enquireSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone number is required"),
  territoryInterest: z.string().optional(),
  investmentBudget: z.string().optional(),
  currentSituation: z.string().optional(),
  message: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/partner/enquire — Submit a partner enquiry
// ---------------------------------------------------------------------------

partnerRouter.post("/api/partner/enquire", async (req, res) => {
  try {
    const parsed = enquireSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [enquiry] = await db
      .insert(partnerEnquiries)
      .values({
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        territoryInterest: parsed.data.territoryInterest || null,
        investmentBudget: parsed.data.investmentBudget || null,
        currentSituation: parsed.data.currentSituation || null,
        message: parsed.data.message || null,
      })
      .returning();

    return res.status(201).json({ ok: true, id: enquiry.id });
  } catch (err) {
    console.error("[partner-routes] Error submitting enquiry:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
