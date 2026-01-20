
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const uploadRouter = Router();

// Configure Multer for local storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueName = `${nanoid()}${ext}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// POST /api/upload
// General purpose file upload
uploadRouter.post("/upload", upload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Return the path relative to the server/public or mock URL
        // In a real app, we'd upload to S3/Cloudinary.
        // For this local setup, let's assume we serve 'uploads' statically or just return the path.
        // We'll return a /uploads/filename URL assuming we mount the static dir.

        const fileUrl = `/uploads/${req.file.filename}`;

        console.log(`[Upload] File uploaded: ${fileUrl}`);

        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.filename,
            originalName: req.file.originalname
        });
    } catch (error) {
        console.error("[Upload] Error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

// B6: POST /api/jobs/:id/evidence
// Upload job completion evidence (photos)
uploadRouter.post("/jobs/:id/evidence", upload.array("files", 10), async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }

        // Generate URLs for uploaded files
        const fileUrls = req.files.map(file => `/uploads/${file.filename}`);

        console.log(`[Upload] Job evidence uploaded for job ${id}:`, fileUrls);

        // Update job with evidence URLs
        const { db } = await import('./db');
        const { contractorBookingRequests } = await import('../shared/schema');
        const { eq } = await import('drizzle-orm');

        const jobResults = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, id))
            .limit(1);

        if (jobResults.length === 0) {
            return res.status(404).json({ error: "Job not found" });
        }

        const existingUrls = jobResults[0].evidenceUrls || [];
        const updatedUrls = [...existingUrls, ...fileUrls];

        await db.update(contractorBookingRequests)
            .set({
                evidenceUrls: updatedUrls,
                updatedAt: new Date()
            })
            .where(eq(contractorBookingRequests.id, id));

        res.json({
            success: true,
            urls: fileUrls,
            totalEvidence: updatedUrls.length,
            message: `${fileUrls.length} file(s) uploaded successfully`
        });
    } catch (error) {
        console.error("[Upload] Job evidence error:", error);
        res.status(500).json({ error: "Evidence upload failed" });
    }
});

export default uploadRouter;
