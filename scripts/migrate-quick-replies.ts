/**
 * Creates quick_replies and seeds it with the starting set.
 *
 * Targeted DDL on purpose — `npm run db:push` is unsafe on this schema (entangled tables), so new
 * tables get an explicit idempotent CREATE instead.
 *
 *   npx tsx scripts/migrate-quick-replies.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// Approved Twilio templates on this account. Only these can be sent outside the 24h window.
const TPL_VIDEO_REQUEST = process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2'; // 1 var: name
const TPL_FIRST = 'HX7602b82f69c81dfc12cb80afb39caf68'; // 0 vars — generic "send us a video"

type Seed = {
    id: string;
    label: string;
    body: string;
    category: string;
    shortcut: string;
    contentSid?: string;
    contentVariables?: Record<string, string>;
};

// Voice per brand-voice/tone.md: friendly Nottingham tradesperson texting a customer.
// Plain English, UK spelling, short and direct. Close forward into one action.
const SEEDS: Seed[] = [
    {
        id: 'qr_video_request',
        label: 'Ask for a video',
        shortcut: '/video',
        category: 'quoting',
        body: "Hi {{first_name}}, thanks for the call. Send us a quick video of the job — walk us round it and say what you're after. Saves a visit and means we can price it properly.",
        contentSid: TPL_VIDEO_REQUEST,
        contentVariables: { '1': '{{first_name}}' },
    },
    {
        id: 'qr_video_request_generic',
        label: 'Ask for a video (no name)',
        shortcut: '/video2',
        category: 'quoting',
        body: 'As discussed, please send us a quick video — show us everything and tell us exactly what you need.',
        contentSid: TPL_FIRST,
    },
    {
        id: 'qr_photos',
        label: 'Ask for photos',
        shortcut: '/photos',
        category: 'quoting',
        body: "Could you send a couple of photos of it, {{first_name}}? One close up and one standing back. That's usually enough for us to price it up.",
    },
    {
        id: 'qr_quote_sent',
        label: 'Quote sent',
        shortcut: '/quote',
        category: 'quoting',
        body: "That's your quote sent over, {{first_name}}. Everything's itemised so you can see what you're paying for. Any questions, just reply here.",
    },
    {
        id: 'qr_address_check',
        label: 'Confirm address',
        shortcut: '/address',
        category: 'scheduling',
        body: "Can you confirm the full address and postcode, {{first_name}}? Want to make sure we're routing the right person to you.",
    },
    {
        id: 'qr_on_the_way',
        label: 'On the way',
        shortcut: '/otw',
        category: 'scheduling',
        body: "Morning {{first_name}} — we're on the way, should be about 30 minutes. Any problems getting in, give us a shout.",
    },
    {
        id: 'qr_running_late',
        label: 'Running late',
        shortcut: '/late',
        category: 'scheduling',
        body: "{{first_name}}, the job before yours has run over — we're about 45 minutes behind. Sorry to keep you waiting. Still coming today.",
    },
    {
        id: 'qr_booked',
        label: 'Booking confirmed',
        shortcut: '/booked',
        category: 'scheduling',
        body: "You're booked in, {{first_name}}. We'll text 30 minutes before we arrive so you're not sat waiting.",
    },
    {
        id: 'qr_job_done',
        label: 'Job finished',
        shortcut: '/done',
        category: 'aftercare',
        body: "All finished at yours today, {{first_name}}. Photos are on the way. Anything not right, tell us and we'll come back and sort it.",
    },
    {
        id: 'qr_review_ask',
        label: 'Ask for a review',
        shortcut: '/review',
        category: 'aftercare',
        body: "Glad that's sorted, {{first_name}}. If you've got a spare minute, a quick Google review genuinely helps us out — no worries either way.",
    },
    {
        id: 'qr_payment_link',
        label: 'Payment link',
        shortcut: '/pay',
        category: 'money',
        body: "Here's the payment link for the work, {{first_name}}. Card or Apple Pay, whichever's easier.",
    },
    {
        id: 'qr_out_of_area',
        label: 'Out of area',
        shortcut: '/area',
        category: 'general',
        body: "Thanks for getting in touch, {{first_name}}. That one's outside where we cover, so we'd be doing you a disservice taking it on. Worth trying someone more local.",
    },
    {
        id: 'qr_chase_no_reply',
        label: 'Nudge — no reply',
        shortcut: '/nudge',
        category: 'general',
        body: "Just circling back on this, {{first_name}}. Still happy to help if you want it doing — and no problem at all if you've sorted it elsewhere.",
    },
];

async function main() {
    console.log('Creating quick_replies ...');
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS quick_replies (
            id                varchar PRIMARY KEY NOT NULL,
            label             varchar(80) NOT NULL,
            body              text NOT NULL,
            category          varchar(30) DEFAULT 'general',
            content_sid       varchar,
            content_variables jsonb,
            shortcut          varchar(24),
            sort_order        integer DEFAULT 0,
            is_active         boolean DEFAULT true,
            usage_count       integer DEFAULT 0,
            last_used_at      timestamp,
            created_at        timestamp DEFAULT now(),
            updated_at        timestamp DEFAULT now()
        )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_quick_replies_active ON quick_replies (is_active, sort_order)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_quick_replies_category ON quick_replies (category)`);
    console.log('Table + indexes ready.');

    console.log(`Seeding ${SEEDS.length} replies ...`);
    for (const [i, s] of SEEDS.entries()) {
        // Seed-only: never clobber wording an operator has since edited.
        await db.execute(sql`
            INSERT INTO quick_replies (id, label, body, category, content_sid, content_variables, shortcut, sort_order)
            VALUES (
                ${s.id}, ${s.label}, ${s.body}, ${s.category},
                ${s.contentSid ?? null},
                ${s.contentVariables ? JSON.stringify(s.contentVariables) : null}::jsonb,
                ${s.shortcut}, ${i * 10}
            )
            ON CONFLICT (id) DO NOTHING
        `);
    }

    const rows: any = await db.execute(sql`
        SELECT category, count(*)::int AS n, count(content_sid)::int AS template_backed
        FROM quick_replies GROUP BY category ORDER BY category
    `);
    console.table(rows.rows ?? rows);
    console.log('Done.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
