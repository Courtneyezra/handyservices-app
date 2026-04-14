x**
 * Seed DIY Advice Database
 *
 * Populates the diy_advice and unsafe_patterns tables with initial data
 * from the previously hardcoded getDIYAdvice() function.
 *
 * Run: npx tsx scripts/seed-diy-advice.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { diyAdvice, unsafePatterns } from '../shared/schema';

const UNSAFE_PATTERNS_DATA = [
    { pattern: "gas", isRegex: false, warningMessage: null },
    { pattern: "electric", isRegex: false, warningMessage: null },
    { pattern: "spark", isRegex: false, warningMessage: null },
    { pattern: "smoke", isRegex: false, warningMessage: null },
    { pattern: "fire", isRegex: false, warningMessage: null },
    { pattern: "flood", isRegex: false, warningMessage: null },
    { pattern: "burst", isRegex: false, warningMessage: null },
    { pattern: "structural", isRegex: false, warningMessage: null },
    { pattern: "ceiling.*(collapse|fall)", isRegex: true, warningMessage: "Ceiling damage detected - do not stand underneath. A professional needs to assess structural safety." },
    { pattern: "unsafe", isRegex: false, warningMessage: null },
];

const DIY_ENTRIES = [
    {
        name: "Dripping Tap",
        category: "plumbing" as const,
        keywords: ["tap", "drip", "dripping"],
        descriptionPatterns: ["dripping"],
        canDIY: true,
        steps: [
            "First, turn off the water supply under the sink",
            "Wait a minute, then turn it back on",
            "If still dripping, the washer inside may need replacing",
            "For a quick temporary fix, try tightening the tap handle"
        ],
        toolsNeeded: ["Adjustable wrench (optional)"],
        warning: null,
        priority: 10,
    },
    {
        name: "Blocked Drain",
        category: "plumbing" as const,
        keywords: ["drain", "block", "blocked"],
        descriptionPatterns: ["slow drain"],
        canDIY: true,
        steps: [
            "Try pouring boiling water down the drain",
            "If that doesn't work, use a plunger over the drain",
            "Create a seal and pump up and down firmly",
            "You can also try a mixture of baking soda and vinegar"
        ],
        toolsNeeded: ["Plunger", "Boiling water"],
        warning: "Never use chemical drain cleaners with other products",
        priority: 10,
    },
    {
        name: "Running Toilet",
        category: "plumbing" as const,
        keywords: ["toilet"],
        descriptionPatterns: ["running"],
        canDIY: true,
        steps: [
            "Lift the cistern lid and check the float",
            "The float should rise with water level and stop the fill",
            "Try gently lifting the float arm - if water stops, adjust the float lower",
            "Check the flapper valve at the bottom isn't stuck open"
        ],
        toolsNeeded: [],
        warning: null,
        priority: 10,
    },
    {
        name: "Squeaky Door",
        category: "carpentry" as const,
        keywords: ["door"],
        descriptionPatterns: ["squeak", "creak"],
        canDIY: true,
        steps: [
            "Spray WD-40 or any household oil on the hinges",
            "Open and close the door several times to work it in",
            "Wipe off any excess oil"
        ],
        toolsNeeded: ["WD-40 or cooking oil"],
        warning: null,
        priority: 10,
    },
    {
        name: "Cold Radiator",
        category: "heating" as const,
        keywords: ["radiator"],
        descriptionPatterns: ["cold"],
        canDIY: true,
        steps: [
            "The radiator may need bleeding (releasing trapped air)",
            "Turn off your heating first",
            "Use a radiator key to open the bleed valve at the top",
            "Hold a cloth underneath to catch drips",
            "When water comes out steadily, close the valve"
        ],
        toolsNeeded: ["Radiator key (or flat screwdriver for some models)", "Cloth"],
        warning: "If multiple radiators are cold, the boiler may need checking",
        priority: 10,
    },
    {
        name: "Light Bulb Replacement",
        category: "electrical" as const,
        keywords: ["bulb"],
        descriptionPatterns: ["light"],
        canDIY: true,
        steps: [
            "Make sure the light switch is OFF",
            "Wait for the bulb to cool if it was recently on",
            "Unscrew the old bulb and check the wattage",
            "Screw in a new bulb of the same type and wattage"
        ],
        toolsNeeded: ["Replacement bulb"],
        warning: "If the new bulb doesn't work, it may be a wiring issue - call us",
        priority: 10,
    },
];

async function seed() {
    console.log("🔧 Seeding DIY Advice Database...\n");

    try {
        // Seed unsafe patterns
        console.log("📛 Seeding unsafe patterns...");
        for (const pattern of UNSAFE_PATTERNS_DATA) {
            await db.insert(unsafePatterns).values({
                pattern: pattern.pattern,
                isRegex: pattern.isRegex,
                warningMessage: pattern.warningMessage,
                isActive: true,
            });
        }
        console.log(`   ✅ ${UNSAFE_PATTERNS_DATA.length} unsafe patterns seeded`);

        // Seed DIY advice entries
        console.log("\n💡 Seeding DIY advice entries...");
        for (const entry of DIY_ENTRIES) {
            await db.insert(diyAdvice).values({
                name: entry.name,
                category: entry.category,
                keywords: entry.keywords,
                descriptionPatterns: entry.descriptionPatterns,
                canDIY: entry.canDIY,
                steps: entry.steps,
                toolsNeeded: entry.toolsNeeded,
                warning: entry.warning,
                priority: entry.priority,
                isActive: true,
            });
        }
        console.log(`   ✅ ${DIY_ENTRIES.length} DIY advice entries seeded`);

        console.log("\n🎉 Seeding complete!");
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }

    process.exit(0);
}

seed();
