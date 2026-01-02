

import dotenv from "dotenv";
dotenv.config();

// Dynamic import to ensure env vars are loaded first
async function runTest() {
    const { extractCallMetadata } = await import("../server/openai");
    console.log("Testing Multi-Candidate Name Extraction...");

    // Ambiguous Transcript
    const transcript = `
Speaker 0: Hello, handy services, how can I help?
Speaker 1: Hi, I'm calling for my husband Mike, he needs a quote for a TV mount.
Speaker 0: Okay, no problem. What is your name?
Speaker 1: My name is Sarah.
Speaker 0: Nice to meet you Sarah. And the address?
Speaker 1: It's 123 Main St.
    `;

    // Mock Segments
    const segments = [
        { speaker: 0, text: "Hello, handy services, how can I help?", timestamp: 0 },
        { speaker: 1, text: "Hi, I'm calling for my husband Mike, he needs a quote for a TV mount.", timestamp: 5 },
        { speaker: 0, text: "Okay, no problem. What is your name?", timestamp: 10 },
        { speaker: 1, text: "My name is Sarah.", timestamp: 15 },
        { speaker: 0, text: "Nice to meet you Sarah. And the address?", timestamp: 20 },
        { speaker: 1, text: "It's 123 Main St.", timestamp: 25 },
    ];

    console.log("Analyzing transcript...");
    const metadata = await extractCallMetadata(transcript, segments);

    console.log("--- RESULT ---");
    console.log("Selected Name:", metadata.customerName);
    console.log("Candidates:", JSON.stringify(metadata.nameCandidates, null, 2));

    if (metadata.nameCandidates && metadata.nameCandidates.length > 0) {
        console.log("✅ Candidates extracted!");
        if (metadata.customerName === metadata.nameCandidates[0].name) {
            console.log("✅ Top candidate selected as customerName.");
        } else {
            console.error("❌ Mismatch between top candidate and customerName.");
        }
    } else {
        console.error("❌ No candidates extracted.");
    }
}

runTest().catch(console.error);
