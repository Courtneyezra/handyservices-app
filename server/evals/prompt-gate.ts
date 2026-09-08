/**
 * 0.7 (8 Sep 2026), part B: no prompt change without its test.
 *
 * Five items of build plan v2 rewrite the Scoper's standing orders. The only conversation-level
 * proof this desk has is a person driving the sandbox by hand: the eval harness exists, but the
 * adapter that grades the Scoper's WORDS needs a live model key, and nothing in the repository
 * refuses a prompt change that ships without a test.
 *
 * The rule, and the whole of it: a change under `server/spine/prompts/` must arrive with a change
 * under `eval-cases/`. It is deliberately blunt. It cannot tell a good eval family from a bad one
 * and does not try; it makes the omission impossible to merge without a person saying so out loud.
 *
 * Pure — a list of changed paths in, a verdict out. `scripts/check-prompt-gate.ts` gets the list
 * from git (locally or in CI) and prints this verdict.
 */

export const PROMPT_PREFIX = 'server/spine/prompts/';
export const EVAL_CASE_PREFIX = 'eval-cases/';

export interface PromptGateVerdict {
    /** false only when a prompt moved and no eval case did. */
    pass: boolean;
    prompts: string[];
    evalCases: string[];
    message: string;
}

function normalise(p: string): string {
    return p.trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Every changed path under server/spine/prompts/. */
export function promptChanges(changed: readonly string[]): string[] {
    return changed.map(normalise).filter((p) => p.startsWith(PROMPT_PREFIX) && p.length > PROMPT_PREFIX.length);
}

/** Every changed path under eval-cases/. */
export function evalCaseChanges(changed: readonly string[]): string[] {
    return changed.map(normalise).filter((p) => p.startsWith(EVAL_CASE_PREFIX) && p.length > EVAL_CASE_PREFIX.length);
}

export function promptGateVerdict(changed: readonly string[]): PromptGateVerdict {
    const prompts = promptChanges(changed);
    const evalCases = evalCaseChanges(changed);
    if (!prompts.length) {
        return { pass: true, prompts, evalCases, message: 'No prompt under server/spine/prompts/ changed. Nothing for the prompt gate to check.' };
    }
    if (evalCases.length) {
        return {
            pass: true,
            prompts,
            evalCases,
            message: [
                `Prompt changed: ${prompts.join(', ')}`,
                `Eval cases changed: ${evalCases.join(', ')}`,
                'Run the affected families against the model before merge:',
                '  EVAL_LIVE=1 ANTHROPIC_API_KEY=… npx tsx scripts/eval-comms.ts --adapter spine --family <family>',
            ].join('\n'),
        };
    }
    return {
        pass: false,
        prompts,
        evalCases,
        message: [
            `PROMPT GATE FAILED. These prompts changed with no eval family beside them:`,
            ...prompts.map((p) => `  - ${p}`),
            '',
            'Its eval family is missing: nothing under eval-cases/ was added or changed in this pull',
            'request, so no test grades the behaviour this prompt is being changed to produce.',
            '',
            'Add or extend the family for the behaviour you are changing (eval-cases/<family>/*.json),',
            'then run it against the model before merge:',
            '  EVAL_LIVE=1 ANTHROPIC_API_KEY=… npx tsx scripts/eval-comms.ts --adapter spine --family <family>',
            '',
            'See docs/RUNBOOK.md §"Changing a prompt" for the rule and its budget.',
        ].join('\n'),
    };
}
