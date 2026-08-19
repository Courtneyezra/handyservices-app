/**
 * The AI staff directory — /api/agents/staff.
 *
 * Each agent module exports its own STAFF card and SYSTEM prompt, so this endpoint only
 * assembles them and attaches live stats from the tables the agents actually write to.
 * Nothing here is hand-maintained copy about an agent — if the card is wrong, fix it in
 * the agent's own file.
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { db } from './db';
import {
    messageDrafts, agentQuestions, appSettings, conversations, messages,
    personalizedQuotes, quickReplies, firstContactAckLog,
} from '@shared/schema';
import { eq, and, gte, desc, isNotNull, sql } from 'drizzle-orm';
import { queueDraft } from './message-drafts';
import { sendWhatsAppMessage, canSendFreeform } from './meta-whatsapp';
import { renderQuickReply } from './quick-replies';
import { findApprovedTemplate, buildTemplateVariables, renderTemplateBody } from './whatsapp-template-sync';
import { claudeText } from './llm';
import {
    buildQuoteMessage, defaultStyleForCustomerType, MESSAGE_STYLES, type MessageStyleId,
} from './contextual-pricing/quote-message';
import { STAFF as opsBriefStaff, SYSTEM as opsBriefSystem } from './agents/ops-brief';
import { STAFF as recoveryStaff, SYSTEM as recoverySystem } from './agents/recovery';
import { STAFF as commsStaff, SYSTEM as commsSystem, getCommsAgentConfig, setCommsAgentConfig } from './agents/comms';
import { STAFF as quotePrepStaff, SYSTEM as quotePrepSystem, runQuotePrep } from './agents/quote-prep';
import { FIRST_CONTACT_CHANNELS, type FirstContactChannel } from './first-contact-ack';

export const agentStaffRouter = Router();

type Stat = { label: string; value: number | string; tone?: 'good' | 'warn' | 'bad' | 'plain' };

async function commsStats(): Promise<{ stats: Stat[]; statusChips: { label: string; on: boolean }[] }> {
    const week = new Date(Date.now() - 7 * 24 * 3600_000);
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'pending')));
    const [sent7d] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'sent'), gte(messageDrafts.sentAt, week)));
    const [rejected7d] = await db.select({ n: sql<number>`count(*)::int` }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'comms_agent'), eq(messageDrafts.status, 'rejected'), gte(messageDrafts.createdAt, week)));
    const [openQ] = await db.select({ n: sql<number>`count(*)::int` }).from(agentQuestions)
        .where(eq(agentQuestions.status, 'open'));
    const [answeredQ] = await db.select({ n: sql<number>`count(*)::int` }).from(agentQuestions)
        .where(eq(agentQuestions.status, 'answered'));
    const config = await getCommsAgentConfig();

    return {
        stats: [
            { label: 'Drafts awaiting approval', value: pending.n, tone: pending.n > 0 ? 'warn' : 'plain' },
            { label: 'Approved & sent (7d)', value: sent7d.n, tone: 'good' },
            { label: 'Rejected (7d)', value: rejected7d.n, tone: rejected7d.n > 0 ? 'bad' : 'plain' },
            { label: 'Questions waiting on Ben', value: openQ.n, tone: openQ.n > 0 ? 'warn' : 'plain' },
            { label: 'Answers ready to consume', value: answeredQ.n, tone: 'plain' },
        ],
        statusChips: [
            { label: config.enabled ? 'SLA SWEEP ON' : 'SLA SWEEP OFF', on: config.enabled },
            { label: config.autosend.enabled ? `AUTO-SEND ON (${config.autosend.intents.join(', ')})` : 'AUTO-SEND OFF', on: config.autosend.enabled },
        ],
    };
}

async function recoveryStats(): Promise<{ stats: Stat[]; statusChips: { label: string; on: boolean }[] }> {
    const r: any = await db.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'proposed') ::int AS proposed,
               count(*) FILTER (WHERE status = 'approved' AND created_at >= now() - interval '7 days')::int AS approved_7d,
               count(*) FILTER (WHERE status = 'skipped'  AND created_at >= now() - interval '7 days')::int AS skipped_7d,
               count(*) FILTER (WHERE lever IS NOT NULL) ::int AS total_nudges
        FROM nudge_queue
    `).then((x: any) => (x.rows ?? x)[0]);

    return {
        stats: [
            { label: 'Nudges awaiting approval', value: r.proposed, tone: r.proposed > 0 ? 'warn' : 'plain' },
            { label: 'Approved (7d)', value: r.approved_7d, tone: 'good' },
            { label: 'Skipped with reason (7d)', value: r.skipped_7d, tone: 'plain' },
            { label: 'Nudges proposed all-time', value: r.total_nudges, tone: 'plain' },
        ],
        statusChips: [{ label: 'PROPOSE-ONLY', on: true }],
    };
}

// GET /api/agents/staff — the full directory with live stats.
agentStaffRouter.get('/staff', async (_req, res) => {
    try {
        const [comms, recovery] = await Promise.all([commsStats(), recoveryStats()]);
        res.json({
            staff: [
                {
                    ...commsStaff,
                    system: commsSystem,
                    accent: 'emerald',
                    ...comms,
                },
                {
                    ...recoveryStaff,
                    system: recoverySystem,
                    accent: 'amber',
                    ...recovery,
                },
                {
                    ...quotePrepStaff,
                    system: quotePrepSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'ON-DEMAND', on: true }],
                },
                {
                    ...opsBriefStaff,
                    system: opsBriefSystem,
                    accent: 'sky',
                    stats: [],
                    statusChips: [{ label: 'READ-ONLY', on: true }],
                },
            ],
        });
    } catch (error: any) {
        console.error('[AgentStaff] Failed to build directory:', error);
        res.status(500).json({ error: 'Failed to load staff directory' });
    }
});

// POST /api/agents/quote-prep/:conversationId/request-details — queue an ask into the comms
// draft queue: either the "what's the postcode / what name goes on the quote" fields, or one
// customer-audience gap from the readiness verdict (`question`). Deterministic
// copy (brand voice: whatsapp-comms.md — postcode only, never full address, no em dashes,
// short bursts split by '---'). Nothing sends here: the draft waits for Ben's approval.
agentStaffRouter.post('/quote-prep/:conversationId/request-details', async (req, res) => {
    try {
        const fields: string[] = Array.isArray(req.body?.fields) ? req.body.fields : [];
        const wantName = fields.includes('name');
        const wantPostcode = fields.includes('postcode');
        // A scoping gap from the intake's readiness verdict, asked in the agent's own
        // customer-friendly wording. Same queue, same approval gate as name/postcode.
        const gapQuestion = String(req.body?.question || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        if (!wantName && !wantPostcode && !gapQuestion) {
            return res.status(400).json({ error: "Send fields ('name'/'postcode') or a question to ask" });
        }

        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.id, req.params.conversationId));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) return res.status(422).json({ error: 'Conversation has no usable phone' });

        // One question max per reply: the postcode gets the question, the name rides
        // along as a statement. Never the full address — that's collected at booking.
        let body: string;
        let reason: string;
        if (gapQuestion) {
            // Voice rules apply to text the agent wrote: no dashes-as-punctuation, one
            // question, a short lead-in of its own so it lands as a burst not a form.
            const asked = stripChatDashes(gapQuestion).replace(/\?*$/, '?');
            if (/\b(full )?address\b/i.test(asked)) {
                return res.status(422).json({ error: 'That question asks for an address. Postcode only, address comes at booking.' });
            }
            body = `Quick one before we price this up.\n---\n${asked}`;
            reason = `Quote prep needs this answered before the quote can go out: ${asked}`;
        } else {
            body = wantPostcode && wantName
                ? 'Nearly ready to price this up for you.\n---\nWhat’s the postcode? Just so we can price it properly.\n---\nAnd a name to put on the quote would help too.'
                : wantPostcode
                    ? 'Quick one so we can get your quote sorted.\n---\nWhat’s the postcode? Just so we can price it properly.'
                    : 'Nearly ready to send your quote over.\n---\nWhat name should we put on it?';
            const missing = [wantName ? 'name' : null, wantPostcode ? 'postcode' : null].filter(Boolean).join(' + ');
            reason = `Quote prep is waiting on the customer's ${missing}`;
        }

        const draftId = await queueDraft({
            phone: `+${digits}`,
            body,
            source: 'comms_agent',
            reason,
        });

        // null = suppressed as a duplicate (an unsent comms_agent draft already exists
        // for this number) — tell the card so it shows "already queued", not an error.
        res.json({ queued: !!draftId, draftId });
    } catch (error: any) {
        console.error('[QuotePrep] request-details failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to queue the ask' });
    }
});

// ---------------------------------------------------------------------------
// First-contact auto-responder: control panel + audit log.
//
// This is the ONE feature in the system that messages a stranger without a human first, and until
// now its settings lived only in a CLI script and its refusals only in console output. Nobody
// should be asked to switch that on blind. These three endpoints are the whole reason the panel in
// /admin/comms can exist: read the true state, change it, and see every decision it has made.
//
// Auth: the router is mounted behind requireAdmin in server/index.ts (which also admits the 'va'
// role, so Ben can reach it).
// ---------------------------------------------------------------------------

// GET /api/agents/first-contact/config — the live config, read from the DB, never a cached guess.
agentStaffRouter.get('/first-contact/config', async (_req, res) => {
    try {
        const config = await getCommsAgentConfig();
        res.json({ config: config.firstContactAutoAck, channels: FIRST_CONTACT_CHANNELS });
    } catch (error: any) {
        console.error('[FirstContact] Config read failed:', error);
        res.status(500).json({ error: error?.message || 'Could not read the config' });
    }
});

// PATCH /api/agents/first-contact/config — { enabled?, channels?, returningAfterDays? }.
//
// Validated here rather than trusted from the client: `channels` is the list of surfaces allowed
// to message a stranger, so an unknown string in it is a silent widening of that permission.
// Returns the config as it now stands, so the panel renders the truth rather than its own optimism.
agentStaffRouter.patch('/first-contact/config', async (req, res) => {
    try {
        const patch: Record<string, any> = {};

        if (req.body?.enabled !== undefined) {
            if (typeof req.body.enabled !== 'boolean') {
                return res.status(400).json({ error: "'enabled' must be true or false" });
            }
            patch.enabled = req.body.enabled;
        }

        if (req.body?.channels !== undefined) {
            const channels = req.body.channels;
            if (!Array.isArray(channels)) return res.status(400).json({ error: "'channels' must be an array" });
            const invalid = channels.filter((c: any) => !FIRST_CONTACT_CHANNELS.includes(c));
            if (invalid.length) {
                return res.status(400).json({ error: `Unknown channel(s): ${invalid.join(', ')}. Allowed: ${FIRST_CONTACT_CHANNELS.join(', ')}` });
            }
            // De-duplicated, so the stored list matches what the toggles show.
            patch.channels = Array.from(new Set(channels)) as FirstContactChannel[];
        }

        if (req.body?.returningAfterDays !== undefined) {
            const n = Number(req.body.returningAfterDays);
            if (!Number.isInteger(n) || n < 1 || n > 3650) {
                return res.status(400).json({ error: "'returningAfterDays' must be a whole number of days between 1 and 3650" });
            }
            patch.returningAfterDays = n;
        }

        if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });

        const next = await setCommsAgentConfig({ firstContactAutoAck: patch as any });
        console.log(`[FirstContact] Config changed via /admin/comms: ${JSON.stringify(next.firstContactAutoAck)}`);
        res.json({ config: next.firstContactAutoAck, channels: FIRST_CONTACT_CHANNELS });
    } catch (error: any) {
        console.error('[FirstContact] Config write failed:', error);
        res.status(500).json({ error: error?.message || 'Could not save the config' });
    }
});

// GET /api/agents/first-contact/log?limit=100 — every decision, newest first, refusals included.
// The refusals are the point: a log of successes alone cannot answer "why did nobody get a reply?".
agentStaffRouter.get('/first-contact/log', async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const rows = await db.select().from(firstContactAckLog)
            .orderBy(desc(firstContactAckLog.createdAt)).limit(limit);

        // A one-line summary of the last 7 days, so the panel can lead with "23 refused, 4 sent"
        // rather than making someone count rows.
        const week = new Date(Date.now() - 7 * 24 * 3600_000);
        const summary = await db.select({
            reason: firstContactAckLog.reason,
            n: sql<number>`count(*)::int`,
        }).from(firstContactAckLog)
            .where(gte(firstContactAckLog.createdAt, week))
            .groupBy(firstContactAckLog.reason);

        res.json({ rows, summary });
    } catch (error: any) {
        // A missing table (migration not run) must read as "no log yet", not as a broken page.
        console.error('[FirstContact] Log read failed:', error);
        res.status(500).json({ error: error?.message || 'Could not read the log' });
    }
});

// ---------------------------------------------------------------------------
// Send-quote flow (in-chat quote card): draft the delivery message, then send.
// ---------------------------------------------------------------------------

/** Digits-only key for phone comparison — conversations store `447...@c.us`, quotes store E.164. */
const digitsOf = (phone: string) => phone.replace('@c.us', '').replace(/\D/g, '');

