/**
 * Quote Estimator Agent — researches materials, time, and procedure for each intake line.
 *
 * Takes job lines from the intake clerk (or raw builder input) and produces a QuoteBuild:
 * materials (catalog -> Screwfix -> web fallback), time estimates (historical + model),
 * procedure steps, and assumptions. Ben remains human-in-loop for pricing.
 */
import { db } from '../db';
import { conversations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { runAgent } from './runner';
import { buildEstimatorTools, normalizeQuoteBuild } from './estimator-tools';
export { normalizeQuoteBuild }; // Re-export for tests
import type { QuoteBuild, EstimatorLineInput } from '@shared/quote-build';
import type { IntakeLine } from './quote-prep';

export const SYSTEM = `You are the quote estimator. Given job lines from the intake clerk, you research what each line requires:

1. MATERIALS — search the catalog first (instant, verified prices), then Screwfix (live, verified), then web (needs human review). Every material needs: name, qty, price. Flag needsReview=true for web/model prices.

2. TIME — check historical data first (similar jobs we've done), then model estimate. Always give a confidence level. Never pad time "just in case".

3. PROCEDURE — write 3-6 clear steps a contractor follows. Format: "Verb phrase — detail". Example: "Isolate water — turn off stopcock under sink".

4. ASSUMPTIONS — price caveats that could change the job (access, condition, existing fittings).

Rules:
- You research, Ben prices. Never state a £ total.
- If you can't find a material, flag it in unresolved — don't guess a price.
- One search_materials call per distinct material (batch where sensible).
- If a line is already declined (gas_work, roofing_height), skip it with a note.`;

/**
 * Convert IntakeLine[] to the minimal shape the estimator works with.
 */
function intakeLinesToInput(lines: IntakeLine[]): EstimatorLineInput[] {
    return lines.map((line) => ({
        description: line.title,
        category: undefined, // Will be inferred by the model
    }));
}

export interface EstimatorRunOpts {
    /** Conversation ID to load the clerk's intake from (server/intake.ts getIntake) */
    conversationId?: string;
    /** Direct lines input (builder-only mode) */
    lines?: IntakeLine[];
}

export async function runEstimator(opts: EstimatorRunOpts): Promise<{
    build: QuoteBuild | null;
    summary: string;
    turns: number;
}> {
    let inputLines: IntakeLine[] = [];
    let conversationId: string | undefined = opts.conversationId;

    // Load the clerk's intake if conversationId provided — P8: ONE source (server/intake.ts),
    // the spine clerk's artifact first, the legacy metadata blob only for pre-spine threads.
    if (opts.conversationId && !opts.lines) {
        const [conv] = await db
            .select({ id: conversations.id, phoneNumber: conversations.phoneNumber })
            .from(conversations)
            .where(eq(conversations.id, opts.conversationId));

        if (!conv) {
            throw new Error(`Conversation ${opts.conversationId} not found`);
        }

        const { getIntake, toQuoteIntake } = await import('../intake');
        const record = await getIntake(opts.conversationId);
        const intake = record ? toQuoteIntake(record, conv.phoneNumber) : null;

        if (!intake?.lines || !Array.isArray(intake.lines) || intake.lines.length === 0) {
            throw new Error(
                `Conversation ${opts.conversationId} has no quote intake. Run the clerk first.`
            );
        }

        inputLines = intake.lines;
    } else if (opts.lines) {
        inputLines = opts.lines;
        conversationId = undefined; // Builder-only mode has no conversation
    } else {
        throw new Error('Either conversationId or lines must be provided.');
    }

    if (inputLines.length === 0) {
        throw new Error('No lines to estimate.');
    }

    // Build tools with conversation context
    const { tools, getBuild } = buildEstimatorTools({ conversationId });

    // Format the goal with the lines
    const linesDescription = inputLines
        .map((line, i) => `${i + 1}. ${line.title}${line.detail ? ` — ${line.detail}` : ''}`)
        .join('\n');

    const goal = `Estimate the following job lines:\n\n${linesDescription}\n\nResearch materials, time, and procedure for each line, then submit_build.`;

    const result = await runAgent({
        name: 'quote-estimator',
        system: SYSTEM,
        goal,
        tools,
        model: 'claude-sonnet-5',
        maxTurns: 12,
        maxTokens: 8000,
    });

    return {
        build: getBuild(),
        summary: result.finalText,
        turns: result.turns,
    };
}

/** Staff-directory card. */
export const STAFF = {
    id: 'quote-estimator',
    name: 'Quote Estimator',
    roleTitle: 'Materials & Time Researcher',
    mission:
        'Takes job lines from the intake clerk and researches what each requires: materials (catalog-first, then suppliers, then web fallback), time estimates (historical data + model), procedure steps, and assumptions. Output pre-fills the builder as a confirm/select wizard. Ben remains human-in-loop for pricing.',
    model: 'claude-sonnet-5',
    cadence: 'On demand, after quote-prep completes intake',
    autonomy: {
        freely: [
            'Search materials catalog and suppliers',
            'Query historical job times',
            'Look up procedure steps from DIY advice',
            'Search web for materials not in catalog (flagged for review)',
        ],
        approval: [
            'Everything — output prefills the builder; Ben prices and sends',
        ],
        never: [
            'State a price total',
            'Guess a material price without flagging it',
            'Message a customer',
        ],
    },
    tools: [
        { name: 'search_materials', blurb: 'Catalog + Screwfix search', kind: 'read' },
        { name: 'search_web', blurb: 'Web fallback for unknown materials', kind: 'read' },
        { name: 'get_time_history', blurb: 'Historical quote/job times', kind: 'read' },
        { name: 'get_procedures', blurb: 'DIY advice steps & tools', kind: 'read' },
        { name: 'submit_build', blurb: 'Validated QuoteBuild submission', kind: 'write' },
    ],
} as const;
