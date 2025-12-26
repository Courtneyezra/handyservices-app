import { detectSku } from "../server/skuDetector";
import { db } from "../server/db";

async function runTests() {
    console.log("🧠 Testing The Brain (SKU Detection)...\n");

    const testCases = [
        "I have a leaking tap in my kitchen",
        "replace a light fitting",
        "assemble 2 ikea wardrobes",
        "my toilet is blocked",
        "install a new socket"
    ];

    for (const text of testCases) {
        console.log(`--- Testing: "${text}" ---`);
        try {
            const result = await detectSku(text);
            console.log("Result:", JSON.stringify({
                sku: result.sku?.skuCode,
                name: result.sku?.name,
                confidence: result.confidence,
                method: result.method,
                // quantity: result.quantity
            }, null, 2));
        } catch (e) {
            console.error("Error:", e);
        }
        console.log("\n");
    }

    process.exit(0);
}

runTests();
