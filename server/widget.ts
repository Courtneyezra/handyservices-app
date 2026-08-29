/**
 * Scriptable iOS widget backend (docs/PLAN_SCRIPTABLE_WIDGET.md).
 *
 * Two endpoints:
 *   POST /api/widget/token    — issue (or rotate) a long-lived widget token for the authed user
 *   GET  /api/widget/summary  — role-scoped ops summary, authed by that token
 *
 * The widget token is deliberately NOT a contractorSessions token: iOS holds it for
 * months, and it only ever grants this read-only summary. Never log it.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { db } from './db';
import {
    users, handymanProfiles, contractorBookingRequests, invoices, personalizedQuotes,
    leads, calls, messageDrafts, agentQuestions, nudgeQueue,
} from '@shared/schema';
import { and, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { expandSpanDates } from '@shared/schedule-composition';
import { optionalAuth } from './auth';

export const widgetRouter = Router();

// ── POST /api/widget/token ───────────────────────────────────────────────────
// Idempotent: returns the existing token unless ?rotate=1.
widgetRouter.post('/api/widget/token', optionalAuth, async (req, res) => {
    const user = (req as any).user;
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        let token: string | null = user.widgetToken ?? null;
        if (!token || req.query.rotate === '1') {
            token = crypto.randomBytes(24).toString('base64url');
            await db.update(users)
                .set({ widgetToken: token, updatedAt: new Date() })
                .where(eq(users.id, user.id));
        }
        // NOT res.json: the request logger in server/index.ts snapshots the first 50
        // chars of every res.json body into the console log, which would leak the token.
        res.status(200).type('application/json').send(JSON.stringify({ token }));
    } catch (err) {
        console.error('[Widget] Token issue failed:', err);
        res.status(500).json({ error: 'Failed to issue widget token' });
    }
});

// ── Formatting helpers (server owns ALL formatting — the script renders dumbly) ──

// tone: optional status indicator the script maps to a color (alert = red,
// ok = green, absent = default amber). icon: SF Symbol name hint for the cell.
// Server decides both — the script stays dumb and old script versions ignore them.
type WidgetLine = { label: string; value: string; detail?: string; tone?: 'alert' | 'ok'; icon?: string };

const LONDON = 'Europe/London';

/** Today's calendar date where the business operates, as YYYY-MM-DD. */
function londonDateStr(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: LONDON });
}

function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the week containing dateStr (the business week for "paid this wk"). */
function mondayOf(dateStr: string): string {
    const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return addDays(dateStr, -((dow + 6) % 7));
}

function gbp(pence: number): string {
    return '£' + Math.round(pence / 100).toLocaleString('en-GB');
}

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function clip(s: string, max = 64): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function shortDate(dateStr: string): string {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
}

/** Naive-UTC timestamp column → London calendar date, for day-boundary comparisons. */
function londonDay(col: unknown) {
    return sql`(((${col}) AT TIME ZONE 'UTC') AT TIME ZONE ${sql.raw(`'${LONDON}'`)})::date`;
}

// ── Metric loaders ───────────────────────────────────────────────────────────

type JobSpan = {
    id: string;
    contractorId: string;
    assignedContractorId: string | null;
    customerName: string;
    scheduledStartTime: string | null;
    /** The actual dates the span occupies (YYYY-MM-DD), via expandSpanDates. */
    dates: string[];
};

/**
 * Jobs whose span could touch [today-14d .. today+8d]. scheduledDates (jsonb) is the
 * source of truth for which days a span occupies; legacy rows fall back to consecutive
 * days from scheduledDate — always read through expandSpanDates (shared/schedule-composition).
 */
async function loadJobSpans(today: string, contractorProfileId?: string): Promise<JobSpan[]> {
    const from = new Date(`${addDays(today, -14)}T00:00:00Z`);
    const to = new Date(`${addDays(today, 8)}T23:59:59Z`);
    const rows = await db.select({
        id: contractorBookingRequests.id,
        contractorId: contractorBookingRequests.contractorId,
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        customerName: contractorBookingRequests.customerName,
        scheduledDate: contractorBookingRequests.scheduledDate,
        scheduledStartTime: contractorBookingRequests.scheduledStartTime,
        durationDays: contractorBookingRequests.durationDays,
        scheduledDates: contractorBookingRequests.scheduledDates,
    })
        .from(contractorBookingRequests)
        .where(and(
            gte(contractorBookingRequests.scheduledDate, from),
            lte(contractorBookingRequests.scheduledDate, to),
            ne(contractorBookingRequests.status, 'declined'),
            ...(contractorProfileId ? [or(
                eq(contractorBookingRequests.assignedContractorId, contractorProfileId),
                and(
                    isNull(contractorBookingRequests.assignedContractorId),
                    eq(contractorBookingRequests.contractorId, contractorProfileId),
                ),
            )!] : []),
        ));
    return rows
        .filter((r) => r.scheduledDate)
        .map((r) => ({
            id: r.id,
            contractorId: r.contractorId,
            assignedContractorId: r.assignedContractorId,
            customerName: r.customerName,
            scheduledStartTime: r.scheduledStartTime,
            dates: expandSpanDates(r.scheduledDate!, r.durationDays, r.scheduledDates),
        }));
}

