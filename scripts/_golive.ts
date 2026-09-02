/**
 * Shadow ⇄ live helper — CUTOVER.md §2, §3 (steps 1–3) and §4, in order, each step confirmed
 * by re-reading the row and written to system_events.
 *
 *   npx tsx scripts/_golive.ts --status
 *   npx tsx scripts/_golive.ts --to shadow            # prints the plan, changes nothing
 *   npx tsx scripts/_golive.ts --to shadow --yes      # §2: spine shadow, asks off, legacy on-inbound ON
 *   npx tsx scripts/_golive.ts --to live --yes        # §3.1–3.3: spine live, asks on, legacy on-inbound OFF
 *   npx tsx scripts/_golive.ts --rollback --yes       # §4: spine off, asks off, legacy on-inbound ON
 *   … --by courtnee                                   # who, for the event rows (default script:$USER)
 *
 * Every write goes through the existing setters (setSpineMode/setSpineConfig, setCommsAgentConfig),
 * so each flip also carries their own config_change event; this script adds one `golive` row per
 * step with the before/after and the confirmation. Without --yes nothing is written. A step whose
 * re-read does not show the intended value stops the sequence (earlier steps stand; the rollback
 * line is printed). Sampler (§3.4) and autonomy (§3.5) are deliberately NOT here: they have their
 * own eligibility dates (HANDOVER §7) and their own switches on /admin/staff.
 *
 * Run scripts/_golive-check.ts first. Do not run this from a laptop pointed at production without
 * meaning it: the DATABASE_URL host is printed and, on production, --yes is asked for twice
 * (the second time as --yes-production).
 */
import 'dotenv/config';
import { getSpineConfig, setSpineConfig, type SpineConfig } from '../server/spine/config';
import { setSpineMode, spineModeFrom, type SpineMode } from '../server/spine/switch';
import { getCommsAgentConfig, setCommsAgentConfig } from '../server/agents/comms';
import { logSystemEvent } from '../server/system-events';
import { sql } from 'drizzle-orm';
import { db } from '../server/db';

type Target = 'shadow' | 'live' | 'off';
interface Step {
    n: number;
    title: string;
    ref: string;
    /** Returns true when the row already shows the intended value. */
    check: () => Promise<boolean>;
    /** Performs the change through the existing setter. */
    apply: (by: string) => Promise<void>;
    describeBefore: () => Promise<Record<string, unknown>>;
}

const argv = process.argv.slice(2);
const YES = argv.includes('--yes');
const YES_PROD = argv.includes('--yes-production');
const by = argv.includes('--by') ? String(argv[argv.indexOf('--by') + 1] ?? 'script') : `script:${process.env.USER ?? 'unknown'}`;
const dbHost = (process.env.DATABASE_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '');
const isProd = (process.env.DATABASE_URL ?? '').includes('ep-broad-king') || process.env.NODE_ENV === 'production';

function targetFromArgs(): Target | null {
    if (argv.includes('--rollback')) return 'off';
    const i = argv.indexOf('--to');
    if (i < 0) return null;
    const v = String(argv[i + 1] ?? '').toLowerCase();
    return v === 'shadow' || v === 'live' ? v : null;
}

const spineStep = (mode: SpineMode, ref: string): Step => ({
    n: 1, title: `spine mode → ${mode}`, ref,
    check: async () => spineModeFrom(await getSpineConfig()) === mode,
    apply: async (who) => { await setSpineMode(mode, who); },
    describeBefore: async () => { const c = await getSpineConfig(); return { mode: spineModeFrom(c), enabled: c.enabled, shadow: c.shadow }; },
});
const asksStep = (enabled: boolean, ref: string): Step => ({
    n: 2, title: `spine.asks.enabled → ${enabled}`, ref,
    check: async () => (await getSpineConfig()).asks.enabled === enabled,
    apply: async (who) => { await setSpineConfig({ asks: { enabled } } as Partial<SpineConfig>, who); },
    describeBefore: async () => ({ asks: (await getSpineConfig()).asks }),
});
const onInboundStep = (onInbound: boolean, ref: string): Step => ({
    n: 3, title: `comms_agent.onInbound → ${onInbound}`, ref,
    check: async () => (await getCommsAgentConfig()).onInbound === onInbound,
    apply: async () => { await setCommsAgentConfig({ onInbound }); },
    describeBefore: async () => { const c = await getCommsAgentConfig(); return { onInbound: c.onInbound, enabled: c.enabled, autosend: c.autosend }; },
});

