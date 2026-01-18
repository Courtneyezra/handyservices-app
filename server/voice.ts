
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { openai } from "./openai";

const router = Router();
const upload = multer({ dest: "uploads/" });

// POST /api/transcribe
router.post("/transcribe", upload.single("file"), async (req, res) => {
    let filePath = "";
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

        // Rename file to have an extension so OpenAI accepts it
        const originalPath = req.file.path;
        filePath = `${originalPath}.webm`;
        fs.renameSync(originalPath, filePath);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });

        // Cleanup
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ text: transcription.text });
    } catch (error: any) {
        console.error("Transcription error details:", error?.response?.data || error.message);
        // Cleanup on error too
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        } else if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: "Transcription failed" });
    }
});

export default router;
