import { Router } from "express";
import { detectWithContext, detectMultipleTasks } from "./skuDetector";

export const testRouter = Router();

// Test Lab Endpoint: Analyze a specific turn with history
testRouter.post('/api/test/analyze-turn', async (req, res) => {
    console.log("[TestLab] Received analyze-turn request", req.body);
    try {
        const { message, history, leadType, isElderly } = req.body;

        if (!message) {
            console.warn("[TestLab] Missing message in request");
            return res.status(400).json({ error: "Message is required" });
        }

        const context = {
            history: history || [],
            leadType: leadType || 'Unknown',
            isElderly: isElderly || false
        };

        console.log("[TestLab] Detecting with context...");
        const result = await detectWithContext(message, context);
        console.log("[TestLab] Result:", result.nextRoute, result.suggestedScript);

        res.json({
            message,
            result,
            // Return accumulated history for the frontend to manage state
            newHistory: [...context.history, message].slice(-5) // Keep last 5 turns
        });

    } catch (error) {
        console.error("Test Lab Analysis Failed:", error);
        res.status(500).json({ error: "Analysis failed" });
    }
});

// Test Lab Endpoint: Analyze Multi-Task
testRouter.post('/api/test/analyze-multi', async (req, res) => {
    console.log("[TestLab] Received analyze-multi request", req.body);
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });

        const result = await detectMultipleTasks(message);
        console.log("[TestLab] Multi Result:", result.nextRoute, result.tasks.length + " tasks");

        res.json({ result });
    } catch (error) {
        console.error("Test Lab Multi Analysis Failed:", error);
        res.status(500).json({ error: "Analysis failed" });
    }
});
