import express, { type Request, Response } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";

// VA Call Performance dashboard aggregates.
// Mounted at /api/calls BEFORE the main calls router so "va-overview" is not
// swallowed by the /:id catch-all in server/calls.ts.

const router = express.Router();

type Period = "today" | "yesterday" | "week" | "month" | "all";

// Test calls to exclude from ALL aggregates (synthetic 07700900xxx etc.)
const NOT_TEST_CALL: SQL = sql`regexp_replace(coalesce(phone_number, ''), '\\s', '', 'g') !~ '^(\\+?447700900|07700900|\\+?449900001)'`;

const SCORED: SQL = sql`ai_score_json IS NOT NULL`;

// Effective handled_by: buckets EVERY call so answered + missed + voicemail
// always equals total (no invisible "unclassified" that makes the answered
// rate and missed count contradict each other). Uses the stored handled_by
// when set, else infers from outcome / missedReason / duration + transcript.
// "Answered" requires a real conversation: the line was up long enough to talk
// (duration >= 15s) AND produced a substantive transcript. Short blips (2-6s
// IVR touches) and no-answer signals are missed — a 6s call is never "answered"
// no matter how many chars its stub transcript carries.
const ANSWERED_MIN_SECONDS = 15;
const EFFECTIVE_HB: SQL = sql`
    CASE
        WHEN handled_by IS NOT NULL THEN handled_by
        WHEN missed_reason IN ('no_answer', 'busy_agent')
             OR outcome IN ('MISSED_CALL', 'NO_ANSWER', 'FAILED', 'DROPPED_EARLY') THEN 'missed'
        WHEN outcome IN ('VOICEMAIL', 'VOICEMAIL_LEFT') THEN 'voicemail'
        WHEN eleven_labs_conversation_id IS NOT NULL THEN 'ai_agent'
        WHEN coalesce(duration, 0) >= ${ANSWERED_MIN_SECONDS}
             AND length(coalesce(transcription, '')) >= 120 THEN 'va'
        ELSE 'missed'
    END
`;

// Within the "missed" bucket, distinguish caller-abandoned (hung up in the
// first few seconds, before anyone could realistically pick up) from
// rang-unanswered (the line rang and nobody answered / agent was busy). This
// keeps the metric fair to the VA — a <10s hang-up isn't a call he ignored.
const ABANDONED_MAX_SECONDS = 10;
const MISSED_KIND: SQL = sql`
    CASE
        WHEN NOT (${EFFECTIVE_HB} = 'missed') THEN NULL
        WHEN missed_reason IN ('no_answer', 'busy_agent')
             OR outcome IN ('MISSED_CALL', 'NO_ANSWER', 'FAILED') THEN 'no_answer'
        WHEN coalesce(duration, 0) < ${ABANDONED_MAX_SECONDS} THEN 'abandoned'
        ELSE 'no_answer'
    END
`;

function resolvePeriodRange(period: Period, month?: string): { start: Date | null; end: Date | null } {
    if (period === "all") {
        return { start: null, end: null };
    }
    if (period === "week") {
        return { start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end: null };
    }
    if (period === "today") {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return { start: startOfDay, end: null };
    }
    if (period === "yesterday") {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfYesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
        return { start: startOfYesterday, end: startOfDay };
    }
    // period === 'month' — a specific calendar month (default: current month)
    const match = /^(\d{4})-(\d{2})$/.exec(month || "");
    const now = new Date();
    const year = match ? parseInt(match[1], 10) : now.getUTCFullYear();
    const monthIndex = match ? parseInt(match[2], 10) - 1 : now.getUTCMonth();
    return {
        start: new Date(Date.UTC(year, monthIndex, 1)),
        end: new Date(Date.UTC(year, monthIndex + 1, 1)),
    };
}

function buildBaseWhere(period: Period, month?: string): SQL {
    const { start, end } = resolvePeriodRange(period, month);
    const conditions: SQL[] = [NOT_TEST_CALL];
    if (start) conditions.push(sql`start_time >= ${start}`);
    if (end) conditions.push(sql`start_time < ${end}`);
    return sql.join(conditions, sql` AND `);
}