/** "Craig ×2, Joe ×1" — contractor first names for a set of today's jobs. */
async function contractorBreakdown(jobs: JobSpan[]): Promise<string | undefined> {
    const ids = [...new Set(jobs.map((j) => j.assignedContractorId ?? j.contractorId).filter(Boolean))];
    if (ids.length === 0) return undefined;
    const profs = await db.select({ id: handymanProfiles.id, firstName: users.firstName })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(inArray(handymanProfiles.id, ids));
    const nameById = new Map(profs.map((p) => [p.id, p.firstName || '?']));
    const counts = new Map<string, number>();
    for (const j of jobs) {
        const name = nameById.get(j.assignedContractorId ?? j.contractorId) ?? 'Unassigned';
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return clip([...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
        .join(', '));
}

async function moneyLine(monday: string): Promise<WidgetLine> {
    const [outstanding] = await db.select({
        pence: sql<number>`coalesce(sum(${invoices.balanceDue}), 0)::int`,
    })
        .from(invoices)
        .where(inArray(invoices.status, ['sent', 'overdue']));
    const [paid] = await db.select({
        pence: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::int`,
    })
        .from(invoices)
        .where(and(
            eq(invoices.status, 'paid'),
            sql`${londonDay(invoices.paidAt)} >= ${monday}::date`,
        ));
    return {
        label: 'Money',
        icon: 'sterlingsign.circle.fill',
        value: `${gbp(outstanding?.pence ?? 0)} due`,
        detail: `${gbp(paid?.pence ?? 0)} paid this wk`,
    };
}

/**
 * Open-quote pipeline. "Open" = the customer could still act on it: not a draft,
 * not revoked, not booked (no deposit), and still within its validity window —
 * the inbox board's liveness rules (server/inbox-board.ts) plus the booked/expired
 * cut. Quotes are only valid ~48h (QUOTE_VALIDITY_MS), so requiring a future
 * expiresAt keeps years of legacy no-expiry rows from inflating the number.
 */
async function pipelineLine(): Promise<WidgetLine> {
    const [row] = await db.select({
        pence: sql<number>`coalesce(sum(coalesce(${personalizedQuotes.selectedTierPricePence}, ${personalizedQuotes.basePrice})), 0)::int`,
        n: sql<number>`count(*)::int`,
    })
        .from(personalizedQuotes)
        .where(and(
            sql`${personalizedQuotes.isDraft} IS NOT TRUE`,
            isNull(personalizedQuotes.revokedAt),
            isNull(personalizedQuotes.depositPaidAt),
            gt(personalizedQuotes.expiresAt, new Date()),
        ));
    return {
        label: 'Pipeline',
        icon: 'chart.line.uptrend.xyaxis',
        value: gbp(row?.pence ?? 0),
        detail: plural(row?.n ?? 0, 'open quote'),
    };
}

/**
 * Needs-attention count, reusing the definitions the inbox board already owns:
 * held comms_agent drafts awaiting approval + open ask-Ben questions
 * (server/inbox-board.ts), plus follow-ups in nudge_queue whose send_after has passed.
 */
async function attentionLine(): Promise<WidgetLine> {
    const [drafts] = await db.select({ n: sql<number>`count(*)::int` })
        .from(messageDrafts)
        .where(and(eq(messageDrafts.status, 'pending'), eq(messageDrafts.source, 'comms_agent')));
    const [questions] = await db.select({ n: sql<number>`count(*)::int` })
        .from(agentQuestions)
        .where(eq(agentQuestions.status, 'open'));
    const [nudges] = await db.select({ n: sql<number>`count(*)::int` })
        .from(nudgeQueue)
        .where(and(
            inArray(nudgeQueue.status, ['proposed', 'approved']),
            lte(nudgeQueue.sendAfter, new Date()),
        ));
    const d = drafts?.n ?? 0, q = questions?.n ?? 0, f = nudges?.n ?? 0;
    const parts = [
        d > 0 ? plural(d, 'held draft') : null,
        q > 0 ? plural(q, 'question') : null,
        f > 0 ? `${plural(f, 'follow-up')} due` : null,
    ].filter(Boolean) as string[];
    const total = d + q + f;
    return {
        label: 'Attention',
        icon: 'bell.badge.fill',
        value: String(total),
        detail: parts.length ? clip(parts.join(' · ')) : 'all clear',
        tone: total > 0 ? 'alert' : 'ok',
    };
}

// ── Role summaries. Each line is built independently: one bad query degrades to a
// missing line, never a 500. ──────────────────────────────────────────────────

async function pushLine(lines: WidgetLine[], name: string, build: () => Promise<WidgetLine | null>) {
    try {
        const line = await build();
        if (line) lines.push(line);
    } catch (err) {
        console.error(`[Widget] '${name}' metric failed:`, err);
    }
}

async function adminLines(today: string, monday: string): Promise<WidgetLine[]> {
    const lines: WidgetLine[] = [];
    await pushLine(lines, 'jobs-today', async () => {
        const jobs = (await loadJobSpans(today)).filter((j) => j.dates.includes(today));
        return { label: 'Today', icon: 'hammer.fill', value: plural(jobs.length, 'job'), detail: await contractorBreakdown(jobs) };
    });
    await pushLine(lines, 'money', () => moneyLine(monday));
    await pushLine(lines, 'pipeline', pipelineLine);
    await pushLine(lines, 'attention', attentionLine);
    return lines;
}

async function vaLines(today: string): Promise<WidgetLine[]> {
    const lines: WidgetLine[] = [];
    await pushLine(lines, 'leads-today', async () => {
        const [leadRow] = await db.select({ n: sql<number>`count(*)::int` })
            .from(leads)
            .where(sql`${londonDay(leads.createdAt)} = ${today}::date`);
        const [callRow] = await db.select({ n: sql<number>`count(*)::int` })
            .from(calls)
            .where(sql`${londonDay(calls.startTime)} = ${today}::date`);
        return {
            label: 'Today',
            icon: 'person.2.fill',
            value: plural(leadRow?.n ?? 0, 'lead'),
            detail: plural(callRow?.n ?? 0, 'call'),
        };
    });
    await pushLine(lines, 'pipeline', pipelineLine);
    await pushLine(lines, 'attention', attentionLine);
    return lines;
}

async function contractorLines(userId: string, today: string, monday: string): Promise<WidgetLine[]> {
    const profile = await db.query.handymanProfiles.findFirst({
        where: eq(handymanProfiles.userId, userId),
    });
    if (!profile) {
        return [{ label: 'Today', value: '—', detail: 'No contractor profile' }];
    }
    const lines: WidgetLine[] = [];
    let spans: JobSpan[] = [];
    await pushLine(lines, 'my-jobs-today', async () => {
        spans = await loadJobSpans(today, profile.id);
        const todays = spans
            .filter((j) => j.dates.includes(today))
            .sort((a, b) => (a.scheduledStartTime ?? '99').localeCompare(b.scheduledStartTime ?? '99'));
        return {
            label: 'Today',
            icon: 'hammer.fill',
            value: plural(todays.length, 'job'),
            detail: todays.length
                ? clip(todays.map((j) => [j.scheduledStartTime, j.customerName].filter(Boolean).join(' ')).join(' · '))
                : undefined,
        };
    });
    await pushLine(lines, 'my-next-job', async () => {
        const upcoming = spans
            .map((j) => ({ job: j, date: j.dates.filter((d) => d > today).sort()[0] }))
            .filter((x): x is { job: JobSpan; date: string } => !!x.date)
            .sort((a, b) => a.date.localeCompare(b.date)
                || (a.job.scheduledStartTime ?? '99').localeCompare(b.job.scheduledStartTime ?? '99'))[0];
        return {
            label: 'Next',
            icon: 'arrow.right.circle.fill',
            value: upcoming ? shortDate(upcoming.date) : '—',
            detail: upcoming
                ? clip([upcoming.job.scheduledStartTime, upcoming.job.customerName].filter(Boolean).join(' '))
                : 'nothing booked',
        };
    });
    await pushLine(lines, 'my-week', async () => {
        const weekDates = new Set(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
        const n = spans.filter((j) => j.dates.some((d) => weekDates.has(d))).length;
        return { label: 'Week', icon: 'calendar', value: plural(n, 'job'), detail: `w/c ${shortDate(monday)}` };
    });
    return lines;
}

// ── GET /api/widget/summary ──────────────────────────────────────────────────
// Auth: ?token= (Scriptable-friendly) or Authorization: Bearer (curl-friendly).
widgetRouter.get('/api/widget/summary', async (req, res) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const queryToken = typeof req.query.token === 'string' && req.query.token ? req.query.token : null;
    const token = queryToken || bearer;
    if (!token) {
        return res.status(401).json({ error: 'Widget token required' });
    }

    let user: typeof users.$inferSelect | undefined;
    try {
        [user] = await db.select().from(users).where(eq(users.widgetToken, token)).limit(1);
    } catch (err) {
        console.error('[Widget] Summary lookup failed:', err); // never log the token
        return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
    if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid widget token' });
    }

    const today = londonDateStr();
    const monday = mondayOf(today);
    const role = user.role === 'contractor' || user.role === 'va' ? user.role : 'admin';
    const lines = role === 'contractor'
        ? await contractorLines(user.id, today, monday)
        : role === 'va'
            ? await vaLines(today)
            : await adminLines(today, monday);

    res.set('Cache-Control', 'no-store');
    res.json({ role, generatedAt: new Date().toISOString(), lines });
});
