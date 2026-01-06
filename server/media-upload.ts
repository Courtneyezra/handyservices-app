import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { requireContractorAuth } from './contractor-auth';

const router = Router();

// Configure Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'server/storage/media/contractors/hero');
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
        const ext = path.extname(file.originalname);
        cb(null, `hero-${uniqueSuffix}${ext}`);
    }
});

// File filter (images only)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!') as any, false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});



// Configure Multer storage for profile images
const profileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'server/storage/media/contractors/profile');
        // Ensure directory exists
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

const uploadProfile = multer({
    storage: profileStorage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// POST /api/contractor/media/hero-upload
router.post('/hero-upload', requireContractorAuth, upload.single('heroImage'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Construct public URL
        const publicUrl = `/api/media/contractors/hero/${req.file.filename}`;

        res.json({ url: publicUrl });
    } catch (error) {
        console.error('Hero upload error:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// POST /api/contractor/media/profile-upload
router.post('/profile-upload', requireContractorAuth, uploadProfile.single('profileImage'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Construct public URL
        const publicUrl = `/api/media/contractors/profile/${req.file.filename}`;

        res.json({ url: publicUrl });
    } catch (error) {
        console.error('Profile upload error:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

export default router;