// Raw db.execute returns timestamp-without-tz columns as pg strings
// ("2026-06-26 09:34:33.288"). Stored values are UTC (matches how Drizzle
// maps the column), so serialize accordingly.
function toIsoTimestamp(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(`${String(value).replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function round1(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    return Math.round(num * 10) / 10;
}

// Deterministic flag → coaching theme mapping (no LLM)
const FLAG_THEMES: Record<string, string> = {
    no_next_step: "Calls ending without a committed next step",
    no_follow_up_promised: "Calls closing without a follow-up being promised",
    call_ended_abruptly: "Calls ending abruptly mid-conversation",
    customer_frustrated: "Callers showing frustration during calls",
    price_given_without_scoping: "Prices being quoted before the job is scoped",
    missed_upsell: "Upsell opportunities being missed on calls",
    no_video_request: "Callers not being steered to send job media via WhatsApp",
    missed_video_opportunity: "Callers not being steered to send job media via WhatsApp",
    weak_discovery: "Incomplete discovery — key job details going uncaptured",
    incomplete_discovery: "Incomplete discovery — key job details going uncaptured",
    no_postcode: "Postcode not being captured on calls",
    no_callback_number: "Caller phone numbers not being confirmed",
    weak_rapport: "Rapport falling flat — calls feel transactional",
    poor_rapport: "Rapport falling flat — calls feel transactional",
    inaccurate_info: "Inaccurate information being given to callers",
    pricing_error: "Pricing being quoted inaccurately on calls",
};

const CAPTURE_THEMES: Record<string, string> = {
    name: "Caller name capture is weak",
    phone: "Phone number capture is weak",
    postcode: "Postcode capture is weak",
    jobDescription: "Job description capture is weak",
    urgency: "Urgency capture is weak",
};

function deriveCoachingThemes(
    flags: Array<{ flag: string; count: number }>,
    captureRates: Record<string, number | null>,
): string[] {
    const flagThemes = flags.map(({ flag }) => FLAG_THEMES[flag] || `Recurring flag: ${flag.replace(/_/g, " ")}`);
    const captureThemes = Object.entries(captureRates)
        .filter(([, rate]) => rate !== null && rate < 50)
        .sort(([, a], [, b]) => (a ?? 0) - (b ?? 0)) // weakest capture first
        .map(([key]) => CAPTURE_THEMES[key])
        .filter((theme): theme is string => !!theme);

    // Top 2 flag themes, then reserve a slot for the weakest capture rate,
    // then backfill with remaining flag themes. Dedupe, cap at 3.
    const themes: string[] = [];
    const push = (theme: string) => {
        if (!themes.includes(theme)) themes.push(theme);
    };
    flagThemes.slice(0, 2).forEach(push);
    captureThemes.forEach(push);
    flagThemes.forEach(push);
    return themes.slice(0, 3);
}

export async function buildVaOverview(period: Period, month?: string) {
    const where = buildBaseWhere(period, month);

    const [
        totalsResult,
        scoresResult,
        nextStepsResult,
        captureResult,
        flagsResult,
        trendResult,
        recentResult,
        perVaResult,
    ] = await Promise.all([
        // Totals + answer time + call length, one pass over the period
        db.execute(sql`
            SELECT
                count(*)::int AS total,
                (count(*) FILTER (WHERE ${EFFECTIVE_HB} = 'va'))::int AS va,
                (count(*) FILTER (WHERE ${EFFECTIVE_HB} = 'ai_agent'))::int AS ai_agent,
                (count(*) FILTER (WHERE ${EFFECTIVE_HB} = 'missed'))::int AS missed,
                (count(*) FILTER (WHERE ${MISSED_KIND} = 'no_answer'))::int AS missed_no_answer,
                (count(*) FILTER (WHERE ${MISSED_KIND} = 'abandoned'))::int AS missed_abandoned,
                (count(*) FILTER (WHERE ${EFFECTIVE_HB} = 'voicemail'))::int AS voicemail,
                0::int AS unclassified,
                avg(ring_seconds)::float AS avg_ring_seconds,
                (percentile_cont(0.9) WITHIN GROUP (ORDER BY ring_seconds))::float AS p90_ring_seconds,
                (100.0 * (count(*) FILTER (WHERE ring_seconds <= 15))
                    / NULLIF(count(*) FILTER (WHERE ring_seconds IS NOT NULL), 0))::float AS within_15s_pct,
                (avg(duration) FILTER (WHERE ${EFFECTIVE_HB} = 'va'))::float AS va_avg_seconds,
                (avg(duration) FILTER (WHERE ${EFFECTIVE_HB} = 'ai_agent'))::float AS ai_avg_seconds
            FROM calls
            WHERE ${where}
        `),
        // AI scorecard aggregates split by lane
        db.execute(sql`
            SELECT
                handled_by,
                count(*)::int AS count,
                avg((ai_score_json->>'overall')::numeric)::float AS avg_overall,
                avg((ai_score_json->'dimensions'->'discovery'->>'score')::numeric)::float AS discovery,
                avg((ai_score_json->'dimensions'->'conversionBehaviour'->>'score')::numeric)::float AS conversion_behaviour,
                avg((ai_score_json->'dimensions'->'rapport'->>'score')::numeric)::float AS rapport,
                avg((ai_score_json->'dimensions'->'accuracy'->>'score')::numeric)::float AS accuracy
            FROM calls
            WHERE ${where} AND ${SCORED} AND handled_by IN ('va', 'ai_agent')
            GROUP BY handled_by
        `),
        // Next step secured across ALL scored calls
        db.execute(sql`
            SELECT
                coalesce(ai_score_json->'dimensions'->'conversionBehaviour'->>'nextStepSecured', 'none') AS next_step,
                count(*)::int AS count
            FROM calls
            WHERE ${where} AND ${SCORED}
            GROUP BY 1
        `),
        // Discovery capture rates (both lanes combined)
        db.execute(sql`
            SELECT
                count(*)::int AS scored,
                (count(*) FILTER (WHERE (ai_score_json->'dimensions'->'discovery'->'captured'->>'name')::boolean))::int AS name_true,
                (count(*) FILTER (WHERE (ai_score_json->'dimensions'->'discovery'->'captured'->>'phone')::boolean))::int AS phone_true,
                (count(*) FILTER (WHERE (ai_score_json->'dimensions'->'discovery'->'captured'->>'postcode')::boolean))::int AS postcode_true,
                (count(*) FILTER (WHERE (ai_score_json->'dimensions'->'discovery'->'captured'->>'jobDescription')::boolean))::int AS job_description_true,
                (count(*) FILTER (WHERE (ai_score_json->'dimensions'->'discovery'->'captured'->>'urgency')::boolean))::int AS urgency_true
            FROM calls
            WHERE ${where} AND ${SCORED}
        `),
        // Flag frequency across scored calls
        db.execute(sql`
            SELECT flag, count(*)::int AS count
            FROM (
                SELECT ai_score_json->'flags' AS flags
                FROM calls
                WHERE ${where} AND ${SCORED} AND jsonb_typeof(ai_score_json->'flags') = 'array'
            ) scored_calls,
            jsonb_array_elements_text(scored_calls.flags) AS flag
            GROUP BY flag
            ORDER BY count(*) DESC
        `),
        // Weekly trend within the period
        db.execute(sql`
            SELECT
                to_char(date_trunc('week', start_time), 'YYYY-MM-DD') AS week_start,
                count(*)::int AS total,
                (count(*) FILTER (WHERE ${EFFECTIVE_HB} = 'missed'))::int AS missed,
                (avg((ai_score_json->>'overall')::numeric) FILTER (WHERE handled_by = 'va' AND ${SCORED}))::float AS va_avg_score,
                (avg((ai_score_json->>'overall')::numeric) FILTER (WHERE handled_by = 'ai_agent' AND ${SCORED}))::float AS ai_avg_score
            FROM calls
            WHERE ${where} AND start_time IS NOT NULL
            GROUP BY 1
            ORDER BY 1 ASC
        `),
        // 10 most recent scored calls
        db.execute(sql`
            SELECT
                id,
                customer_name,
                start_time,
                handled_by,
                (ai_score_json->>'overall')::float AS overall,
                coalesce(ai_score_json->'dimensions'->'conversionBehaviour'->>'nextStepSecured', 'none') AS next_step_secured,
                ai_score_json->>'coachingNote' AS coaching_note,
                coalesce(ai_score_json->'flags', '[]'::jsonb) AS flags
            FROM calls
            WHERE ${where} AND ${SCORED}
            ORDER BY start_time DESC NULLS LAST
            LIMIT 10
        `),
        // Per-VA leaderboard — VA-handled calls grouped by who answered.
        // (Missed calls have no owner, so they stay team-level, not here.)
        db.execute(sql`
            SELECT
                handled_by_user_id AS user_id,
                coalesce(u.first_name, 'VA') AS name,
                count(*)::int AS answered,
                (count(*) FILTER (WHERE ai_score_json IS NOT NULL))::int AS scored,
                avg((ai_score_json->>'overall')::numeric)::float AS avg_overall,
                (count(*) FILTER (WHERE ai_score_json->'dimensions'->'conversionBehaviour'->>'nextStepSecured' = 'video_request'))::int AS video_requests,
                avg(ring_seconds)::float AS avg_answer_seconds
            FROM calls
            LEFT JOIN users u ON u.id = calls.handled_by_user_id
            WHERE ${where} AND handled_by = 'va' AND handled_by_user_id IS NOT NULL
            GROUP BY handled_by_user_id, u.first_name
            ORDER BY answered DESC
        `),
    ]);

    const totalsRow = totalsResult.rows[0] as any;
    const total = Number(totalsRow?.total || 0);
    const va = Number(totalsRow?.va || 0);
    const aiAgent = Number(totalsRow?.ai_agent || 0);

    const emptyLane = () => ({
        count: 0,
        avgOverall: null as number | null,
        dimensions: {
            discovery: null as number | null,
            conversionBehaviour: null as number | null,
            rapport: null as number | null,
            accuracy: null as number | null,
        },
    });
    const scores = { va: emptyLane(), aiAgent: emptyLane() };
    for (const row of scoresResult.rows as any[]) {
        const lane = row.handled_by === "va" ? scores.va : row.handled_by === "ai_agent" ? scores.aiAgent : null;
        if (!lane) continue;
        lane.count = Number(row.count || 0);
        lane.avgOverall = round1(row.avg_overall);
        lane.dimensions = {
            discovery: round1(row.discovery),
            conversionBehaviour: round1(row.conversion_behaviour),
            rapport: round1(row.rapport),
            accuracy: round1(row.accuracy),
        };
    }

    const nextSteps: Record<string, number> = {
        video_request: 0,
        instant_quote: 0,
        site_visit: 0,
        callback: 0,
        none: 0,
    };
    for (const row of nextStepsResult.rows as any[]) {
        const step = row.next_step in nextSteps ? row.next_step : "none";
        nextSteps[step] += Number(row.count || 0);
    }

    const captureRow = captureResult.rows[0] as any;
    const scoredCount = Number(captureRow?.scored || 0);
    const captureRate = (trueCount: unknown): number | null =>
        scoredCount > 0 ? round1((100 * Number(trueCount || 0)) / scoredCount) : null;
    const discoveryCaptureRates = {
        name: captureRate(captureRow?.name_true),
        phone: captureRate(captureRow?.phone_true),
        postcode: captureRate(captureRow?.postcode_true),
        jobDescription: captureRate(captureRow?.job_description_true),
        urgency: captureRate(captureRow?.urgency_true),
    };

    const flags = (flagsResult.rows as any[]).map((row) => ({
        flag: String(row.flag),
        count: Number(row.count || 0),
    }));

    const coachingThemes = deriveCoachingThemes(flags, discoveryCaptureRates);

    const trend = (trendResult.rows as any[]).map((row) => ({
        weekStart: row.week_start,
        total: Number(row.total || 0),
        missed: Number(row.missed || 0),
        vaAvgScore: round1(row.va_avg_score),
        aiAvgScore: round1(row.ai_avg_score),
    }));

    const recentScored = (recentResult.rows as any[]).map((row) => ({
        id: row.id,
        customerName: row.customer_name || "Unknown",
        startTime: toIsoTimestamp(row.start_time),
        handledBy: row.handled_by,
        overall: row.overall === null || row.overall === undefined ? null : Math.round(Number(row.overall)),
        nextStepSecured: row.next_step_secured,
        coachingNote: row.coaching_note || "",
        flags: Array.isArray(row.flags) ? row.flags : [],
    }));

    return {
        totals: {
            total,
            va,
            aiAgent,
            missed: Number(totalsRow?.missed || 0),
            missedNoAnswer: Number(totalsRow?.missed_no_answer || 0),
            missedAbandoned: Number(totalsRow?.missed_abandoned || 0),
            voicemail: Number(totalsRow?.voicemail || 0),
            unclassified: Number(totalsRow?.unclassified || 0),
            answeredRatePct: total > 0 ? round1((100 * (va + aiAgent)) / total) : 0,
        },
        answerTime: {
            avgSeconds: round1(totalsRow?.avg_ring_seconds),
            p90Seconds: round1(totalsRow?.p90_ring_seconds),
            within15sPct: round1(totalsRow?.within_15s_pct),
        },
        callLength: {
            vaAvgSeconds: round1(totalsRow?.va_avg_seconds),
            aiAvgSeconds: round1(totalsRow?.ai_avg_seconds),
        },
        scores,
        nextSteps,
        discoveryCaptureRates,
        flags,
        coachingThemes,
        trend,
        recentScored,
        perVa: (perVaResult.rows as any[]).map((row) => {
            const answered = Number(row.answered) || 0;
            const videoRequests = Number(row.video_requests) || 0;
            return {
                userId: row.user_id,
                name: row.name || "VA",
                answered,
                scored: Number(row.scored) || 0,
                avgOverall: round1(row.avg_overall),
                videoRequests,
                videoRequestPct: answered > 0 ? round1((100 * videoRequests) / answered) : null,
                avgAnswerSeconds: round1(row.avg_answer_seconds),
            };
        }),
    };
}

// --- Quote ↔ call linking -------------------------------------------------
// Project phone-normalization convention: strip non-digits; '44' + 12 digits
// → drop the '44'; '0' + 11 digits → drop the '0'. UK mobiles end up as 10
// digits starting '7'. Landlines fall back to a last-10-digits comparison,
// which the SQL below applies uniformly to both sides.
function phoneMatchKey(raw: string): string | null {
    const digits = (raw || "").replace(/\D/g, "");
    let national = digits;
    if (digits.length === 12 && digits.startsWith("44")) {
        national = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith("0")) {
        national = digits.slice(1);
    }
    if (national.length < 10) return null;
    return national.slice(-10);
}

export type RecentCallByPhone = {
    id: string;
    startTime: string | null;
    durationSeconds: number | null;
    customerName: string | null;
    handledBy: string;
    jobSummary: string | null;
    overallScore: number | null;
};

// Recent answered calls (va/ai_agent only — a conversation happened) for a
// phone number, newest first. Returns null when the phone can't be parsed.
export async function findRecentCallsByPhone(rawPhone: string, days: number): Promise<RecentCallByPhone[] | null> {
    const key = phoneMatchKey(rawPhone);
    if (!key) return null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await db.execute(sql`
        SELECT
            id,
            start_time,
            duration,
            customer_name,
            handled_by,
            job_summary,
            (ai_score_json->>'overall')::float AS overall
        FROM calls
        WHERE ${NOT_TEST_CALL}
          AND handled_by IN ('va', 'ai_agent')
          AND right(regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g'), 10) = ${key}
          AND start_time >= ${since}
        ORDER BY start_time DESC
        LIMIT 10
    `);

    return (result.rows as any[]).map((row) => ({
        id: String(row.id),
        startTime: toIsoTimestamp(row.start_time),
        durationSeconds: row.duration === null || row.duration === undefined ? null : Number(row.duration),
        customerName: row.customer_name || null,
        handledBy: String(row.handled_by),
        jobSummary: row.job_summary || null,
        overallScore: row.overall === null || row.overall === undefined ? null : Math.round(Number(row.overall)),
    }));
}

// GET /api/calls/recent-by-phone?phone=<raw>&days=14
// Powers the quote builder's "link this quote to a call" picker.
router.get("/recent-by-phone", async (req: Request, res: Response) => {
    try {
        const rawPhone = typeof req.query.phone === "string" ? req.query.phone : "";
        if (!rawPhone.trim()) {
            return res.status(400).json({ error: "phone query param is required" });
        }

        const daysRaw = Number(req.query.days);
        const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 90) : 14;

        const calls = await findRecentCallsByPhone(rawPhone, days);
        if (calls === null) {
            return res.status(400).json({ error: "phone could not be parsed" });
        }
        res.json({ calls });
    } catch (error) {
        console.error("Error looking up recent calls by phone:", error);
        res.status(500).json({ error: "Failed to look up recent calls" });
    }
});

// GET /api/calls/va-overview?period=today|yesterday|week|month|all&month=YYYY-MM
router.get("/va-overview", async (req: Request, res: Response) => {
    try {
        const period = (req.query.period as string) || "month";
        if (!["today", "yesterday", "week", "month", "all"].includes(period)) {
            return res.status(400).json({ error: "period must be one of: today, yesterday, week, month, all" });
        }
        const month = req.query.month as string | undefined;
        if (month && !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: "month must be in YYYY-MM format" });
        }

        const overview = await buildVaOverview(period, month);
        res.json(overview);
    } catch (error) {
        console.error("Error building VA call performance overview:", error);
        res.status(500).json({ error: "Failed to build VA overview" });
    }
});

export default router;
