// Phase 4 B1: Generate Training Dataset for FastText Model
// Exports existing call data + generates synthetic examples using GPT

import { db } from "../server/db";
import { calls, skuMatchLogs } from "../shared/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface TrainingExample {
    text: string;
    label: string;  // SKU code
    sku_id: string;
    confidence: number;
}

async function generateTrainingData() {
    console.log("🚀 Starting training data generation...\n");

    const examples: TrainingExample[] = [];

    // Step 1: Export existing call data with SKU matches
    console.log("📊 Step 1: Fetching existing call data from database...");

    const existingCalls = await db.execute(sql`
        SELECT 
            c.transcript,
            c.detected_sku_id,
            s.sku_code,
            s.name
        FROM calls c
        LEFT JOIN productized_services s ON c.detected_sku_id = s.id
        WHERE c.transcript IS NOT NULL 
            AND c.transcript != ''
            AND c.detected_sku_id IS NOT NULL
        LIMIT 1000
    `);

    console.log(`   Found ${existingCalls.rows.length} calls with SKU matches`);

    existingCalls.rows.forEach((row: any) => {
        if (row.transcript && row.sku_code) {
            examples.push({
                text: row.transcript,
                label: row.sku_code,
                sku_id: row.detected_sku_id,
                confidence: 100 // Real data = high confidence
            });
        }
    });

    // Step 2: Generate synthetic examples using GPT
    console.log("\n🤖 Step 2: Generating synthetic examples with GPT-4o...");

    const skus = await db.execute(sql`
        SELECT id, sku_code, name, description, keywords
        FROM productized_services
        WHERE is_active = true
        LIMIT 50
    `);

    console.log(`   Generating examples for ${skus.rows.length} SKUs...`);

    const syntheticTarget = 5000; // Target 5000 synthetic examples
    const examplesPerSku = Math.ceil(syntheticTarget / skus.rows.length);

    for (const sku of skus.rows as any[]) {
        try {
            const prompt = `Generate ${examplesPerSku} realistic customer requests for this handyman service:
            
Service: ${sku.name}
Description: ${sku.description || ''}
Keywords: ${sku.keywords?.join(', ') || ''}

Generate varied, natural-sounding requests that a real customer might say over the phone. Include:
- Different phrasings (formal, casual, urgent)
- Different levels of detail (vague, specific)
- Different contexts (homeowner, landlord, tenant)

Return JSON array: [{"text": "customer request here"}, ...]`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a data generator for training a handyman service classifier." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" },
                max_tokens: 1000,
                temperature: 0.8 // Higher temperature for variety
            });

            const parsed = JSON.parse(response.choices[0].message.content || "{}");
            const generated = parsed.examples || parsed.requests || [];

            generated.forEach((item: any) => {
                if (item.text) {
                    examples.push({
                        text: item.text,
                        label: sku.sku_code,
                        sku_id: sku.id,
                        confidence: 85 // Synthetic = slightly lower confidence
                    });
                }
            });

            console.log(`   ✓ Generated ${generated.length} examples for ${sku.name}`);

        } catch (e) {
            console.error(`   ✗ Error generating for ${sku.name}:`, e);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Step 3: Export to JSONL format
    console.log(`\n💾 Step 3: Exporting ${examples.length} examples to JSONL...`);

    const dataDir = path.resolve(__dirname, "../data");
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const outputPath = path.join(dataDir, "sku-training-dataset.jsonl");
    const jsonlLines = examples.map(ex => JSON.stringify(ex)).join("\n");

    fs.writeFileSync(outputPath, jsonlLines, "utf-8");

    console.log(`✅ Training dataset saved to: ${outputPath}`);
    console.log(`\n📈 Dataset Statistics:`);
    console.log(`   Total examples: ${examples.length}`);
    console.log(`   Real calls: ${existingCalls.rows.length}`);
    console.log(`   Synthetic: ${examples.length - existingCalls.rows.length}`);
    console.log(`   Unique SKUs: ${new Set(examples.map(e => e.label)).size}`);

    // Step 4: Split into train/test sets
    console.log(`\n📊 Step 4: Splitting into train (80%) / test (20%) sets...`);

    const shuffled = examples.sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(shuffled.length * 0.8);

    const trainSet = shuffled.slice(0, splitIndex);
    const testSet = shuffled.slice(splitIndex);

    fs.writeFileSync(
        path.join(dataDir, "sku-training-train.jsonl"),
        trainSet.map(ex => JSON.stringify(ex)).join("\n"),
        "utf-8"
    );

    fs.writeFileSync(
        path.join(dataDir, "sku-training-test.jsonl"),
        testSet.map(ex => JSON.stringify(ex)).join("\n"),
        "utf-8"
    );

    console.log(`   Train set: ${trainSet.length} examples`);
    console.log(`   Test set: ${testSet.length} examples`);
    console.log(`\n✅ Training data generation complete!`);
}

generateTrainingData().catch(console.error);
