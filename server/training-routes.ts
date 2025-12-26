import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { detectMultipleTasks } from './skuDetector';

const trainingRouter = Router();

const FILES = {
    synthetic: path.join(process.cwd(), 'scripts', 'test-data.json'),
    real: path.join(process.cwd(), 'scripts', 'real-data.json'),
    twilio: path.join(process.cwd(), 'scripts', 'twilio-import.json'),
};

// Helper: Read all scenarios
function getAllScenarios() {
    let all: any[] = [];

    for (const [source, filepath] of Object.entries(FILES)) {
        if (fs.existsSync(filepath)) {
            const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
            const normalized = (Array.isArray(data) ? data : (data.scenarios || data.transcripts || [])).map((item: any, index: number) => ({
                ...item,
                id: `${source}-${index}`, // Stable ID based on position
                source
            }));
            all = [...all, ...normalized];
        }
    }
    return all;
}

// GET /api/training/scenarios
trainingRouter.get('/api/training/scenarios', (req, res) => {
    try {
        const scenarios = getAllScenarios();
        res.json({ scenarios });
    } catch (error) {
        console.error("Failed to fetch scenarios:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

// POST /api/training/scenarios/:id/update
trainingRouter.post('/api/training/scenarios/:id/update', (req, res) => {
    try {
        const { id } = req.params;
        const { expectedRoute, category, ignore } = req.body;
        const [source, indexStr] = id.split('-');
        const index = parseInt(indexStr, 10);

        if (!FILES[source as keyof typeof FILES]) {
            return res.status(400).json({ error: "Invalid source" });
        }

        const filepath = FILES[source as keyof typeof FILES];
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

        // Handle different JSON structures (array vs object wrapper)
        let list = Array.isArray(data) ? data : (data.scenarios || data.transcripts);

        if (!list || !list[index]) {
            return res.status(404).json({ error: "Scenario not found" });
        }

        // Update fields
        if (expectedRoute) list[index].expectedRoute = expectedRoute;
        if (category) list[index].category = category;
        if (ignore !== undefined) list[index].ignore = ignore;

        // Save back
        if (Array.isArray(data)) {
            fs.writeFileSync(filepath, JSON.stringify(list, null, 2));
        } else {
            if (data.scenarios) data.scenarios = list;
            if (data.transcripts) data.transcripts = list;
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        }

        res.json({ success: true, item: list[index] });

    } catch (error) {
        console.error("Update failed:", error);
        res.status(500).json({ error: "Update failed" });
    }
});

// POST /api/training/test-one
trainingRouter.post('/api/training/test-one', async (req, res) => {
    try {
        const { transcript } = req.body;
        if (!transcript) return res.status(400).json({ error: "Transcript required" });

        const result = await detectMultipleTasks(transcript);
        res.json({ result });
    } catch (error) {
        console.error("Test failed:", error);
        res.status(500).json({ error: "Analysis failed" });
    }
});

export { trainingRouter };
