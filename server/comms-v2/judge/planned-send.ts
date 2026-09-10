/**
 * Contract 7, piece one: the planned send.
 *
 * What a dry-run exit emits instead of delivering: case id, party, channel, window state, the
 * template id if any, the rendered bubbles, the fact ids and knowledge-base ids cited, every
 * guard's result, the approver, the run id, and the hold if one was raised.
 *
 * The current desk (server/spine) has no structured planned send: a dry run produces a sentence
 * and an `ExitOutcome` exists only on a live send. So this module is an ADAPTER over what the
 * sandbox door (/api/comms-sandbox) already returns for one pass - the run summary, the mirrored
 * first-contact ack, the decision - normalised into the Contract 7 shape. A field the old desk
 * cannot supply is recorded as the literal `unavailable`, never guessed and never omitted. The new
 * desk (Goal 1 onward) emits this object itself; the adapter then goes.
 *
 * Nothing under server/spine is modified or called from here: the adapter reads a door response.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- the shape

export const UNAVAILABLE = 'unavailable' as const;
export type Unavailable = typeof UNAVAILABLE;

/** The eight guards of Contract 4, by name. The old desk's guard names map onto these (see GUARD_MAP). */
export const CONTRACT_GUARDS = [
    'figure', 'date_time_duration', 'commitment_fault', 'business_claim',
    'disclosure', 'one_reply', 'ask_ledger', 'regulated',
] as const;
export type ContractGuard = (typeof CONTRACT_GUARDS)[number];

export const guardResultSchema = z.object({
    result: z.enum(['pass', 'fail', UNAVAILABLE]),
    /** Which of the old desk's guards this result was read from, when it was. */
    via: z.array(z.string()).default([]),
    note: z.string().nullable().default(null),
});
export type GuardResult = z.infer<typeof guardResultSchema>;

export const holdSchema = z.object({
    approver: z.string(),
    reason: z.string(),
    since: z.string().nullable().default(null),
});
export type Hold = z.infer<typeof holdSchema>;

export const plannedSendSchema = z.object({
    /** Contract 2 case id. On the old desk, the sandbox conversation id. */
    caseId: z.string().min(1),
    party: z.object({
        role: z.enum(['homeowner', 'tenant', 'landlord', 'contractor', 'internal']),
        /** The canonical address the reply goes to. */
        address: z.string().min(1),
        name: z.string().nullable(),
    }),
    channel: z.union([z.enum(['whatsapp', 'sms', 'email']), z.literal(UNAVAILABLE)]),
    windowState: z.union([z.enum(['open', 'shut']), z.literal(UNAVAILABLE)]),
    /** Null when the reply is freeform inside the window; a name when a template carries it. */
    templateId: z.union([z.string(), z.null(), z.literal(UNAVAILABLE)]),
    /** The rendered bubbles. Empty when nothing would go to the customer on this turn. */
    bubbles: z.array(z.string()),
    factIds: z.union([z.array(z.string()), z.literal(UNAVAILABLE)]),
    kbIds: z.union([z.array(z.string()), z.literal(UNAVAILABLE)]),
    guards: z.record(z.enum(CONTRACT_GUARDS), guardResultSchema),
    approver: z.union([z.string(), z.null(), z.literal(UNAVAILABLE)]),
    runId: z.union([z.string().min(1), z.literal(UNAVAILABLE)]),
    hold: z.union([holdSchema, z.null(), z.literal(UNAVAILABLE)]),
    /** True when a reply would reach the customer on this turn (bubbles non-empty and the desk decided to send). */
    delivered: z.boolean(),
    /** Provenance, so a reader can see which part of the old desk wrote the bubbles. */
    origin: z.enum(['desk', 'rules_layer_mirror', 'none']),
    /** The old desk's own words about what it decided, kept as evidence beside the normalised fields. */
    evidence: z.object({
        decision: z.string().nullable(),
        intent: z.string().nullable(),
        lane: z.string().nullable(),
        pack: z.string().nullable(),
        stageAfter: z.string().nullable(),
        exitNote: z.string().nullable(),
        legacyGuardsHit: z.array(z.string()),
        legacyGuardNotes: z.array(z.string()),
        mirrorLiveWouldSend: z.boolean().nullable(),
        error: z.string().nullable(),
    }),
});
export type PlannedSend = z.infer<typeof plannedSendSchema>;

/** Every Contract 4 guard recorded as unavailable - the shape when no guard ran on the old desk. */
export function allGuardsUnavailable(note: string): Record<ContractGuard, GuardResult> {
    const out = {} as Record<ContractGuard, GuardResult>;
    for (const g of CONTRACT_GUARDS) out[g] = { result: UNAVAILABLE, via: [], note };
    return out;
}

// ---------------------------------------------------------------- the door's shape, as read here

/**
 * What one sandbox pass looks like on the wire (POST /start, /message, /run, /call). Loose on
 * purpose: only the fields the adapter reads are named, everything else passes through. A door
 * response that does not fit is a runner error, never a guessed planned send.
 */
