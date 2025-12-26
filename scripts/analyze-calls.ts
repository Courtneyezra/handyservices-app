
import * as fs from 'fs';
import * as path from 'path';

// Define keywords for clustering
const CLUSTERS = {
    'Spam/Marketing': ['google', 'online technology', 'ai agency', 'marketing', 'qualified for', 'business is qualified'],
    'Voicemail/Missed': ['forwarded to voice mail', 'not available', 'record your message', 'temporarily unavailable', 'call has been forwarded'],
    'Furniture/Assembly': ['ikea', 'assembly', 'wardrobe', 'flat pack', 'assemble', 'toys', 'trampoline', 'bed', 'sofa'],
    'Hanging/Mounting': ['tv', 'hang', 'mount', 'mirror', 'picture', 'curtain', 'blinds', 'shelf', 'shelves'],
    'Plumbing/Leaks': ['leak', 'drip', 'shower', 'bath', 'sink', 'seal', 'plumber', 'tap'],
    'Electrical': ['light', 'bulb', 'socket', 'switch', 'electric', 'chandelier'],
    'Outdoor/Garden': ['shed', 'fence', 'roof', 'garden', 'gate'],
    'Door/Lock': ['door', 'lock', 'handle', 'hinge', 'sticking'],
};

function analyzeCalls() {
    const dataPath = path.join(process.cwd(), 'data', 'twilio_calls_dump.json');
    if (!fs.existsSync(dataPath)) {
        console.error("Data file not found.");
        return;
    }

    const calls = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Analyzing ${calls.length} calls...`);

    const stats = {
        total: calls.length,
        transcribed: 0,
        clusters: {} as Record<string, number>,
        unclassified: 0
    };

    // Initialize clusters
    Object.keys(CLUSTERS).forEach(k => stats.clusters[k] = 0);

    for (const call of calls) {
        if (!call.transcript) continue;
        stats.transcribed++;

        const text = call.transcript.toLowerCase();
        let categorized = false;

        for (const [category, keywords] of Object.entries(CLUSTERS)) {
            if (keywords.some(k => text.includes(k))) {
                stats.clusters[category]++;
                categorized = true;
                // Don't break, a call could be multiple things, but for stats maybe we want primary?
                // Let's count all matches for now to see signals
            }
        }

        if (!categorized) {
            stats.unclassified++;
            // Log unmatched for manual review sampling
            if (Math.random() > 0.95) { // 5% sample
                console.log(`[Unclassified Sample]: "${call.transcript.substring(0, 100)}..."`);
            }
        }
    }

    console.log("\n=== Analysis Results ===");
    console.log(`Total Calls: ${stats.total}`);
    console.log(`Successfully Transcribed: ${stats.transcribed} (${((stats.transcribed / stats.total) * 100).toFixed(1)}%)`);

    console.log("\n--- Category Breakdown ---");
    Object.entries(stats.clusters)
        .sort(([, a], [, b]) => b - a)
        .forEach(([cat, count]) => {
            console.log(`${cat}: ${count}`);
        });

    console.log(`\nUnclassified: ${stats.unclassified}`);
}

analyzeCalls();