const PLANS: Record<Target, { label: string; steps: Step[] }> = {
    shadow: {
        label: 'off → shadow (CUTOVER §2): spine computes and records, never exits; legacy keeps drafting',
        steps: [spineStep('shadow', '§2.1'), asksStep(false, '§2.1 (asks only log "would ask" in shadow)'), onInboundStep(true, '§2.2 (legacy drafts as before)')],
    },
    live: {
        label: 'shadow → live (CUTOVER §3 steps 1–3): DRAFT everywhere; the rules layer is the only SEND',
        steps: [spineStep('live', '§3.1'), asksStep(true, '§3.2'), onInboundStep(false, '§3.3 (one brain per thread)')],
    },
    off: {
        label: 'ROLLBACK (CUTOVER §4): no spine runs, no exits, no asks; legacy on-inbound back on',
        steps: [spineStep('off', '§4'), asksStep(false, '§4'), onInboundStep(true, '§4 (re-enable legacy on-inbound)')],
    },
};

async function status() {
    const s = await getSpineConfig();
    const c = await getCommsAgentConfig();
    console.log(`database: ${dbHost || '(unset)'}${isProd ? '  (PRODUCTION)' : ''}`);
    console.log(`spine: mode=${spineModeFrom(s)} enabled=${s.enabled} shadow=${s.shadow} asks=${s.asks.enabled} autonomy=${s.autonomy.enabled} sampler=${s.sampler.enabled}`);
    console.log(`comms_agent: enabled=${c.enabled} onInbound=${c.onInbound} autosend=${c.autosend.enabled}`);
}

async function main() {
    const target = targetFromArgs();
    if (argv.includes('--status') || !target) {
        await status();
        if (!target) console.log('\nUsage: --to shadow|live [--yes] · --rollback [--yes] · --status · --by <who>');
        process.exit(0);
    }
    const plan = PLANS[target];
    // The config readers fail CLOSED when the database is unreachable: the plan would then show
    // "(already so)" from defaults, and a rollback would write nothing while the live row stays
    // live. Prove the database answers before trusting any read; the setters are idempotent, so
    // under --yes every step is written and then re-read regardless.
    try { await db.execute(sql`SELECT 1`); } catch (e: any) {
        console.error(`\nRefusing: database unreachable (${e?.message ?? e}). Nothing read or written.`);
        process.exit(1);
    }
    console.log(`\n${plan.label}\nby: ${by} · database: ${dbHost || '(unset)'}${isProd ? '  (PRODUCTION)' : ''}\n`);
    for (const st of plan.steps) {
        const already = await st.check();
        console.log(`  ${st.n}. ${st.title.padEnd(34)} ${st.ref}${already ? '   (already so)' : ''}`);
    }
    if (!YES) {
        console.log('\nNothing changed. Add --yes to perform the steps in order' + (isProd ? ' (and --yes-production: this is the live row).' : '.'));
        process.exit(2);
    }
    if (isProd && !YES_PROD) {
        console.error('\nRefusing: DATABASE_URL is production. Add --yes-production as well if you mean it.');
        process.exit(2);
    }
    console.log('');
    for (const st of plan.steps) {
        const before = await st.describeBefore();
        const wasAlready = await st.check();
        await st.apply(by);
        const ok = await st.check();
        const after = await st.describeBefore();
        await logSystemEvent({ kind: 'config_change', source: 'golive', summary: `golive ${target} step ${st.n}/${plan.steps.length}: ${st.title} — ${ok ? 'confirmed' : 'NOT CONFIRMED'}${wasAlready ? ' (was already so)' : ''} by ${by}`, detail: { target, step: st.n, ref: st.ref, before, after, by, changed: !wasAlready, confirmed: ok } });
        if (!ok) {
            console.error(`  ✗ ${st.n}. ${st.title} — re-read does not show it. Stopping; earlier steps stand.`);
            console.error(`    Rollback: npx tsx scripts/_golive.ts --rollback --yes${isProd ? ' --yes-production' : ''}`);
            process.exit(1);
        }
        console.log(`  ✓ ${st.n}. ${st.title} — confirmed${wasAlready ? ' (was already so)' : ''}`);
    }
    console.log('');
    await status();
    if (target === 'live') console.log('\nNext (CUTOVER §3.4–3.5, on their own dates): sampler.enabled on /admin/staff; autonomy after ≥ 14 days of verdicts. Watch §5 for the first hour.');
    if (target === 'off') console.log('\nPending drafts and open flags stay for Ben; nothing was deleted. Read the ledger before re-enabling (§6).');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
