
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";

dotenv.config();

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';

async function listS3() {
    console.log("=== LISTING S3 BUCKET CONTENTS ===");
    console.log(`Bucket: ${S3_BUCKET}`);
    console.log(`Endpoint: ${S3_ENDPOINT}`);

    if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
        console.error("ERROR: S3 configuration missing from .env");
        return;
    }

    const client = new S3Client({
        region: S3_REGION,
        endpoint: S3_ENDPOINT,
        credentials: {
            accessKeyId: S3_ACCESS_KEY,
            secretAccessKey: S3_SECRET_KEY
        }
    });

    try {
        const command = new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            MaxKeys: 100 // Just list safe number to sniff structure
        });

        const response = await client.send(command);

        if (!response.Contents || response.Contents.length === 0) {
            console.log("Bucket is empty.");
        } else {
            console.log(`Found ${response.Contents.length} objects (showing first 100):`);
            response.Contents.forEach(item => {
                console.log(` - [${item.Size} bytes] ${item.Key} (Last Modified: ${item.LastModified})`);
            });
        }

    } catch (err) {
        console.error("Error listing bucket:", err);
    }
}

listS3();
