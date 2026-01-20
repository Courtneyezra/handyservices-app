
import { analyzeLeadActionPlan } from "../server/services/agentic-service";
import dotenv from "dotenv";

// Load env vars
dotenv.config();

async function runTest() {
    console.log("--- STARTING AGENTIC FLOW TEST ---");

    // Test Case 1: Simple Job, Tenant, Low Urgency
    const transcript1 = "Hi, I'm a tenant at 123 Main St. My kitchen tap is dripping a bit and I need it fixed. It's not urgent, just annoying.";
    console.log(`\n\nAnalyzing Transcript 1: "${transcript1}"`);
    const plan1 = await analyzeLeadActionPlan(transcript1);
    console.log("RESULT PLAN 1:", JSON.stringify(plan1, null, 2));

    // Test Case 2: Complex/Emergency
    const transcript2 = "I smell gas in the kitchen and the boiler makes a weird noise! I'm the homeowner.";
    console.log(`\n\nAnalyzing Transcript 2: "${transcript2}"`);
    const plan2 = await analyzeLeadActionPlan(transcript2);
    console.log("RESULT PLAN 2:", JSON.stringify(plan2, null, 2));

    console.log("\n--- TEST COMPLETE ---");
    process.exit(0);
}

runTest().catch(console.error);
