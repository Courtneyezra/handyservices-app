/**
 * Generate and store Voyage AI embeddings for every active service_catalog row.
 *
 * Voyage AI is Anthropic's recommended embedding partner — used alongside Claude
 * for retrieval/RAG pipelines. Free tier: 200M tokens/month.
 * Sign up at https://www.voyageai.com and set VOYAGE_API_KEY in .env
 *
 * Text embedded per SKU:
 *   "<name>. <customerDescription>. Keywords: <keywords>. <aiPromptHint>"
 *
 * Uses voyage-3 (1024 dims). NOTE: the DB column is vector(1536) — a migration
 * is needed if you switch from the original OpenAI 1536-dim column to Voyage's
 * 1024-dim output. Run the ALTER TABLE below first:
 *
 *   ALTER TABLE service_catalog ALTER COLUMN embedding TYPE vector(1024);
 *   UPDATE pg_attribute SET atttypmod = 1024
 *     WHERE attrelid = 'service_catalog'::regclass AND attname = 'embedding';
 *
 * Or use voyage-large-2-instruct which outputs 1536 dims (older model, still works):
 *   model: "voyage-large-2-instruct"   ← set below
 *
 * Batches 128 at a time. Skips rows that already have an embedding (re-run safe).
 * After all embeddings are stored, creates the ivfflat index.
 *
 * Run:
 *   npx tsx scripts/seed-sku-embeddings.ts
 *   FORCE=1 npx tsx scripts/seed-sku-embeddings.ts   # re-embed even if already set
 */

import { db } from "../server/db";
import { serviceCatalog } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 128;        // rows per Voyage AI batch call (max 128)
const FORCE      = process.env.FORCE === "1";
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
// Use voyage-large-2-instruct (1536 dims) to match the existing vector(1536) column.
// Switch to "voyage-3" (1024 dims) only after running the ALTER TABLE migration above.
const VOYAGE_MODEL = "voyage-large-2-instruct";

if (!VOYAGE_KEY) {
    console.error("VOYAGE_API_KEY is not set. Get a free key at https://www.voyageai.com");
    process.exit(1);
}

async function voyageEmbed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${VOYAGE_KEY}`,
        },
        body: JSON.stringify({ model: VOYAGE_MODEL, input: texts }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage AI error ${res.status}: ${body}`);
    }
    const json = await res.json() as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
}

function buildEmbedText(row: {
    name: string;
    customerDescription: string;
    keywords: string[] | null;
    aiPromptHint: string | null;
    category: string;
}): string {
    const parts: string[] = [row.name];
    if (row.customerDescription) parts.push(row.customerDescription);
    if (row.keywords?.length)    parts.push(`Keywords: ${row.keywords.join(", ")}`);
    if (row.aiPromptHint)        parts.push(row.aiPromptHint);
    parts.push(`Category: ${row.category}`);
    return parts.join(". ");
}

// PostgreSQL vector literal: '[d0,d1,...,d1535]'
function toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
}

async function main() {
    console.log(`[seed-sku-embeddings] FORCE=${FORCE}`);

    // Load rows needing embeddings
    const rows = await db
        .select({
            id: serviceCatalog.id,
            skuCode: serviceCatalog.skuCode,
            name: serviceCatalog.name,
            category: serviceCatalog.category,
            customerDescription: serviceCatalog.customerDescription,
            keywords: serviceCatalog.keywords,
            aiPromptHint: serviceCatalog.aiPromptHint,
        })
        .from(serviceCatalog)
        .where(FORCE ? eq(serviceCatalog.isActive, true) : isNull(serviceCatalog.embedding));

    console.log(`  ${rows.length} rows to embed`);
    if (rows.length === 0) {
        console.log("  Nothing to do.");
        await createIndex();
        process.exit(0);
    }

    let done = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const texts = batch.map(buildEmbedText);

        try {
            const embeddings = await voyageEmbed(texts);

            // Write each embedding back to the DB
            for (let j = 0; j < batch.length; j++) {
                const row = batch[j];
                const embedding = embeddings[j];
                const vectorLiteral = toVectorLiteral(embedding);

                await db.execute(
                    sql`UPDATE service_catalog
                        SET embedding = ${vectorLiteral}::vector
                        WHERE id = ${row.id}`
                );
                done++;
            }

            console.log(`  ✓ batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} — ${done}/${rows.length} done`);
        } catch (err: any) {
            console.error(`  ✗ batch error:`, err?.message ?? err);
            errors += batch.length;
        }
    }

    console.log(`\n  Embeddings complete: ${done} stored, ${errors} errors`);

    await createIndex();
    process.exit(0);
}

async function createIndex() {
    console.log("\n[seed-sku-embeddings] Creating ivfflat index …");
    try {
        // lists = 50 is appropriate for ~161 rows (rule of thumb: sqrt(N))
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_sc_embedding
            ON service_catalog
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 16)
        `);
        console.log("  ✓ index created (or already exists)");
    } catch (err: any) {
        // ivfflat requires at least 1 non-null embedding row
        console.warn("  ⚠ index creation skipped:", err?.message ?? err);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