/**
 * Loads the conversation + quote pair and refuses a mismatch. The card sends a quote link INTO a
 * thread, so the quote's phone must be the thread's phone — otherwise a stale slug in the client
 * would deliver one customer's quote (name, address area, price) to another customer.
 */
async function loadConversationQuote(conversationId: string, slug: string): Promise<
    | { ok: true; conv: typeof conversations.$inferSelect; quote: typeof personalizedQuotes.$inferSelect; phone: string }
    | { ok: false; status: number; error: string }
> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) return { ok: false, status: 404, error: 'Conversation not found' };
    const convDigits = digitsOf(conv.phoneNumber);
    if (!convDigits) return { ok: false, status: 422, error: 'Conversation has no usable phone' };

    const [quote] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug));
    if (!quote) return { ok: false, status: 404, error: 'Quote not found' };
    if (digitsOf(quote.phone || '') !== convDigits) {
        return { ok: false, status: 422, error: 'That quote belongs to a different phone number than this thread' };
    }
    return { ok: true, conv, quote, phone: `+${convDigits}` };
}

/** Brand voice for 1:1 chat — same file the comms agent loads, so the two never diverge. */
function loadChatVoice(): string {
    try {
        return readFileSync(path.join(process.cwd(), 'brand-voice/whatsapp-comms.md'), 'utf8');
    } catch {
        return 'Voice: a friendly Nottingham tradesperson texting back. Short messages, plain UK English, no em dashes, no sign-offs, one question max.';
    }
}

