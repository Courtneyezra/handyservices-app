import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { detectMultipleTasks } from '../server/skuDetector';
import { productizedServices } from '../shared/schema';

const DATA_FILE = path.join(process.cwd(), 'scripts', 'test-data.json');
const REAL_DATA_FILE = path.join(process.cwd(), 'scripts', 'real-data.json');
const TWILIO_IMPORT_FILE = path.join(process.cwd(), 'scripts', 'twilio-import.json');
const REPORT_FILE = path.join(process.cwd(), 'scripts', 'eval-report.md');

async function runEvals() {
    console.log("🚀 Starting AI Evaluation Loop...");

    // Load Synthetic Data
    let scenarios: any[] = [];
    if (fs.existsSync(DATA_FILE)) {
        scenarios = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }

    // Load Real Data
    if (fs.existsSync(REAL_DATA_FILE)) {
        const realData = JSON.parse(fs.readFileSync(REAL_DATA_FILE, 'utf-8'));
        console.log(`Loading ${realData.length} Real-World scenarios...`);
        scenarios = [...scenarios, ...realData];
    }

    // Load Twilio Imported Data
    if (fs.existsSync(TWILIO_IMPORT_FILE)) {
        const twilioData = JSON.parse(fs.readFileSync(TWILIO_IMPORT_FILE, 'utf-8'));
        console.log(`Loading ${twilioData.length} Twilio Imports...`);
        // Note: These default to MANUAL_REVIEW, so evals will likely mark 'Fail' unless we update expectedRoute.
        // But running them still exercises the code for crashes/safety.
        scenarios = [...scenarios, ...twilioData];
    }
    let passed = 0;
    let failed = 0;
    let report = `# AI Evaluation Report (${new Date().toISOString()})\n\n`;

    report += `| Result | Category | Transcript | Expected | Actual | Rationale |\n`;
    report += `|--------|----------|------------|----------|--------|-----------|\n`;

    for (const testCase of scenarios) {
        // Run the actual system logic
        const result = await detectMultipleTasks(testCase.transcript);

        // Determine "Pass" criteria
        // Normalize System Outcome
        let normalizedOutcome = result.nextRoute;
        if (result.nextRoute === 'MIXED_QUOTE') normalizedOutcome = 'SITE_VISIT'; // Complex/Mixed maps to Visit/Human Review

        // Logic for specific categories
        let isMatch = false;
        let systemOutcome = result.nextRoute as string; // Keep original for logging

        if (testCase.category === 'Noise') {
            // For Noise, we accept NO_ACTION or VIDEO_QUOTE (Safe default)
            isMatch = (systemOutcome === 'VIDEO_QUOTE' || systemOutcome === 'NO_ACTION');
        } else if (testCase.category === 'Vague') {
            // Vague can be VIDEO_QUOTE (safe) or SITE_VISIT
            isMatch = (systemOutcome === 'VIDEO_QUOTE' || systemOutcome === 'SITE_VISIT');
        } else if (testCase.category === 'Multi') {
            // Multi can normally be VIDEO, MIXED, or VISIT. Instant Price is usually wrong unless strict match.
            isMatch = ['VIDEO_QUOTE', 'MIXED_QUOTE', 'SITE_VISIT'].includes(systemOutcome);
        } else {
            // Strict match for Easy/Complex
            isMatch = (testCase.expectedRoute === normalizedOutcome);
        }

        const icon = isMatch ? '✅' : '❌';
        if (isMatch) passed++; else failed++;

        console.log(`${icon} [${testCase.category}] ${testCase.transcript.slice(0, 40)}... -> ${systemOutcome}`);

        report += `| ${icon} | ${testCase.category} | "${testCase.transcript}" | ${testCase.expectedRoute} | ${systemOutcome} | ${result.tasks.length} tasks detected |\n`;
    }

    const accuracy = ((passed / scenarios.length) * 100).toFixed(1);

    report += `\n## Summary\n`;
    report += `- **Total Cases**: ${scenarios.length}\n`;
    report += `- **Passed**: ${passed}\n`;
    report += `- **Failed**: ${failed}\n`;
    report += `- **Accuracy**: ${accuracy}%\n`;

    fs.writeFileSync(REPORT_FILE, report);
    console.log(`\n📋 Evals Complete. Accuracy: ${accuracy}%. Report saved to ${REPORT_FILE}`);
}

runEvals();
