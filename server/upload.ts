
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

export default uploadRouter;