export const doorRunSchema = z.object({
    runId: z.string(),
    agent: z.string().optional(),
    trigger: z.string().optional(),
    pack: z.object({ id: z.string() }).passthrough().optional(),
    triage: z.object({ lane: z.string().optional(), intent: z.string().optional(), stage: z.string().optional() }).passthrough().optional(),
    proposal: z.object({
        intent: z.string().optional(),
        body: z.array(z.string()).optional(),
        citations: z.array(z.string()).optional(),
        flag: z.object({ exception: z.string(), note: z.string().optional() }).passthrough().nullable().optional(),
    }).passthrough().nullable().optional(),
    guards: z.object({ ok: z.boolean(), guardsHit: z.array(z.string()).default([]), notes: z.array(z.string()).default([]) }).passthrough().nullable().optional(),
    decision: z.object({ kind: z.string(), approver: z.unknown().optional(), exception: z.string().optional(), note: z.string().optional(), reason: z.string().optional(), dueAt: z.string().optional() }).passthrough(),
    exitNote: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    caseFile: z.object({
        stage: z.string().optional(),
        tags: z.array(z.string()).optional(),
        window: z.object({ canFreeform: z.boolean() }).passthrough().optional(),
    }).passthrough().optional(),
}).passthrough();
export type DoorRun = z.infer<typeof doorRunSchema>;

export const doorMirrorSchema = z.object({
    kind: z.string().optional(),
    intent: z.string().optional(),
    body: z.string(),
    messageId: z.string().nullable().optional(),
    plan: z.object({
        mode: z.string(),
        channel: z.enum(['whatsapp', 'sms']).nullable(),
        templateName: z.string().nullable().optional(),
        gate: z.object({ liveWouldSend: z.boolean() }).passthrough().optional(),
    }).passthrough(),
}).passthrough();
export type DoorMirror = z.infer<typeof doorMirrorSchema>;

export const doorStateSchema = z.object({
    phone: z.object({ e164: z.string(), wa: z.string().optional() }).passthrough(),
    conversation: z.object({ id: z.string(), stage: z.string().nullable().optional(), tags: z.array(z.string()).optional(), contactName: z.string().nullable().optional() }).passthrough().nullable(),
    window: z.object({ canFreeform: z.boolean() }).passthrough().optional(),
}).passthrough();
export type DoorState = z.infer<typeof doorStateSchema>;

/** One door response that carried a pass. */
export const doorPassSchema = z.object({
    ok: z.boolean().optional(),
    run: doorRunSchema.nullable(),
    mirrored: doorMirrorSchema.nullable().optional(),
    state: doorStateSchema,
}).passthrough();
export type DoorPass = z.infer<typeof doorPassSchema>;

// ---------------------------------------------------------------- old guard names -> Contract 4

/** The old desk's guard names (server/spine/types.ts GuardName) that read on each Contract 4 guard. */
export const GUARD_MAP: Record<ContractGuard, readonly string[]> = {
    figure: ['money', 'discount', 'price_objection', 'money_to_customer'],
    date_time_duration: ['date_promise', 'duration_claim'],
    commitment_fault: ['policy_commitment', 'soft_commitment', 'liability', 'capitulation'],
    business_claim: ['capability_claim'],
    disclosure: [],
    one_reply: [],
    ask_ledger: [],
    regulated: [],
};

const NO_LEGACY_GUARD = 'the current desk has no guard of this kind';
const NO_GUARD_RAN = 'no guard ran on this pass (no proposal reached the guards)';

/** Contract 4 results read off the old desk's single verdict. Pure. */
export function guardsFrom(verdict: { ok: boolean; guardsHit: string[]; notes?: string[] } | null | undefined): Record<ContractGuard, GuardResult> {
    if (!verdict) return allGuardsUnavailable(NO_GUARD_RAN);
    const out = {} as Record<ContractGuard, GuardResult>;
    for (const g of CONTRACT_GUARDS) {
        const via = GUARD_MAP[g];
        if (!via.length) { out[g] = { result: UNAVAILABLE, via: [], note: NO_LEGACY_GUARD }; continue; }
        const hit = via.filter((name) => verdict.guardsHit.includes(name));
        out[g] = { result: hit.length ? 'fail' : 'pass', via: [...via], note: hit.length ? `hit: ${hit.join(', ')}` : null };
    }
    return out;
}

// ---------------------------------------------------------------- the adapter

export interface AdapterInput {
    /** The door response for this turn, already shape-checked. */
    pass: DoorPass;
    /** The window as the sandbox reported it after the turn (state.window), or null when it did not. */
    windowOpen: boolean | null;
}

