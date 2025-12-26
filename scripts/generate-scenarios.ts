import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTPUT_FILE = path.join(process.cwd(), 'scripts', 'test-data.json');

// Define the scenarios we want to simulate
const prompt = `
You are a QA Engineer for a UK-based Handyman AI Dispatcher.
Generate 20 diverse "User Transcripts" representing people calling a handyman business in the UK.
IMPORTANT: Use British English spelling, vocabulary, and colloquialisms (e.g., "tap" not "faucet", "socket", "flat", "cheers", "mate", "broken down").

Categories to Include:
1. **Easy/Clear**: Explicit single tasks that exist in a standard handyman list (e.g., "replace a socket", "fix a tap").
2. **Multi-Task**: Mixed items (e.g., "hang a mirror and paint the wall").
3. **Vague/Confusion**: "It's just broken", "I have a weird noise", "Lots of issues".
4. **Small Talk/Noise**: "Hello?", "Are you real?", "Can I talk to a human?".
5. **Complex/Safety**: "I smell gas", "I want to rewire the whole house", "Commercial office fit-out".

Output Format (JSON Array):
[
  {
    "transcript": "string",
    "category": "Easy" | "Multi" | "Vague" | "Noise" | "Complex",
    "expectedRoute": "INSTANT_PRICE" | "VIDEO_QUOTE" | "SITE_VISIT" | "NO_ACTION",
    "notes": "Why this route?"
  }
]

Strictly return ONLY the JSON array.
`;

async function generateScenarios() {
  console.log("🤖 Asking AI to generate synthetic call scenarios...");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "You are a test data generator." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    console.log("DEBUG RAW CONTENT:", content?.slice(0, 200)); // Print first 200 chars
    const data = JSON.parse(content || "{\"scenarios\": []}");

    // Handle if GPT returns { scenarios: [...] } or { transcripts: [...] } or just [...]
    const scenarios = Array.isArray(data) ? data : (data.scenarios || data.transcripts || []);

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(scenarios, null, 2));

    console.log(`✅ Generated ${scenarios.length} scenarios. Saved to ${OUTPUT_FILE}`);
    console.log("preview:", scenarios.slice(0, 2));

  } catch (error) {
    console.error("Failed to generate data:", error);
  }
}

generateScenarios();
