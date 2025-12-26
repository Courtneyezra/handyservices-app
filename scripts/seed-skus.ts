import { db } from "../server/db";
import { productizedServices } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";

const SKUS = [
    // Plumbing
    {
        skuCode: "PLUMB-TAP-REPAIR",
        name: "Tap Repair / Replacement",
        description: "Repairing a leaking tap or replacing standard basin/kitchen taps.",
        category: "Plumbing",
        pricePence: 9500,
        timeEstimateMinutes: 60,
        keywords: ["tap", "faucet", "dripping", "leaking tap", "washer", "kitchen sink", "bathroom sink"],
        aiPromptHint: "Use this for any tap related issues, distinct from shower mixers."
    },
    {
        skuCode: "PLUMB-TOILET-REPAIR",
        name: "Toilet Repair",
        description: "Fixing flush mechanisms, filling loops, or syphon issues.",
        category: "Plumbing",
        pricePence: 9500,
        timeEstimateMinutes: 60,
        keywords: ["toilet", "flush", "cistern", "not flushing", "overflowing", "handle broken"],
        aiPromptHint: "For internal toilet mechanism repairs. Not for blocked toilets."
    },
    {
        skuCode: "PLUMB-BLOCKAGE-CLEAR",
        name: "Blockage Clearance",
        description: "Unblocking sinks, toilets, or internal waste pipes.",
        category: "Plumbing",
        pricePence: 12000,
        timeEstimateMinutes: 60,
        keywords: ["blocked", "clogged", "wont drain", "water rising", "plunger"],
        aiPromptHint: "For any blockage issues in sinks, toilets or showers."
    },
    {
        skuCode: "PLUMB-SHOWER-REPAIR",
        name: "Shower Repair",
        description: "Repairing thermostatic mixer bars or electric showers.",
        category: "Plumbing",
        pricePence: 11000,
        timeEstimateMinutes: 90,
        keywords: ["shower", "mixer", "temperature", "scolding", "cold water", "electric shower"],
        aiPromptHint: "Specific to shower units and mixers."
    },

    // Electrical
    {
        skuCode: "ELEC-LIGHT-FITTING",
        name: "Light Fitting Replacement",
        description: "Replacing a standard ceiling light or wall light.",
        category: "Electrical",
        pricePence: 8500,
        timeEstimateMinutes: 45,
        keywords: ["light", "fitting", "chandelier", "pendant", "lamp", "ceiling light"],
        aiPromptHint: "Replacing an existing light fixture."
    },
    {
        skuCode: "ELEC-SOCKET-REPLACE",
        name: "Socket/Switch Replacement",
        description: "Replacing a broken or old electrical socket or switch.",
        category: "Electrical",
        pricePence: 7500,
        timeEstimateMinutes: 30,
        keywords: ["socket", "plug", "switch", "dimmer", "outlet", "cracked"],
        aiPromptHint: "Swapping faceplates or fixing loose sockets."
    },

    // Flatpack (Generic for now, distinct logic in V5 but keeping SKU for embedding match)
    {
        skuCode: "FLATPACK-GENERIC",
        name: "Flatpack Assembly",
        description: "Assembly of flatpack furniture (IKEA, Wayfair etc).",
        category: "Flatpack",
        pricePence: 6000, // Hourly rate placeholder
        timeEstimateMinutes: 60,
        keywords: ["ikea", "pax", "wardrobe", "bed", "drawers", "assembly", "flatpack"],
        aiPromptHint: "Any furniture assembly request."
    },

    // Handyman / Misc
    {
        skuCode: "HANDY-TV-MOUNT",
        name: "TV Mounting",
        description: "Wall mounting a TV on plasterboard or solid wall.",
        category: "Handyman",
        pricePence: 8500,
        timeEstimateMinutes: 60,
        keywords: ["tv", "television", "mount", "bracket", "wall hang", "samsung", "lg"],
        aiPromptHint: "Mounting televisions to walls."
    },
    {
        skuCode: "HANDY-SILICONE-SEAL",
        name: "Resealing Bath/Shower",
        description: "Removing old silicone and resealing bath or shower tray.",
        category: "Handyman",
        pricePence: 9000,
        timeEstimateMinutes: 90,
        keywords: ["silicone", "sealant", "mouldy", "leaking edge", "seal bath", "seal shower"],
        aiPromptHint: "Resealing for watertightness."
    }
];

async function seed() {
    console.log("🌱 Seeding SKUs...");

    try {
        for (const sku of SKUS) {
            // Upsert based on skuCode
            await db.insert(productizedServices).values({
                id: uuidv4(),
                ...sku
            }).onConflictDoNothing({ target: productizedServices.skuCode });
        }
        console.log("✅ Seeding complete!");
    } catch (error) {
        console.error("❌ Seeding failed:", error);
    }
    process.exit(0);
}

seed();
