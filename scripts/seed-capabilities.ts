
import { db } from '../server/db';
import { productizedServices } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

const CAPABILITIES = {
    "Plumbing": [
        "General Plumbing",
        "Leaky Tap Repair",
        "Toilet Repair/Replacement",
        "Shower Installation",
        "Blockage Clearance",
        "Radiator Installation",
        "Pipework Repair"
    ],
    "Joinery": [
        "General Joinery",
        "Fit Architrave/Skirting",
        "Hang Internal Door",
        "Hang External Door",
        "Kitchen Cabinet Assembly",
        "Kitchen Worktop Fitting",
        "Flooring Installation (Laminate/Wood)",
        "Partition Wall Construction"
    ],
    "Tiling": [
        "General Tiling",
        "Wall Tiling",
        "Floor Tiling",
        "Grouting/Re-grouting",
        "Splashback Installation"
    ],
    "Decorating": [
        "General Decorating",
        "Interior Painting (Walls/Ceilings)",
        "Woodwork Painting",
        "Wallpapering",
        "Exterior Painting",
        "Plaster Patching"
    ],
    "Handyman": [
        "General Handyman",
        "Flatpack Assembly",
        "TV Mounting",
        "Curtain/Blind Fitting",
        "Shelf Installation",
        "Picture Hanging",
        "Door Handle/Lock Replacement"
    ],
    "Electrical": [
        "General Electrical",
        "Light Fitting Replacement",
        "Socket/Switch Replacement",
        "Fuseboard Inspection",
        "PAT Testing",
        "Outdoor Lighting"
    ]
};

// ---------------------------------------------------------
// 💰 MANUAL RATE OVERRIDES (Hourly Rate in Pence)
// Edit these values to update the default rates for each trade.
// ---------------------------------------------------------
const CATEGORY_RATES: Record<string, number> = {
    "Plumbing": 6000,   // £60.00
    "Electrical": 6500, // £65.00
    "Joinery": 5500,    // £55.00
    "Tiling": 5000,     // £50.00
    "Decorating": 4500, // £45.00
    "Handyman": 4000    // £40.00
};

async function seed() {
    console.log("🌱 Seeding Capabilities...");

    const skuMap: Record<string, string> = {};

    for (const [category, skills] of Object.entries(CAPABILITIES)) {
        console.log(`Processing Category: ${category}`);

        // Get default rate for this category, fallback to 6000 if not found
        const categoryRate = CATEGORY_RATES[category] || 6000;

        for (const skill of skills) {
            // Check if exists to avoid duplicates
            // We search by name for now, or could use a SKU code convention like JOINERY-DOOR-INT
            const skuName = `${category}: ${skill}`;
            const skuCode = `${category.toUpperCase().slice(0, 3)}-${skill.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)}`;

            let existing = await db.query.productizedServices.findFirst({
                where: (t, { eq }) => eq(t.skuCode, skuCode)
            });

            if (!existing) {
                console.log(`Creating SKU: ${skuName} (${skuCode}) - Rate: £${categoryRate / 100}`);
                const id = uuidv4();
                await db.insert(productizedServices).values({
                    id,
                    name: skuName,
                    skuCode: skuCode,
                    description: `${skill} service under ${category}`,
                    pricePence: categoryRate, // Use category specific rate
                    timeEstimateMinutes: 60,
                    keywords: [category.toLowerCase(), skill.toLowerCase(), ...skill.toLowerCase().split(' ')],
                    category: category.toLowerCase(),
                    isActive: true
                });
            } else {
                console.log(`Skipping existing: ${skuName}`);
                // Optional: Update price if it differs? For now, we only seed new ones.
                // To force update rates, we'd need a separate update flag/script.
            }
        }
    }

    console.log("✅ Capabilities Seeding Complete!");
    process.exit(0);
}

seed().catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
});
