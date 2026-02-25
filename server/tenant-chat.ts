/**
 * Tenant Chat Handler
 *
 * Integrates the AI Orchestrator with WhatsApp for tenant issue reporting.
 * Handles the full conversation flow from issue report to resolution.
 */

import { db } from './db';
import { tenants, properties, leads, tenantIssues, conversations, messages } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getOrchestrator, type IncomingMessage as AIIncomingMessage, type OrchestratorResponse } from './ai';
import { sendWhatsAppMessage } from './meta-whatsapp';
import { normalizePhoneNumber } from './phone-utils';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';

export interface TenantChatMessage {
    from: string;
    type: 'text' | 'audio' | 'image' | 'video' | 'document';
    content?: string;
    mediaId?: string;
    mediaUrl?: string;
    mimeType?: string;
    profileName?: string;
    messageId: string;
    timestamp: Date;
}

export interface TenantChatResult {
    handled: boolean;
    response?: string;
    issueId?: string;
    workerUsed?: string;
}

/**
 * Main entry point for tenant chat messages
 */
export async function handleTenantChatMessage(message: TenantChatMessage): Promise<TenantChatResult> {
    const normalizedPhone = normalizePhone(message.from);

    // Check if sender is a registered tenant
    const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.phone, normalizedPhone),
        with: {
            property: {
                with: {
                    landlord: true
                }
            }
        }
    });

    // If not a tenant, check if they're a landlord
    if (!tenant) {
        const landlord = await db.query.leads.findFirst({
            where: eq(leads.phone, normalizedPhone)
        });

        if (landlord && ['LANDLORD', 'PROP_MGR'].includes(landlord.segment || '')) {
            return handleLandlordMessage(landlord, message);
        }

        // Unknown sender - don't handle via AI for now
        return { handled: false };
    }

    // Tenant found - process through AI orchestrator
    return handleTenantMessage(tenant, message);
}

/**
 * Handle tenant messages
 */
async function handleTenantMessage(
    tenant: any, // Tenant with property and landlord relations
    message: TenantChatMessage
): Promise<TenantChatResult> {
    console.log(`[TenantChat] Processing message from tenant: ${tenant.name}`);

    // Process media if present
    let processedContent = message.content || '';
    let mediaUrls: string[] = [];

    if (message.type === 'audio' && message.mediaUrl) {
        // Transcribe voice note using OpenAI Whisper
        try {
            console.log('[TenantChat] Transcribing voice note...');
            const { transcribeAudioFromUrl } = await import('./openai');
            processedContent = await transcribeAudioFromUrl(message.mediaUrl);
            console.log('[TenantChat] Transcription:', processedContent);
        } catch (error) {
            console.error('[TenantChat] Voice transcription failed:', error);
            processedContent = '[Voice message received - transcription failed]';
        }
    }

    if (['image', 'video'].includes(message.type) && message.mediaUrl) {
        // Upload to local storage and get URL
        try {
            const localUrl = await uploadMediaToLocal(message.mediaUrl, message.type, message.mimeType);
            mediaUrls.push(localUrl);
            console.log('[TenantChat] Media uploaded:', localUrl);

            // Add context about the media
            if (!processedContent) {
                processedContent = `[Sent a ${message.type}]`;
            }
        } catch (error) {
            console.error('[TenantChat] Media upload failed:', error);
        }
    }

    // Prepare message for orchestrator
    const aiMessage: AIIncomingMessage = {
        from: message.from,
        type: message.type,
        content: processedContent,
        mediaUrl: mediaUrls[0],
        conversationId: `tenant_${tenant.id}`,
        metadata: {
            tenant,
            property: tenant.property,
            landlord: tenant.property?.landlord,
            mediaUrls
        }
    };

    // Get AI response
    const orchestrator = getOrchestrator();
    const response = await orchestrator.route(aiMessage);

    // If photos were uploaded, attach them to the current issue
    if (mediaUrls.length > 0 && response.issueId) {
        await attachPhotosToIssue(response.issueId, mediaUrls);
    }

    // Send response via WhatsApp
    const phoneForSend = message.from.replace('@c.us', '');
    await sendWhatsAppMessage(phoneForSend, response.message);

    console.log(`[TenantChat] Response sent to ${tenant.name}: ${response.message.substring(0, 50)}...`);

    return {
        handled: true,
        response: response.message,
        issueId: response.issueId,
        workerUsed: response.workerUsed
    };
}

/**
 * Handle landlord messages
 */
async function handleLandlordMessage(
    landlord: any,
    message: TenantChatMessage
): Promise<TenantChatResult> {
    console.log(`[TenantChat] Processing message from landlord: ${landlord.customerName}`);

    // Prepare message for orchestrator
    const aiMessage: AIIncomingMessage = {
        from: message.from,
        type: message.type,
        content: message.content || '',
        conversationId: `landlord_${landlord.id}`,
        metadata: { landlord }
    };

    // Get AI response
    const orchestrator = getOrchestrator();
    const response = await orchestrator.route(aiMessage);

    // Send response via WhatsApp
    const phoneForSend = message.from.replace('@c.us', '');
    await sendWhatsAppMessage(phoneForSend, response.message);

    return {
        handled: true,
        response: response.message,
        workerUsed: response.workerUsed
    };
}

