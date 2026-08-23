/**
 * The sceptic verifier — the grey-zone fact-checker for quote readiness.
 *
 * Runs ONLY when the readiness score lands between askBelow and buildAt: the
 * band where code can't decide. One narrow judgement the slot score can't
 * make: "a thread can tick every slot and still not be priceable — is this
 * one?"
 *
 * Design rules (deliberate, argued 23 Aug 2026):
 *  - BLIND: sees the intake and the raw thread, never the clerk's reasoning,
 *    so it can't be anchored by the framing it is checking.
 *  - MUTE: no tools, no messages — returns a structured verdict only.
 *  - REFUTING: prompted to find why the intake is NOT priceable. A verifier
 *    asked "is this OK?" agrees too often; the burden of proof is on
 *    readiness.
 *
 * SHADOW MODE: verdicts are logged next to the clerk's; nothing gates on them
 * yet.
 */
import { getAnthropic } from '../anthropic';
import type { QuoteIntake } from './quote-prep';

export interface VerifierVerdict {
    priceable: boolean;
    /** The single strongest blocker when not priceable; null when priceable. */
    blocker: string | null;
    /** The one question that would clear the blocker, customer-friendly. */
    suggestedAsk: string | null;
}

const SYSTEM = `You are a sceptical quote checker for a UK handyman company. You are shown a
structured job intake extracted from a customer conversation, plus the conversation itself.

An automated pipeline believes this intake may be ready to price WITHOUT asking the customer
anything else. Your one job: try to REFUTE that. Hunt for the reason it is NOT honestly priceable:
- a quantity or size nobody actually stated
- an either/or the customer has not decided (repair vs replace, which room, which option)
- an assumption carrying more of the price than an assumption should
- evidence that describes a SYMPTOM when pricing needs the CAUSE (a leak with no source found)
- anything a competent tradesperson would refuse to put a fixed price on sight-unseen

If you find one, return the SINGLE strongest blocker and the one customer-friendly question that
would clear it (plain English, ends in a question mark, no em dashes). If you genuinely cannot
find a blocker that would change the price or the scope, say it is priceable — do not invent
objections to seem diligent; a false blocker costs the customer a pointless question.

Reply ONLY with JSON: {"priceable": boolean, "blocker": string|null, "suggestedAsk": string|null}`;

export async function verifyIntake(
    intake: QuoteIntake,
    threadText: string,
): Promise<VerifierVerdict | null> {
    try {
        const claude = getAnthropic();
        const payload = [
            'INTAKE (structured):',
            JSON.stringify({
                postcode: intake.postcode,
                lines: intake.lines.map((l) => ({ title: l.title, evidence: l.detail, assumptions: l.assumptions })),
                quoteAssumptions: intake.assumptions,
                openQuestions: intake.gaps.map((g) => ({ q: g.question, impact: g.impact })),
            }, null, 1),
            '',
            'CONVERSATION (newest last):',
            threadText.slice(-6000),
        ].join('\n');

        const message = await claude.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            temperature: 0,
            system: SYSTEM,
            messages: [{ role: 'user', content: payload }],
        });
        const raw = message.content?.[0]?.type === 'text' ? message.content[0].text : '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        return {
            priceable: !!parsed.priceable,
            blocker: typeof parsed.blocker === 'string' && parsed.blocker.trim() ? parsed.blocker.trim().slice(0, 300) : null,
            suggestedAsk: typeof parsed.suggestedAsk === 'string' && parsed.suggestedAsk.trim() ? parsed.suggestedAsk.trim().slice(0, 220) : null,
        };
    } catch (error: any) {
        console.warn('[QuoteVerifier] failed (shadow, non-blocking):', error?.message ?? error);
        return null;
    }
}
