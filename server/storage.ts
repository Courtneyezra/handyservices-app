import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

// Configuration
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'local'; // 'local' | 's3'
const STORAGE_PATH = process.env.STORAGE_PATH || 'storage/recordings'; // For local storage

// S3 Configuration
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE; // Optional: for custom domains

class StorageService {
    private s3Client: S3Client | null = null;
    private provider: string;

    constructor() {
        this.provider = STORAGE_PROVIDER;

        if (this.provider === 's3') {
            if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
                console.warn("[Storage] S3 configuration missing. Falling back to local storage.");
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
            const fileStream = fs.createReadStream(localFilePath);
            const contentType = 'audio/x-wav'; // Assuming RAW/WAV for now, adjust as needed

            const command = new PutObjectCommand({
                Bucket: S3_BUCKET,
                Key: key,
                Body: fileStream,
                ContentType: contentType
                // ACL: 'public-read' // Removed to support buckets with ACLs disabled
            });

            await this.s3Client!.send(command);

            // Construct URL
            if (S3_PUBLIC_URL_BASE) {
                return `${S3_PUBLIC_URL_BASE}/${key}`;
            }
            // Default S3/R2 URL structure
            return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
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

            // Check if it matches our generated pattern
            const prefix = `${S3_ENDPOINT}/${S3_BUCKET}/`;
            if (storedPathOrUrl.startsWith(prefix)) {
                key = storedPathOrUrl.replace(prefix, '');
            } else if (storedPathOrUrl.startsWith('http')) {
                // Fallback: try to guess key from last part of URL
                // This handles cases where endpoint/bucket struct might vary slightly
                // or if custom domain was used.
                const urlObj = new URL(storedPathOrUrl);
                key = urlObj.pathname.replace(/^\/handyuploaduk\//, '').replace(/^\//, ''); // Remove bucket name if in path
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
}

export const storageService = new StorageService();
