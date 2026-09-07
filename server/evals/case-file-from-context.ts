/**
 * Build a spine CaseFile from a self-contained eval context (no database). Enough for the spine
 * adapter to run triage + an agent over a case JSON; the real assembler (pane A) reads the DB.
 */
import { createHash } from 'node:crypto';
import type { CaseFile, MediaItem, TimelineItem } from '../spine/types';
import type { EvalCaseV2 } from './case-schema';

export function caseFileFromContext(c: EvalCaseV2, now: Date = new Date()): CaseFile {
    if (c.caseFile) return c.caseFile;
    const context = c.context ?? [];
    const media: MediaItem[] = [];
    const timeline: TimelineItem[] = context.map((m, i) => {
        const item: TimelineItem = {
            at: m.at ?? new Date(now.getTime() - (context.length - i) * 60_000).toISOString(),
            kind: m.channel === 'call' ? (m.direction === 'inbound' ? 'call_in' : 'call_out') : m.direction === 'inbound' ? 'message_in' : 'message_out',
            channel: m.channel === 'call' ? 'call' : m.channel === 'webform' ? 'webchat' : (m.channel ?? 'whatsapp'),
            body: m.body,
            by: m.direction === 'inbound' ? 'customer' : 'agent.comms',
        };
        // B7a: attachments the way the real assembler records them (server/spine/case-file.ts).
        if (m.media?.length) {
            item.mediaIds = m.media.map((kind, j) => { const id = `eval_media_${i}_${j}`; media.push({ id, kind }); return id; });
        }
        return item;
    });
    const lastIn = [...context].reverse().find((m) => m.direction === 'inbound');
    const phone = `+447700900${String(Math.abs(hashCode(c.id)) % 1000).padStart(3, '0')}`; // Ofcom drama range
    const base: Omit<CaseFile, 'hash'> = {
        conversationId: `eval_${c.id.replace(/[^a-z0-9]/gi, '_')}`,
        phone,
        audience: 'customer',
        stage: c.quote ? (c.quote.paid ? 'booked' : 'quote_sent') : c.firstContact ? 'enquiry' : 'scoping',
        contactName: c.customer?.firstName ?? null,
        timeline,
        media,
        window: { canFreeform: true, templateRequired: false, lastInboundAt: lastIn?.at ?? null, channelLastUsed: 'whatsapp' },
        client: null,
        quote: c.quote ? { slug: c.quote.slug ?? 'evalq', total: c.quote.totalPence ?? null, lines: 1, viewedAt: c.quote.seen ? now.toISOString() : null, expiresAt: null, paid: !!c.quote.paid } : null,
        openPromises: [],
        openFlags: [],
        tags: c.tags ?? [],
        lastRun: null,
        builtAt: now.toISOString(),
    };
    const hash = createHash('sha256').update(JSON.stringify(base)).digest('hex');
    return { ...base, hash };
}

function hashCode(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}
