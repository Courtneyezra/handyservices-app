import { Router } from "express";
import { db } from "./db";
import { jobApplications } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "./auth";

export const careersRouter = Router();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const applySchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email().optional().or(z.literal("")),
  postcode: z.string().optional(),
  trades: z.array(z.string()).optional(),
  yearsExperience: z.enum(["1-2", "3-5", "5-10", "10+"]).optional(),
  hasOwnTools: z.boolean().optional(),
  hasDrivingLicence: z.boolean().optional(),
  hasCSCS: z.boolean().optional(),
  currentSituation: z.enum(["employed", "self-employed", "looking"]).optional(),
  source: z
    .enum(["indeed", "facebook", "gumtree", "referral", "direct", "checkatrade", "other"])
    .optional(),
  coverNote: z.string().optional(),
});

const updateApplicationSchema = z.object({
  status: z
    .enum(["new", "phone_screened", "assessment_scheduled", "assessed", "offer_made", "hired", "rejected", "withdrawn"])
    .optional(),
  statusNotes: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  assessmentSilicone: z.number().int().min(1).max(5).optional(),
  assessmentCarpentry: z.number().int().min(1).max(5).optional(),
  assessmentPainting: z.number().int().min(1).max(5).optional(),
  assessmentMounting: z.number().int().min(1).max(5).optional(),
  assessmentNotes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/careers/apply — Public application submission
// ---------------------------------------------------------------------------

careersRouter.post("/api/careers/apply", async (req, res) => {
  try {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const data = parsed.data;

    const [application] = await db
      .insert(jobApplications)
      .values({
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        email: data.email || null,
        postcode: data.postcode || null,
        trades: data.trades || null,
        yearsExperience: data.yearsExperience || null,
        hasOwnTools: data.hasOwnTools ?? null,
        hasDrivingLicence: data.hasDrivingLicence ?? null,
        hasCSCS: data.hasCSCS ?? null,
        currentSituation: data.currentSituation || null,
        source: data.source || null,
        coverNote: data.coverNote || null,
      })
      .returning();

    console.log(`[Careers] New application received: ${application.id} — ${data.firstName} ${data.lastName}`);

    return res.json({ success: true, applicationId: application.id });
  } catch (error) {
    console.error("[Careers] Application submission error:", error);
    return res.status(500).json({ error: "Failed to submit application" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/careers/applications — List all applications (admin)
// ---------------------------------------------------------------------------

careersRouter.get("/api/admin/careers/applications", requireAdmin, async (req, res) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    const applications = statusFilter
      ? await db.select().from(jobApplications).where(eq(jobApplications.status, statusFilter as any)).orderBy(desc(jobApplications.appliedAt))
      : await db.select().from(jobApplications).orderBy(desc(jobApplications.appliedAt));

    return res.json(applications);
  } catch (error) {
    console.error("[Careers] Failed to fetch applications:", error);
    return res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/careers/applications/:id — Single application (admin)
// ---------------------------------------------------------------------------

careersRouter.get("/api/admin/careers/applications/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [application] = await db
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.id, id));

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    return res.json(application);
  } catch (error) {
    console.error("[Careers] Failed to fetch application:", error);
    return res.status(500).json({ error: "Failed to fetch application" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/careers/applications/:id — Update application (admin)
// ---------------------------------------------------------------------------

careersRouter.patch("/api/admin/careers/applications/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const parsed = updateApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // Build the update payload
    const updatePayload: Record<string, any> = {
      ...data,
      updatedAt: new Date(),
    };

    // Set milestone timestamps based on status transitions
    if (data.status === "phone_screened") {
      updatePayload.screenedAt = new Date();
    }
    if (data.status === "assessed") {
      updatePayload.assessedAt = new Date();
    }
    if (data.status === "hired") {
      updatePayload.hiredAt = new Date();
    }

    const [updated] = await db
      .update(jobApplications)
      .set(updatePayload)
      .where(eq(jobApplications.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Application not found" });
    }

    console.log(`[Careers] Application ${id} updated — status: ${updated.status}`);

    return res.json(updated);
  } catch (error) {
    console.error("[Careers] Failed to update application:", error);
    return res.status(500).json({ error: "Failed to update application" });
  }
});
