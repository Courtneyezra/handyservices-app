import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

// Configuration
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'local'; // 'local' | 's3'
const STORAGE_PATH = process.env.STORAGE_PATH || 'storage/recordings'; // For local storage

// S3 Configuration — legacy family (endpoint-style, e.g. R2)
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
let S3_BUCKET = process.env.S3_BUCKET || '';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE; // Optional: for custom domains

// AWS family — the config that is actually set in prod (same vars s3-media.ts
// uses; Railway has AWS_S3_BUCKET etc., verified working). Recordings used to
// require the legacy S3_* family, which prod never had — so every call
// recording quietly fell back to Railway's ephemeral disk and died on the
// next deploy. If the legacy family is absent but AWS_* is present, use it.
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'eu-west-2';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

class StorageService {
    private s3Client: S3Client | null = null;
    private provider: string;

    constructor() {
        this.provider = STORAGE_PROVIDER;

        if (this.provider === 's3') {
            if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
                console.warn("[Storage] S3 configuration missing. Falling back to local storage.");
                console.warn(`[Storage] Debug: Endpoint=${!!S3_ENDPOINT}, Bucket=${!!S3_BUCKET}, AccessKey=${!!S3_ACCESS_KEY}, Secret=${!!S3_SECRET_KEY}`);
                this.provider = 'local';
            } else {
                this.s3Client = new S3Client({
                    region: S3_REGION,
                    endpoint: S3_ENDPOINT,
                    credentials: {
                        accessKeyId: S3_ACCESS_KEY,
                        secretAccessKey: S3_SECRET_KEY
                    }
                });
                console.log(`[Storage] Initialized S3 provider (Bucket: ${S3_BUCKET})`);
            }
        }

        // AWS-family fallback: prod sets AWS_* (media uploads prove it) but not
        // STORAGE_PROVIDER/S3_*. Recordings must survive deploys, so if AWS S3
        // is available, prefer it over the ephemeral local disk.
        if (this.provider === 'local' && AWS_S3_BUCKET && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
            this.s3Client = new S3Client({
                region: AWS_REGION,
                credentials: {
                    accessKeyId: AWS_ACCESS_KEY_ID,
                    secretAccessKey: AWS_SECRET_ACCESS_KEY,
                },
            });
            S3_BUCKET = AWS_S3_BUCKET;
            this.provider = 's3';
            console.log(`[Storage] Initialized S3 provider from AWS_* config (Bucket: ${AWS_S3_BUCKET}, Region: ${AWS_REGION})`);
        }