/**
 * One planned send from one door response. Deterministic: the same response gives the same object.
 *
 * Rules, in order:
 *  - decision `send`: the desk's proposal bubbles go, approver from the decision.
 *  - decision `none` with a mirrored first-contact ack: the rules layer's ack goes (origin
 *    rules_layer_mirror). This is what the live rules layer sends on first contact.
 *  - decision `flag`: nothing goes; a hold for Ben with the exception as the reason.
 *  - decision `pending`, `drop`, or `none` with no mirror: nothing goes.
 * Guards come from the old verdict via GUARD_MAP. Fact ids and knowledge-base ids are unavailable:
 * the old desk records neither. Template id is null on a freeform WhatsApp send inside the window,
 * the template name on a mirrored template ack, and unavailable when the window is shut and the
 * old desk did not say which template it would pick.
 */
export function plannedSendFrom(input: AdapterInput): PlannedSend {
    const { pass, windowOpen } = input;
    const run = pass.run;
    const mirror = pass.mirrored ?? null;
    const conv = pass.state.conversation;
    const caseId = conv?.id ?? UNAVAILABLE;
    const decisionKind = run?.decision.kind ?? null;
    const windowState: PlannedSend['windowState'] = windowOpen == null ? UNAVAILABLE : windowOpen ? 'open' : 'shut';

    let bubbles: string[] = [];
    let origin: PlannedSend['origin'] = 'none';
    let channel: PlannedSend['channel'] = UNAVAILABLE;
    let templateId: PlannedSend['templateId'] = UNAVAILABLE;
    let approver: PlannedSend['approver'] = null;
    let hold: PlannedSend['hold'] = null;
    let delivered = false;

    if (run && decisionKind === 'send') {
        bubbles = (run.proposal?.body ?? []).filter((b) => typeof b === 'string' && b.trim().length > 0);
        origin = 'desk';
        delivered = bubbles.length > 0;
        channel = 'whatsapp';
        approver = approverName(run.decision.approver);
        // The old desk picks a template inside the exit, which a dry run never reaches.
        templateId = windowOpen === true ? null : UNAVAILABLE;
    } else if (mirror && mirror.plan.channel && mirror.body.trim()) {
        bubbles = splitAckBubbles(mirror.body);
        origin = 'rules_layer_mirror';
        delivered = true;
        channel = mirror.plan.channel;
        templateId = mirror.plan.mode === 'template' ? (mirror.plan.templateName ?? UNAVAILABLE) : null;
        approver = 'rules_layer';
    }

    if (run && decisionKind === 'flag') {
        hold = { approver: 'ben', reason: run.decision.exception ?? run.decision.note ?? 'flagged', since: run.decision.dueAt ?? null };
        approver = null;
    }
    if (run && decisionKind === 'pending') {
        // A draft waits for Ben on the old desk: nothing goes, and the customer hears nothing.
        approver = null;
    }

    return {
        caseId,
        party: { role: 'homeowner', address: pass.state.phone.e164, name: conv?.contactName ?? null },
        channel,
        windowState,
        templateId,
        bubbles,
        factIds: UNAVAILABLE,
        kbIds: UNAVAILABLE,
        guards: guardsFrom(run?.guards ?? null),
        approver,
        runId: run?.runId ?? UNAVAILABLE,
        hold,
        delivered,
        origin,
        evidence: {
            decision: decisionKind,
            intent: run?.proposal?.intent ?? run?.triage?.intent ?? mirror?.intent ?? null,
            lane: run?.triage?.lane ?? null,
            pack: run?.pack?.id ?? null,
            stageAfter: conv?.stage ?? run?.caseFile?.stage ?? null,
            exitNote: run?.exitNote ?? null,
            legacyGuardsHit: run?.guards?.guardsHit ?? [],
            legacyGuardNotes: run?.guards?.notes ?? [],
            mirrorLiveWouldSend: mirror?.plan.gate?.liveWouldSend ?? null,
            error: run?.error ?? null,
        },
    };
}

/**
 * The old rules layer composes its first-contact ack as bubbles joined by a line holding `---`
 * (server/first-contact-ack.ts); the sender splits on it. The planned send carries the rendered
 * bubbles, so the same split applies here. Pure.
 */
export function splitAckBubbles(body: string): string[] {
    return body.split(/\n\s*---\s*\n/).map((b) => b.trim()).filter(Boolean);
}

function approverName(raw: unknown): string | null {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        for (const k of ['id', 'name', 'kind', 'who']) if (typeof o[k] === 'string') return o[k] as string;
        return JSON.stringify(raw);
    }
    return null;
}

/** Shape-check a door response and build the planned send, or throw with the schema's reason. */
export function plannedSendFromDoorResponse(raw: unknown): { pass: DoorPass; plannedSend: PlannedSend } {
    const parsed = doorPassSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`door response is not a pass: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const pass = parsed.data;
    const windowOpen = pass.state.window?.canFreeform ?? pass.run?.caseFile?.window?.canFreeform ?? null;
    const plannedSend = plannedSendFrom({ pass, windowOpen });
    plannedSendSchema.parse(plannedSend);
    return { pass, plannedSend };
}
