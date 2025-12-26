
import { Router } from "express";
import { whatsAppManager } from "./whatsapp";

export const whatsappRouter = Router();

// POST /api/whatsapp/send-template
// Sends a pre-defined template message to a user
whatsappRouter.post('/send-template', async (req, res) => {
    try {
        const { number, template } = req.body;

        if (!number || !template) {
            return res.status(400).json({ error: "Missing number or template" });
        }

        console.log(`[WhatsApp API] Sending template '${template}' to ${number}`);

        let messageBody = "";
        switch (template) {
            case 'request_video':
                messageBody = "As discussed, please send us over a video and give video guidelines.";
                break;
            case 'review_quote':
                messageBody = "Hi! Your quote is ready for review. Please check the link we sent.";
                break;
            default:
                return res.status(400).json({ error: "Invalid template ID" });
        }

        await whatsAppManager.sendMessage(number, messageBody);

        res.json({ success: true, message: "Template sent" });
    } catch (error) {
        console.error("WhatsApp Send Validation Error:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

// Webhook for standard intake (optional if using client-side listeners directly, but good for cleanliness)
whatsappRouter.post('/intake', (req, res) => {
    // This would be for external webhooks if we weren't using whatsapp-web.js directly in the server process
    res.json({ status: "listening" });
});