        if (this.provider === 'local') {
            // Ensure local directory exists
            const fullPath = path.resolve(process.cwd(), STORAGE_PATH);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                console.log(`[Storage] Created local storage directory: ${fullPath}`);
            }
            console.log(`[Storage] Initialized Local provider (${fullPath})`);
        }
    }

    /**
     * Uploads a file to the configured storage provider.
     * @param localFilePath Absolute path to the local file
     * @param key Desired filename/key in storage
     * @returns Public URL (S3) or Relative Path (Local)
     */
    async uploadRecording(localFilePath: string, key: string): Promise<string> {
        if (!fs.existsSync(localFilePath)) {
            throw new Error(`File not found: ${localFilePath}`);
        }

        if (this.provider === 's3' && this.s3Client) {
            return this.uploadToS3(localFilePath, key);
        } else {
            return this.saveToLocal(localFilePath, key);
        }
    }

    private async uploadToS3(localFilePath: string, key: string): Promise<string> {
        try {
            // Keep recordings under one prefix rather than the bucket root.
            const s3Key = key.startsWith('recordings/') ? key : `recordings/${key}`;
            const fileStream = fs.createReadStream(localFilePath);
            const contentType = 'audio/x-wav'; // Assuming RAW/WAV for now, adjust as needed

            const command = new PutObjectCommand({
                Bucket: S3_BUCKET,
                Key: s3Key,
                Body: fileStream,
                ContentType: contentType
                // ACL: 'public-read' // Removed to support buckets with ACLs disabled
            });

            await this.s3Client!.send(command);

            // Construct URL
            if (S3_PUBLIC_URL_BASE) {
                return `${S3_PUBLIC_URL_BASE}/${s3Key}`;
            }
            if (S3_ENDPOINT) {
                // Endpoint-style provider (e.g. R2)
                return `${S3_ENDPOINT}/${S3_BUCKET}/${s3Key}`;
            }
            // Standard AWS S3 virtual-hosted URL (AWS_* config path)
            return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;
        } catch (error) {
            console.error("[Storage] S3 Upload Failed:", error);
            throw error;
        }
    }

    private async saveToLocal(localFilePath: string, key: string): Promise<string> {
        // For local storage, we just ensure it's in the right place.
        // If the file is already being written to STORAGE_PATH by the recorder, we might not need to move it.
        // But to be safe and consistent, let's assume valid storage structure.

        const targetDir = path.resolve(process.cwd(), STORAGE_PATH);
        const targetPath = path.join(targetDir, key);

        // Ensure parent directory exists (for keys like "debug/file.txt")
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // If source and target are different, copy/move.
        if (path.resolve(localFilePath) !== targetPath) {
            await fs.promises.copyFile(localFilePath, targetPath);
        }

        // Return relative path for DB usage (frontend expects relative or full URL)
        // Usually, static files are served from a specific route.
        // If this is `storage/recordings/file.raw`, we return that.
        return path.join(STORAGE_PATH, key);
    }

    /**
     * Generates a signed URL for playback if using S3, or returns the relative local path.
     */
    async getSignedRecordingUrl(storedPathOrUrl: string): Promise<string> {
        // If not S3, return as is (client handles local paths usually via static serve)
        if (this.provider !== 's3' || !this.s3Client) {
            return storedPathOrUrl;
        }

        try {
            // Extract Key from URL
            // URL format: https://endpoint/bucket/KEY or https://bucket.endpoint/KEY
            // Simple heuristic: stored url ends with the key.
            // But we stored it as `${S3_ENDPOINT}/${S3_BUCKET}/${key}`
            // We need to robustly extract the key.

            let key = storedPathOrUrl;

            // Fix: If this is a local path (legacy or hybrid), do not treat as S3 key
            // UNLESS we are in S3 mode and the local file is missing (Fall through to S3 recovery)
            if (storedPathOrUrl.startsWith('storage/')) {
                const isS3Mode = this.provider === 's3' || (S3_BUCKET && S3_ACCESS_KEY); // Robust check
                if (isS3Mode) {
                    const localPath = path.resolve(process.cwd(), storedPathOrUrl);
                    if (fs.existsSync(localPath)) {
                        return storedPathOrUrl;
                    }
                    console.warn(`[Storage] Local file missing for ${storedPathOrUrl}. Attempting S3 fallback...`);
                    // Fall through to S3 logic
                    // If local file is missing, try S3. New uploads live under the
                    // recordings/ prefix; legacy uploads were flat basenames.
                    key = `recordings/${path.basename(storedPathOrUrl)}`;
                } else {
                    return storedPathOrUrl;
                }
            }

            // Check if it matches our generated pattern
            const prefix = `${S3_ENDPOINT}/${S3_BUCKET}/`;
            if (storedPathOrUrl.startsWith(prefix)) {
                key = storedPathOrUrl.replace(prefix, '');
            } else if (storedPathOrUrl.startsWith('http')) {
                // Fallback: try to guess key from last part of URL
                // This handles cases where endpoint/bucket struct might vary slightly
                // or if custom domain was used.
                const urlObj = new URL(storedPathOrUrl);
                const bucketPattern = new RegExp(`^/${S3_BUCKET}/`);
                key = urlObj.pathname.replace(bucketPattern, '').replace(/^\//, ''); // Remove bucket name if in path
            }

            const command = new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: key
            });

            // Sign URL for 1 hour (3600 seconds)
            const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
            return signedUrl;

        } catch (error) {
            console.error("[Storage] Failed to sign URL:", error);
            return storedPathOrUrl; // Fallback to original
        }
    }

    /**
     * Fetch a stored recording as a Buffer, wherever it lives: a local path, an
     * S3 URL from either config family, or a bare key. Used by the post-call
     * batch transcription pass. Returns null when nothing is found.
     */
    async downloadRecording(storedPathOrUrl: string): Promise<Buffer | null> {
        try {
            // Local path that still exists (dev, or pre-deploy-wipe prod)
            if (!storedPathOrUrl.startsWith('http')) {
                const localPath = path.resolve(process.cwd(), storedPathOrUrl);
                if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
            }
            if (!this.s3Client) return null;

            // Resolve the S3 key from whatever form we stored
            let key = storedPathOrUrl;
            if (storedPathOrUrl.startsWith('http')) {
                const urlObj = new URL(storedPathOrUrl);
                const bucketPattern = new RegExp(`^/${S3_BUCKET}/`);
                key = urlObj.pathname.replace(bucketPattern, '').replace(/^\//, '');
            } else if (storedPathOrUrl.startsWith('storage/')) {
                key = `recordings/${path.basename(storedPathOrUrl)}`;
            }

            const out = await this.s3Client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
                .catch(async (e: any) => {
                    // Legacy flat keys (pre-prefix uploads)
                    if (key.startsWith('recordings/')) {
                        return this.s3Client!.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key.replace(/^recordings\//, '') }));
                    }
                    throw e;
                });
            const bytes = await out.Body?.transformToByteArray();
            return bytes ? Buffer.from(bytes) : null;
        } catch (error: any) {
            console.warn(`[Storage] downloadRecording failed for ${storedPathOrUrl}:`, error?.message ?? error);
            return null;
        }
    }

    /**
     * Upload a public image (e.g. a job-completion photo) from a Buffer and
     * return a public URL. Uses S3 when configured; in dev (no S3) it writes to
     * client/public/uploads so the URL is served statically and verifiable.
     */
    async uploadPublicImage(buffer: Buffer, key: string, contentType = 'image/jpeg'): Promise<string> {
        if (this.provider === 's3' && this.s3Client) {
            await this.s3Client.send(new PutObjectCommand({
                Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: contentType,
            }));
            return S3_PUBLIC_URL_BASE ? `${S3_PUBLIC_URL_BASE}/${key}` : `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
        }
        const rel = `uploads/${key}`;
        const target = path.resolve(process.cwd(), 'client', 'public', rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, buffer);
        return `/${rel}`;
    }
}

export const storageService = new StorageService();
