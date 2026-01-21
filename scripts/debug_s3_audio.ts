
import "dotenv/config";
import { storageService } from "../server/storage";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

async function main() {
    console.log("--- S3 Debug Info ---");
    console.log("S3_ENDPOINT:", process.env.S3_ENDPOINT);
    console.log("S3_BUCKET:", process.env.S3_BUCKET);
    console.log("Region:", process.env.S3_REGION);

    // Test specific file
    const targetUrl = "storage/recordings/call_CAae0d32db5ef3c4a457e014571fc22638.raw";
    console.log(`\nTesting logic for: ${targetUrl}`);

    // 1. Get Signed URL
    const signedUrl = await storageService.getSignedRecordingUrl(targetUrl);
    console.log(`Signed URL generated: ${signedUrl.substring(0, 50)}...`);

    // 2. Try to list bucket to verify file exists
    try {
        const client = new S3Client({
            region: process.env.S3_REGION || 'auto',
            endpoint: process.env.S3_ENDPOINT,
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY || '',
                secretAccessKey: process.env.S3_SECRET_KEY || ''
            }
        });

        console.log("\nListing bucket contents (prefix: storage/)...");
        const command = new ListObjectsV2Command({
            Bucket: process.env.S3_BUCKET,
            Prefix: "storage/",
            MaxKeys: 20
        });

        const response = await client.send(command);
        if (response.Contents) {
            console.log("Found matches:");
            response.Contents.forEach(c => console.log(` - ${c.Key} (${c.Size} bytes)`));
        } else {
            console.log("No matching files found in bucket.");
        }
    } catch (err) {
        console.error("Failed to list S3 objects:", err);
    }

    // 3. Try Fetch
    if (signedUrl.startsWith("http")) {
        console.log("\nAttempting to fetch signed URL...");
        try {
            const res = await fetch(signedUrl);
            console.log(`Fetch status: ${res.status} ${res.statusText}`);
            if (!res.ok) {
                const text = await res.text();
                console.log("Error body:", text.substring(0, 200));
            } else {
                const blob = await res.arrayBuffer();
                console.log(`Success! Downloaded ${blob.byteLength} bytes.`);
            }
        } catch (err) {
            console.error("Fetch failed:", err);
        }
    } else {
        console.log("Signed URL is not a remote URL, skipping fetch test. Value:", signedUrl);
    }
}

main().catch(console.error);