/** Voice hard rule: em/en dashes (and spaced hyphens) never reach a customer. URLs are safe —
 *  their hyphens have no surrounding spaces, and the link is re-verified after this runs. */
function stripChatDashes(text: string): string {
    return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s+-\s+/g, ', ');
}

const quoteUrlFor = (slug: string) => `${process.env.BASE_URL || 'https://handyservices.app'}/quote/${slug}`;

/** Marks the quote as actually sent: out of draft, thread to funnel stage 'quote_sent', tagged. */
async function finalizeQuoteSent(quoteId: string, conversationId: string): Promise<void> {
    await db.update(personalizedQuotes).set({ isDraft: false }).where(eq(personalizedQuotes.id, quoteId));
    const [conv] = await db.select({ tags: conversations.tags }).from(conversations)
        .where(eq(conversations.id, conversationId));
    await db.update(conversations)
        .set({
            stage: 'quote_sent',
            tags: Array.from(new Set([...(conv?.tags ?? []), 'quote_sent'])),
            updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
}

/**
 * The Meta template purpose-built to carry a quote link outside the 24h window.
 *
 * Looked up BY NAME against the live approval cache on every send, never by hardcoded SID: at the
 * time this was wired `quote_ready_link` was still pending with Meta, and a template's status
 * moves without warning in both directions. Null means "not approved (yet)" — the caller falls
 * back rather than attempting a send Meta would reject.
 */
const QUOTE_LINK_TEMPLATE = process.env.QUOTE_LINK_TEMPLATE_NAME || 'quote_ready_link';

/**
 * A shut-window send needs an approved Twilio template with somewhere to PUT the link — a
 * `{{quote_link}}` placeholder in its body or variable map. A template without one could be
 * delivered but could never carry the quote, so it doesn't count as suitable.
 *
 * This is the FALLBACK path, kept for quick replies an operator has wired up by hand; the
 * approved-template lookup above is tried first.
 */
async function findQuoteSendTemplate() {
    const rows = await db.select().from(quickReplies)
        .where(and(eq(quickReplies.isActive, true), isNotNull(quickReplies.contentSid)));
    return rows.find((r) => (r.body + JSON.stringify(r.contentVariables ?? {})).includes('{{quote_link}}')) ?? null;
}

// POST /api/agents/quote-prep/:conversationId/draft-send-message — assemble the WhatsApp
// message that delivers a finished quote link. This is the BUILDER'S OWN generator
// (buildQuoteMessage: style-varied greeting / price-range pre-anchor / link / closing), not a
// freestyle LLM draft, so what the card sends is what the builder would send — with two
// card-only additions: a one-line acknowledgement of what the customer actually sent in the
// thread (photos etc), and a closing that says the service is complete on the link but we're
// happy to answer any questions right here in the chat. Style defaults from the quote's
// customerType; `messageStyle` in the body overrides it (the card's dropdown re-drafts).
// Drafting only: nothing is sent here. Ben reviews/edits the text; his Send IS the approval.
agentStaffRouter.post('/quote-prep/:conversationId/draft-send-message', async (req, res) => {
    try {
        const slug = String(req.body?.slug || '').trim();
        if (!slug) return res.status(400).json({ error: "Missing 'slug'" });
        const loaded = await loadConversationQuote(req.params.conversationId, slug);
        if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });
        const { conv, quote, phone } = loaded;
        const quoteUrl = quoteUrlFor(slug);

        const styleParam = String(req.body?.messageStyle || '').trim();
        const styleId: MessageStyleId = MESSAGE_STYLES.some((s) => s.id === styleParam)
            ? (styleParam as MessageStyleId)
            : defaultStyleForCustomerType(quote.customerType);

        // The last few turns, so the context line can reference what they sent (photos included).
        const recent = await db.select().from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(desc(messages.createdAt)).limit(8);
        const turns = recent.reverse();
        const thread = turns.map((m) => {
            const media = m.mediaUrl
                ? ` [sent ${(m.mediaType ?? '').startsWith('video') ? 'a video' : 'a photo'}]`
                : '';
            return `${m.direction === 'inbound' ? 'CUSTOMER' : 'US'}: ${(m.content ?? '').slice(0, 200)}${media}`;
        }).join('\n');

        // One short thread-context line — the only LLM-written part. No stock fallback: when
        // the LLM can't produce a grounded line the message simply starts at the contextual
        // message (the card path has no greeting, so generic filler would be the opener).
        let threadContextLine: string | undefined;
        try {
            const drafted = await claudeText({
                system: `You write ONE short sentence that opens a WhatsApp quote-delivery message, acknowledging what the CUSTOMER sent us (their photos, video, or how they described the job), so it reads like the same person who was just talking to them.

${loadChatVoice()}

Hard rules: one sentence, maximum 15 words. Refer ONLY to things marked CUSTOMER in the thread, never to our own messages. Do not mention the quote, any link, booking, prices or dates. No questions, no em dashes or hyphens, no emoji, never mention an address. Return ONLY the sentence.`,
                user: `Conversation so far:\n${thread || '(no messages captured)'}\n\nJob quoted: ${(quote.jobDescription || '').slice(0, 400)}`,
                maxTokens: 60,
            });
            const line = stripChatDashes(drafted.trim().replace(/^["']|["']$/g, '')).split('\n')[0].trim();
            if (line && line.length <= 140 && !line.includes('?')) threadContextLine = line;
        } catch (draftError: any) {
            console.warn('[QuotePrep] Thread-context line fell back to stock copy:', draftError?.message);
        }

        const firstName = (quote.customerName || conv.contactName || '').split(' ')[0] || 'there';
        const lineCount = Array.isArray(quote.pricingLineItems) ? (quote.pricingLineItems as any[]).length : 0;
        const assembled = buildQuoteMessage({
            styleId,
            firstName,
            contextualMessage: quote.contextualMessage || '',
            whatsappClosing: quote.whatsappClosing || '',
            quoteUrl,
            finalPricePence: quote.basePrice || 0,
            batchNudge: lineCount === 1
                ? '\n\nAnything else needs doing while we\'re there? You can add extra small jobs right inside the link too.'
                : '',
            threadContextLine,
            chatClose: true,
            // Mid-thread continuation: no "Hi <name>" salutation. The body opens at the
            // thread-context line (or the contextual message when there isn't one).
            skipGreeting: true,
        });

        // Voice hard rule for chat: no em/en dashes reach the customer. The price range uses an
        // en dash (£80–£100) which stripChatDashes would mangle into "£80, £100", so rewrite
        // ranges to "to" FIRST, then strip whatever dashes the style copy carries.
        const body = stripChatDashes(assembled.replace(/£(\d+)–£(\d+)/g, '£$1 to £$2'));

        const windowOpen = await canSendFreeform(phone).catch(() => false);
        res.json({ body, quoteUrl, windowOpen, styleUsed: styleId, styles: MESSAGE_STYLES });
    } catch (error: any) {
        console.error('[QuotePrep] draft-send-message failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to draft the message' });
    }
});

// POST /api/agents/quote-prep/:conversationId/send-quote — the send itself. Ben has seen and
// (possibly) edited the exact text; clicking Send is the approval, so this delivers directly:
// freeform burst when the 24h window is open, an approved template when one can carry the link,
// otherwise the burst is queued as a pending draft for when the window reopens. Every outcome
// is reported — nothing fails silently.
agentStaffRouter.post('/quote-prep/:conversationId/send-quote', async (req, res) => {
    try {
        const slug = String(req.body?.slug || '').trim();
        const rawBody = String(req.body?.body || '').trim();
        if (!slug || !rawBody) return res.status(400).json({ error: "Missing 'slug' or 'body'" });

        const loaded = await loadConversationQuote(req.params.conversationId, slug);
        if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });
        const { conv, quote, phone } = loaded;
        const quoteUrl = quoteUrlFor(slug);

        const body = stripChatDashes(rawBody);
        if (!body.includes(quoteUrl)) {
            return res.status(400).json({
                error: 'MISSING_LINK',
                message: `The message must contain the quote link (${quoteUrl}) or the customer gets words with no quote.`,
            });
        }

        const windowOpen = await canSendFreeform(phone).catch(() => false);

        if (windowOpen) {
            // Multi-part burst on '---', paced like a person texting — same splitting contract
            // as approveAndSendDraft. One approval (Ben's click) covers the whole burst.
            const parts = body.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
            const sids: string[] = [];
            let linkDelivered = false;
            try {
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
                    const result: any = await sendWhatsAppMessage(phone, parts[i]);
                    sids.push(result?.sid ?? 'unknown');
                    if (parts[i].includes(quoteUrl)) linkDelivered = true;
                }
            } catch (sendError: any) {
                if (!linkDelivered) {
                    // The quote never reached them — leave it a draft so nothing pretends it did.
                    return res.status(502).json({
                        error: 'SEND_FAILED',
                        message: sendError?.message || 'WhatsApp send failed before the quote link went out',
                        sentSids: sids,
                    });
                }
                // The link part landed: the customer HAS the quote, so it is sent — record that,
                // and surface the broken tail rather than hiding it.
                await finalizeQuoteSent(quote.id, conv.id);
                return res.json({
                    sent: true, mode: 'freeform', sids, partial: true,
                    message: `Quote link delivered, but a follow-up part failed: ${sendError?.message || 'send failed'}`,
                });
            }
            await finalizeQuoteSent(quote.id, conv.id);
            return res.json({ sent: true, mode: 'freeform', sids });
        }

        // Window shut — only an approved template can be delivered.
        //
        // First choice is the dedicated quote-link template, resolved by name against the
        // approval cache at send time. While it is pending this returns null and we fall
        // straight through; the hour it flips to approved, this path starts working with no
        // deploy and no config change.
        const firstName = renderQuickReply('{{first_name}}', quote.customerName || conv.contactName);
        const approved = await findApprovedTemplate(QUOTE_LINK_TEMPLATE).catch(() => null);
        if (approved) {
            const vars = buildTemplateVariables(approved, { firstName, quoteUrl });
            const rendered = renderTemplateBody(approved.body, vars);
            // Same contract as the freeform path: if the link cannot actually ride this template,
            // it is not a delivery route — better to queue than to send words with no quote.
            if (rendered.includes(quoteUrl)) {
                try {
                    const result: any = await sendWhatsAppMessage(phone, rendered, {
                        contentSid: approved.contentSid,
                        contentVariables: vars,
                    });
                    await finalizeQuoteSent(quote.id, conv.id);
                    return res.json({
                        sent: true, mode: 'template', sids: [result?.sid ?? 'unknown'],
                        templateName: approved.name, rendered,
                    });
                } catch (templateError: any) {
                    console.warn(`[QuotePrep] ${approved.name} send failed, trying fallbacks:`, templateError?.message);
                }
            } else {
                console.warn(`[QuotePrep] ${approved.name} is approved but its body has nowhere to put the quote link — skipping it.`);
            }
        }

        const template = await findQuoteSendTemplate();
        if (template) {
            const renderWithLink = (text: string) =>
                renderQuickReply(text.replace(/\{\{\s*quote_link\s*\}\}/gi, quoteUrl), quote.customerName || conv.contactName);
            try {
                const vars = template.contentVariables
                    ? Object.fromEntries(Object.entries(template.contentVariables as Record<string, string>)
                        .map(([k, v]) => [k, renderWithLink(String(v))]))
                    : undefined;
                const result: any = await sendWhatsAppMessage(phone, renderWithLink(template.body), {
                    contentSid: template.contentSid!,
                    contentVariables: vars,
                });
                await finalizeQuoteSent(quote.id, conv.id);
                return res.json({ sent: true, mode: 'template', sids: [result?.sid ?? 'unknown'], templateId: template.id });
            } catch (templateError: any) {
                // Template refused — fall through to the queue so the send is never just lost,
                // and tell the card what happened.
                console.warn('[QuotePrep] Template send failed, queueing instead:', templateError?.message);
            }
        }

        // No deliverable path right now: park the exact burst in the approval queue. When the
        // window reopens Ben approves it there; the quote-link hook in approveAndSendDraft then
        // flips this quote out of draft and stages the thread.
        const draftId = await queueDraft({
            phone,
            body,
            source: 'comms_agent',
            reason: `Quote ${slug} is ready to send but the WhatsApp window is shut. Approving sends it once the window reopens.`,
            dedupe: false,
        });
        return res.json({
            sent: false,
            queued: true,
            draftId,
            templatePending: !approved,
            message: approved
                ? 'Window shut and the template send did not go through, so it is queued for approval. The quote stays a draft until it actually sends.'
                : `Window shut and "${QUOTE_LINK_TEMPLATE}" is not approved by Meta yet, so it is queued for approval when the window reopens. The quote stays a draft until it actually sends.`,
        });
    } catch (error: any) {
        console.error('[QuotePrep] send-quote failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to send the quote' });
    }
});

// POST /api/agents/quote-prep/:conversationId — run the intake clerk on one thread.
// Synchronous on purpose: the caller is a human who just clicked "Prep quote" and wants the
// prefill; a run takes ~20-40s and the button shows progress.
agentStaffRouter.post('/quote-prep/:conversationId', async (req, res) => {
    try {
        const { intake, summary, turns } = await runQuotePrep(req.params.conversationId);
        if (!intake) {
            return res.status(422).json({ error: 'NO_INTAKE', message: summary || 'The agent could not extract a usable intake from this thread.' });
        }
        res.json({ intake, summary, turns });
    } catch (error: any) {
        console.error('[QuotePrep] Run failed:', error);
        res.status(500).json({ error: error?.message || 'Quote prep failed' });
    }
});
