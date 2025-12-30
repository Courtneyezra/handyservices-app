import { Router } from "express";
import { conversationEngine } from "./conversation-engine";
import { sendWhatsAppMessage } from "./meta-whatsapp";

export const whatsappRouter = Router();

// GET /api/whatsapp/test - Health check
whatsappRouter.get('/test', (req, res) => res.json({ status: 'active' }));

// POST /api/whatsapp/incoming - Twilio Webhook URL (legacy, kept for compatibility)
whatsappRouter.post('/incoming', async (req, res) => {
    try {
        console.log('[WhatsApp API] Incoming webhook:', req.body.From);
        await conversationEngine.handleInboundMessage(req.body);

        // Return TwiML empty response
        res.status(200).type('text/xml').send('<Response></Response>');
    } catch (error) {
        console.error("[WhatsApp API] Webhook Error:", error);
        res.status(500).send("Error processing webhook");
    }
});

// POST /api/whatsapp/send - Send a message via Meta Cloud API
whatsappRouter.post('/send', async (req, res) => {
    try {
        const { to, body, templateName, templateLanguage, templateComponents } = req.body;

        if (!to || !body) {
            return res.status(400).json({ error: "Missing 'to' or 'body'" });
        }

        console.log(`[WhatsApp API] Sending message to ${to} via Meta Cloud API`);

        const result = await sendWhatsAppMessage(to, body, {
            templateName,
            templateLanguage,
            templateComponents
        });

        res.json({ success: true, messageId: result.messages?.[0]?.id });
    } catch (error: any) {
        console.error("[WhatsApp API] Send Error:", error);
        res.status(500).json({ error: error.message || "Failed to send message" });
    }
});

// POST /api/whatsapp/send-template - Send a template message
whatsappRouter.post('/send-template', async (req, res) => {
    try {
        const { number, template, customerName, context, contentSid } = req.body;

        if (!number || !template) {
            return res.status(400).json({ error: "Missing number or template" });
        }

        console.log(`[WhatsApp API] Sending template '${template}' to ${number}`);

        let templateBody = "";
        let templateSid: string | undefined;
        let templateVars: Record<string, string> | undefined;

        const name = customerName || "there";
        const ctx = context || "the work required";

        switch (template) {
            case 'request_video':
                templateBody = `Hi ${name}, as discussed, please send us a video of ${ctx}. This will help us provide an accurate quote.`;
                templateSid = contentSid; // Use approved template SID when available
                if (templateSid) {
                    templateVars = { "1": name, "2": ctx };
                }
                break;
            case 'review_quote':
                templateBody = "Hi! Your quote is ready for review. Please check the link we sent.";
                break;
            default:
                return res.status(400).json({ error: "Invalid template ID" });
        }

        const result = await conversationEngine.sendMessage(number, templateBody, {
            templateSid,
            templateVars
        });

        res.json({ success: true, message: "Template sent", sid: result.sid });
    } catch (error) {
        console.error("[WhatsApp API] Template Send Error:", error);
        res.status(500).json({ error: "Failed to send template" });
    }
});

// GET /api/whatsapp/can-freeform/:phone - Check if freeform is allowed
whatsappRouter.get('/can-freeform/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const canFreeform = await conversationEngine.canSendFreeform(phone);
        res.json({ canFreeform });
    } catch (error) {
        console.error("[WhatsApp API] Check Error:", error);
        res.status(500).json({ error: "Failed to check status" });
    }
});