/**
 * Upload media to local storage (S3 can be added later)
 */
async function uploadMediaToLocal(
    mediaUrl: string,
    type: string,
    mimeType?: string
): Promise<string> {
    // Download media from WhatsApp
    const response = await fetch(mediaUrl, {
        headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = mimeType?.split('/')[1] || type;
    const filename = `tenant-issue-${nanoid()}.${extension}`;

    // Save to local uploads directory
    const uploadDir = path.join(process.cwd(), 'uploads', 'tenant-issues');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filePath, buffer);

    // Return URL path (relative to server)
    return `/uploads/tenant-issues/${filename}`;
}

/**
 * Attach photos to an issue
 */
async function attachPhotosToIssue(issueId: string, urls: string[]): Promise<void> {
    try {
        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, issueId)
        });

        if (!issue) return;

        const existingPhotos = issue.photos || [];
        const newPhotos = [...existingPhotos, ...urls];

        await db.update(tenantIssues)
            .set({
                photos: newPhotos,
                updatedAt: new Date()
            })
            .where(eq(tenantIssues.id, issueId));

        console.log(`[TenantChat] Attached ${urls.length} photos to issue ${issueId}`);
    } catch (error) {
        console.error('[TenantChat] Failed to attach photos:', error);
    }
}

/**
 * Normalize phone number
 */
function normalizePhone(phone: string): string {
    // Remove @c.us suffix if present
    let normalized = phone.replace('@c.us', '');

    // Remove any non-digit characters except +
    normalized = normalized.replace(/[^\d+]/g, '');

    // If starts with 0, assume UK and add +44
    if (normalized.startsWith('0')) {
        normalized = '+44' + normalized.substring(1);
    }

    // If doesn't start with +, add it
    if (!normalized.startsWith('+')) {
        normalized = '+' + normalized;
    }

    return normalized;
}

/**
 * Check if a phone number belongs to a registered tenant
 */
export async function isTenantPhone(phone: string): Promise<boolean> {
    const normalizedPhone = normalizePhone(phone);
    const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.phone, normalizedPhone)
    });
    return !!tenant;
}

/**
 * Check if a phone number belongs to a landlord
 */
export async function isLandlordPhone(phone: string): Promise<boolean> {
    const normalizedPhone = normalizePhone(phone);
    const landlord = await db.query.leads.findFirst({
        where: eq(leads.phone, normalizedPhone)
    });
    return !!(landlord && ['LANDLORD', 'PROP_MGR'].includes(landlord.segment || ''));
}

/**
 * Get the type of a phone number
 */
export async function getPhoneType(phone: string): Promise<'tenant' | 'landlord' | 'unknown'> {
    if (await isTenantPhone(phone)) return 'tenant';
    if (await isLandlordPhone(phone)) return 'landlord';
    return 'unknown';
}

/**
 * Send typing indicator (if supported)
 */
export async function sendTypingIndicator(phone: string, isTyping: boolean): Promise<void> {
    // WhatsApp doesn't have a direct typing indicator API via Twilio
    // This is a placeholder for future implementation
    console.log(`[TenantChat] Typing indicator: ${isTyping ? 'start' : 'stop'} for ${phone}`);
}

/**
 * Notify landlord about a new issue
 */
export async function notifyLandlordNewIssue(
    landlordPhone: string,
    tenantName: string,
    propertyAddress: string,
    issueDescription: string,
    urgency: string,
    dashboardUrl: string
): Promise<void> {
    const urgencyEmoji = {
        emergency: '🚨',
        high: '🔴',
        medium: '🟡',
        low: '🟢'
    }[urgency] || '🔔';

    const message = `${urgencyEmoji} *New Issue Reported*

📍 Property: ${propertyAddress}
👤 Tenant: ${tenantName}
📋 Issue: ${issueDescription.substring(0, 100)}${issueDescription.length > 100 ? '...' : ''}
⚡ Urgency: ${urgency.charAt(0).toUpperCase() + urgency.slice(1)}

Tap to view details:
${dashboardUrl}`;

    const normalizedPhone = normalizePhone(landlordPhone);
    await sendWhatsAppMessage(normalizedPhone, message);
    console.log(`[TenantChat] Notified landlord at ${normalizedPhone}`);
}

/**
 * Notify landlord about auto-dispatched job
 */
export async function notifyLandlordAutoDispatch(
    landlordPhone: string,
    propertyAddress: string,
    issueDescription: string,
    estimateLow: number,
    estimateHigh: number,
    scheduledDate: string
): Promise<void> {
    const message = `✅ *Job Auto-Dispatched*

📍 Property: ${propertyAddress}
📋 Issue: ${issueDescription.substring(0, 80)}...
💰 Estimate: £${estimateLow} - £${estimateHigh}
📅 Scheduled: ${scheduledDate}

This job was auto-approved based on your rules.
Reply "STOP" to disable auto-approvals.`;

    const normalizedPhone = normalizePhone(landlordPhone);
    await sendWhatsAppMessage(normalizedPhone, message);
}
