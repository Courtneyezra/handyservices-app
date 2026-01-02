/**
 * Eleven Labs Lead Capture Endpoint
 * Handles lead capture tool calls from Eleven Labs agents
 */

import { Router } from 'express';
import { db } from '../db';
import { leads } from '../../shared/schema';

const router = Router();

/**
 * POST /api/eleven-labs/lead
 * Captures lead information from Eleven Labs agent tool call
 */
router.post('/lead', async (req, res) => {
    try {
        const { name, phone, job_description, urgency, conversation_id } = req.body;

        console.log('[ElevenLabs-Lead] Capture request:', {
            name,
            phone,
            job_description,
            urgency,
            conversation_id
        });

        // Validate required fields (phone is required by Eleven Labs tool)
        if (!phone) {
            return res.status(400).json({
                error: 'Phone number is required'
            });
        }


        // Create lead record
        const leadId = `lead_el_${Date.now()}`;

        await db.insert(leads).values({
            id: leadId,
            customerName: name || 'Unknown',
            phone: phone,
            source: 'eleven_labs',
            jobDescription: job_description || 'Lead captured via Eleven Labs agent',
            status: urgency === 'urgent' || urgency === 'immediate' ? 'urgent' : 'review',
            elevenLabsConversationId: conversation_id || null,
        });

        console.log('[ElevenLabs-Lead] Lead created:', leadId);

        // Return success response in format Eleven Labs expects
        res.json({
            success: true,
            lead_id: leadId,
            message: name
                ? `Thank you ${name}, I've captured your details. Someone will be in touch soon.`
                : `Thank you, I've captured your details. Someone will be in touch soon.`
        });

    } catch (error) {
        console.error('[ElevenLabs-Lead] Error capturing lead:', error);
        res.status(500).json({
            error: 'Failed to capture lead',
            message: 'I apologize, there was an error saving your information. Please try calling back.'
        });
    }
});

export default router;
