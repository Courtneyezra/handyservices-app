/**
 * AI Job Description Parser
 *
 * Parses a free-text job description (as a customer would describe it on a
 * call) into structured job lines with categories and time estimates.
 * Also detects contextual signals that can pre-fill the Context Signals form.
 *
 * Uses GPT-4o-mini with a low temperature to produce consistent, structured
 * output. Falls back to a single "other" line if the LLM call fails.
 */

import { getOpenAI } from '../openai';
import { JobCategoryValues } from '@shared/contextual-pricing-types';
import type { JobLine, ParsedJobResult } from '@shared/contextual-pricing-types';
import { CATEGORY_RATES } from './reference-rates';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  // Build category list with examples from CATEGORY_RATES
  const categoryList = JobCategoryValues.map((cat) => {
    const rate = CATEGORY_RATES[cat];
    const hourlyPounds = (rate.hourly / 100).toFixed(0);
    const examples: Record<string, string> = {
      general_fixing: 'Shelf hanging, curtain rails, picture hanging, door handles, towel rails',
      flat_pack: 'IKEA/furniture assembly, flatpack wardrobes, desks, beds',
      tv_mounting: 'TV wall mounting, bracket installation',
      carpentry: 'Door fitting, skirting boards, built-in shelves, door hanging',
      plumbing_minor: 'Tap replacement, toilet repair, radiator bleed, washer replacement, leaking pipes',
      electrical_minor: 'Socket fitting, light fixture, extractor fan, switch replacement',
      painting: 'Interior painting, touch-ups, room painting',
      tiling: 'Tiling, grouting, silicone work, bathroom tiles',
      plastering: 'Patch plastering, skim coat, wall repair',
      lock_change: 'Lock replacement, door security, lock fitting',
      guttering: 'Gutter clearing, downpipe repair',
      pressure_washing: 'Driveway cleaning, patio cleaning',
      fencing: 'Fence panel replacement, post repair, garden fencing',
      garden_maintenance: 'Garden tidying, shed assembly, decking repair',
      bathroom_fitting: 'Full bathroom install (complex, multi-trade)',
      kitchen_fitting: 'Kitchen install (complex, multi-trade)',
      other: 'Anything that doesn\'t fit the above categories',
    };
    return `  - ${cat}: ${examples[cat] || 'General work'} (market ~£${hourlyPounds}/hr)`;
  }).join('\n');

  return `You are a job description parser for a Nottingham handyman business.
Your task is to take a free-text job description (as a customer would say on a call) and split it into individual job lines with categories and time estimates.

VALID JOB CATEGORIES:
${categoryList}

TIME ESTIMATE GUIDANCE (from owner's experience):
- Tap replacement: 45min
- Door hanging: 120min
- Flat pack (single item): 60-120min
- Bathroom silicone: 45min
- Socket addition: 90min
- Fence panel: 60-120min
- Gutter clearing: 60min
- Shelf mounting (per shelf): 15-20min
- Toilet repair: 60min
- TV mount: 60min
- Lock change: 45min
- Painting (room touch-up): 120-180min
- Tiling (small area): 120min
- Pressure washing: 120-180min

INSTRUCTIONS:
1. ALWAYS split the description into separate, distinct tasks. Each task should be one unit of work. This is CRITICAL — never combine different tasks into a single line.
2. Even if the customer describes everything in one sentence, break it into individual tasks. E.g. "fix a tap, hang some shelves and paint the bedroom" = 3 separate lines.
3. Assign the most appropriate category to each task.
4. Estimate time based on the guidance above. If unsure, use reasonable estimates.
5. Detect contextual signals from the text (see below).
6. If the description mentions multiple of the same thing (e.g. "3 shelves"), keep as ONE line but adjust time accordingly.
7. Aim for 2-6 line items for a typical multi-task job. Only return 1 line if the job genuinely is a single task.

SIGNAL DETECTION — look for these clues in the text:
- urgency: "urgent", "emergency", "ASAP", "today", "leaking" → "emergency"; "soon", "this week", "priority" → "priority"; otherwise → null
- materialsSupply: "I have the parts", "got the tap already" → "customer_supplied"; "need you to bring", "source the parts" → "we_supply"; otherwise → null
- timeOfService: "evening", "after work", "after 5" → "after_hours"; "weekend", "Saturday", "Sunday" → "weekend"; otherwise → null

ACCESS DIFFICULTY — If the text mentions access difficulty (e.g. "loft", "high ceiling", "crawlspace"), include that detail in the line item description so it's visible for pricing. For example, "fix the loft hatch" → description: "Fix loft hatch (loft access)".

OUTPUT FORMAT — respond with ONLY this JSON (note: multiple lines for multi-task jobs):
{
  "lines": [
    {"description": "Fix leaking kitchen tap", "category": "plumbing_minor", "timeEstimateMinutes": 45},
    {"description": "Hang 3 floating shelves in living room", "category": "shelving", "timeEstimateMinutes": 60},
    {"description": "Assemble IKEA wardrobe", "category": "flat_pack", "timeEstimateMinutes": 120}
  ],
  "detectedSignals": {
    "urgency": "priority" | "emergency" | null,
    "materialsSupply": "customer_supplied" | "we_supply" | null,
    "timeOfService": "after_hours" | "weekend" | null
  }
}

CONSTRAINTS:
- category MUST be one of the valid categories listed above
- timeEstimateMinutes must be a positive integer
- description should be a clean, concise version of what the customer said
- If you can't determine a signal, use null
- Always return at least one line`;
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function buildFallback(description: string): ParsedJobResult {
  return {
    lines: [
      {
        id: '1',
        description,
        category: 'other',
        timeEstimateMinutes: 60,
      },
    ],
    detectedSignals: {
      urgency: null,
      materialsSupply: null,
      timeOfService: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Response Validation
// ---------------------------------------------------------------------------

function validateResponse(parsed: Record<string, unknown>): ParsedJobResult {
  if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
    throw new Error('lines must be a non-empty array');
  }

  const validCategories = new Set<string>(JobCategoryValues);

  const lines: JobLine[] = (parsed.lines as any[]).map((line, i) => {
    const description = String(line.description || '').trim();
    if (!description) {
      throw new Error(`Line ${i}: description is required`);
    }

    let category = String(line.category || 'other');
    if (!validCategories.has(category)) {
      category = 'other';
    }

    let timeEstimateMinutes = Number(line.timeEstimateMinutes);
    if (!Number.isFinite(timeEstimateMinutes) || timeEstimateMinutes <= 0) {
      timeEstimateMinutes = 60;
    }

    return {
      id: String(i + 1),
      description,
      category: category as JobLine['category'],
      timeEstimateMinutes: Math.round(timeEstimateMinutes),
    };
  });

  // Validate detected signals
  const rawSignals = (parsed.detectedSignals || {}) as Record<string, unknown>;

  const validUrgency = ['priority', 'emergency'] as const;
  const validMaterials = ['customer_supplied', 'we_supply'] as const;
  const validTime = ['after_hours', 'weekend'] as const;

  const urgency = validUrgency.includes(rawSignals.urgency as any)
    ? (rawSignals.urgency as 'priority' | 'emergency')
    : null;

  const materialsSupply = validMaterials.includes(rawSignals.materialsSupply as any)
    ? (rawSignals.materialsSupply as 'customer_supplied' | 'we_supply')
    : null;

  const timeOfService = validTime.includes(rawSignals.timeOfService as any)
    ? (rawSignals.timeOfService as 'after_hours' | 'weekend')
    : null;

  return {
    lines,
    detectedSignals: {
      urgency,
      materialsSupply,
      timeOfService,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Parse a free-text job description into structured job lines with categories
 * and time estimates. Also detects contextual signals from the text.
 *
 * Uses GPT-4o-mini for parsing. Falls back to a single "other" line with
 * 60min estimate if the LLM call fails.
 */
export async function parseJobDescription(
  description: string,
): Promise<ParsedJobResult> {
  try {
    const openai = getOpenAI();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(),
        },
        {
          role: 'user',
          content: `Parse this job description into individual lines:\n\n"${description}"`,
        },
      ],
    });

    const raw = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw);
    return validateResponse(parsed);
  } catch (error) {
    console.error(
      '[job-parser] OpenAI call failed, returning fallback:',
      error instanceof Error ? error.message : error,
    );
    return buildFallback(description);
  }
}
