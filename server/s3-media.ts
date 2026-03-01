/**
 * S3 Media Upload Service for Tenant Issue Photos/Videos
 *
 * Handles downloading media from Twilio/WhatsApp and uploading to S3
 * with proper metadata tagging for organization.
 */

import { S3Client, PutObjectCommand, ObjectCannedACL } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

// S3 Configuration
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'eu-west-2';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

// Initialize S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
    if (!s3Client) {
        if (!AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
            throw new Error('[S3Media] Missing required AWS credentials: AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, or AWS_SECRET_ACCESS_KEY');
        }

        s3Client = new S3Client({
            region: AWS_REGION,
            credentials: {
                accessKeyId: AWS_ACCESS_KEY_ID,
                secretAccessKey: AWS_SECRET_ACCESS_KEY
            }
        });
        console.log(`[S3Media] Initialized S3 client (Region: ${AWS_REGION}, Bucket: ${AWS_S3_BUCKET})`);
    }
    return s3Client;
}

export interface MediaUploadContext {
    propertyId: string;
    tenantId: string;
    issueId: string;
    tenantName: string;
    type: 'image' | 'video';
    mimeType?: string;
}

/**
 * Extracts file extension from mimeType
 * @example getExtensionFromMimeType('image/jpeg') -> 'jpeg'
 * @example getExtensionFromMimeType('video/mp4') -> 'mp4'
 */
function getExtensionFromMimeType(mimeType?: string, type?: 'image' | 'video'): string {
    if (mimeType) {
        const parts = mimeType.split('/');
        if (parts.length === 2) {
            // Handle special cases
            const subtype = parts[1];
            if (subtype === 'quicktime') return 'mov';
            if (subtype === 'x-matroska') return 'mkv';
            return subtype;
        }
    }
    // Fallback based on type
    return type === 'video' ? 'mp4' : 'jpg';
}

/**
 * Downloads media from source URL with proper authentication
 * Supports Twilio URLs (Basic auth) and Meta WhatsApp URLs (Bearer token)
 */
async function downloadMedia(mediaUrl: string): Promise<Buffer> {
    console.log(`[S3Media] Downloading media from: ${mediaUrl}`);

    const headers: Record<string, string> = {};

    // Determine auth type based on URL
    if (mediaUrl.includes('api.twilio.com')) {
        // Twilio URLs require Basic auth with Account SID and Auth Token
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
            const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            console.log('[S3Media] Using Twilio Basic auth');
        } else {
            console.warn('[S3Media] Twilio credentials missing for authenticated download');
        }
    } else if (process.env.WHATSAPP_ACCESS_TOKEN) {
        // Meta WhatsApp Cloud API uses Bearer token
        headers['Authorization'] = `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`;
        console.log('[S3Media] Using WhatsApp Bearer token');
    }

    const response = await fetch(mediaUrl, { headers });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`[S3Media] Media download failed: ${response.status} ${response.statusText} - ${errorText}`);
        throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[S3Media] Downloaded ${buffer.length} bytes`);

    return buffer;
}

/**
 * Upload media from a source URL to S3 with metadata tagging
 *
 * @param mediaUrl - Source URL (Twilio or WhatsApp)
 * @param context - Upload context with property, tenant, issue details
 * @returns Full S3 URL of uploaded file
 *
 * @example
 * const s3Url = await uploadMediaToS3(
 *   'https://api.twilio.com/...',
 *   {
 *     propertyId: 'prop_123',
 *     tenantId: 'tenant_456',
 *     issueId: 'issue_789',
 *     tenantName: 'John Smith',
 *     type: 'image',
 *     mimeType: 'image/jpeg'
 *   }
 * );
 * // Returns: https://bucket.s3.eu-west-2.amazonaws.com/tenant-issues/prop_123/tenant_456/issue_789/abc123.jpeg
 */
export async function uploadMediaToS3(
    mediaUrl: string,
    context: MediaUploadContext
): Promise<string> {
    console.log(`[S3Media] Starting upload for ${context.type} to issue ${context.issueId}`);

    // Get S3 client (throws if not configured)
    const client = getS3Client();

    // Download media from source
    const buffer = await downloadMedia(mediaUrl);

    // Generate filename with extension
    const extension = getExtensionFromMimeType(context.mimeType, context.type);
    const filename = `${nanoid()}.${extension}`;

    // Build S3 key with folder structure
    const key = `tenant-issues/${context.propertyId}/${context.tenantId}/${context.issueId}/${filename}`;

    // Determine content type
    const contentType = context.mimeType || (context.type === 'video' ? 'video/mp4' : 'image/jpeg');

    // Prepare metadata tags
    const uploadedAt = new Date().toISOString();

    console.log(`[S3Media] Uploading to S3: ${key}`);

    try {
        const command = new PutObjectCommand({
            Bucket: AWS_S3_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            ACL: ObjectCannedACL.public_read,
            Tagging: `tenantId=${encodeURIComponent(context.tenantId)}&tenantName=${encodeURIComponent(context.tenantName)}&issueId=${encodeURIComponent(context.issueId)}&propertyId=${encodeURIComponent(context.propertyId)}&uploadedAt=${encodeURIComponent(uploadedAt)}`
        });

        await client.send(command);

        // Construct full S3 URL
        const s3Url = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;

        console.log(`[S3Media] Upload successful: ${s3Url}`);
        return s3Url;

    } catch (error) {
        console.error('[S3Media] S3 upload failed:', error);
        throw new Error(`[S3Media] Failed to upload to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Upload multiple media files to S3
 *
 * @param mediaItems - Array of media URLs with their contexts
 * @returns Array of S3 URLs
 */
export async function uploadMultipleMediaToS3(
    mediaItems: Array<{ mediaUrl: string; context: MediaUploadContext }>
): Promise<string[]> {
    console.log(`[S3Media] Batch uploading ${mediaItems.length} media items`);

    const results: string[] = [];

    for (const item of mediaItems) {
        try {
            const s3Url = await uploadMediaToS3(item.mediaUrl, item.context);
            results.push(s3Url);
        } catch (error) {
            console.error(`[S3Media] Failed to upload item:`, error);
            // Continue with remaining items
        }
    }

    console.log(`[S3Media] Batch complete: ${results.length}/${mediaItems.length} successful`);
    return results;
}

/**
 * Check if S3 is properly configured
 */
export function isS3Configured(): boolean {
    return !!(AWS_S3_BUCKET && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
}
