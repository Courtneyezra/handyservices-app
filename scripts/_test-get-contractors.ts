/**
 * E-WP1 smoke test: the ops-manager get_contractors roster tool + the
 * quick-reply options prompt convention. READ-ONLY — runs one roster read,
 * writes nothing. Usage: npx tsx scripts/_test-get-contractors.ts
 */
import { buildTools, SYSTEM, STAFF } from '../server/agents/ops-manager';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const EXPECTED_TOOLS = [
  'get_board_snapshot', 'get_pipeline_snapshot', 'get_thread', 'get_contractor_availability',
  'get_agent_roster', 'get_sla_state', 'get_call_tasks', 'get_contractors', 'get_jobs',
  'get_money_state', 'get_customer_dossier',
  'run_comms_agent', 'run_quote_prep', 'run_recovery_sweep', 'run_sla_sweep',
  'create_va_call_task', 'complete_call_task', 'dismiss_call_task',
  'propose_job_assignment', 'generate_invoice', 'queue_draft', 'flag_for_ben',
];

const CRAIG_ID = 'hp_aa21264a-9143-4116-bda2-2da998255929';

async function main() {
  const tools = buildTools();
  const names = tools.map((t) => t.name);

  // 1. Tool roster: 22 tools, all 21 pre-existing ones still present.
  check('buildTools returns 22 tools', tools.length === 22, `got ${tools.length}`);
  for (const expected of EXPECTED_TOOLS) {
    check(`tool present: ${expected}`, names.includes(expected));
  }

  // 2. get_contractors runs and returns real roster data.
  const tool = tools.find((t) => t.name === 'get_contractors');
  check('get_contractors found', !!tool);
  if (tool) {
    const result: any = await tool.run({});
    const contractors: any[] = result?.contractors ?? [];
    check('returns contractors array', Array.isArray(contractors) && contractors.length > 0,
      `${contractors.length} rows`);
    check('note mentions the id-taking tools',
      typeof result?.note === 'string'
      && result.note.includes('get_jobs')
      && result.note.includes('get_contractor_availability')
      && result.note.includes('propose_job_assignment'));

    check('every row has id/name strings',
      contractors.every((c) => typeof c.id === 'string' && c.id.length > 0 && typeof c.name === 'string' && c.name.length > 0));
    const hpRows = contractors.filter((c) => String(c.id).startsWith('hp_'));
    check("rows have ids starting 'hp_' (spot-check)", hpRows.length > 0,
      `${hpRows.length}/${contractors.length} hp_-prefixed`);

    const craig = contractors.find((c) => c.id === CRAIG_ID);
    check('Craig Smith present with expected id', !!craig && craig.name === 'Craig Smith',
      craig ? `name="${craig.name}"` : 'id not found');

    const sorted = [...contractors].sort((a, b) => a.name.localeCompare(b.name));
    check('ordered by name', contractors.every((c, i) => c.name === sorted[i].name));

    console.log('\nRoster sample:');
    for (const c of contractors.slice(0, 8)) {
      console.log(`  ${c.id}  ${c.name}${c.businessName ? ` (${c.businessName})` : ''}${c.city ? ` — ${c.city}` : ''}`);
    }
    console.log('');
  }

  // 3. SYSTEM prompt carries the quick-reply options convention, verbatim anchors.
  check("SYSTEM contains literal '```options'", SYSTEM.includes('```options'));
  check('SYSTEM describes the quick-reply convention',
    SYSTEM.includes('tappable quick replies')
    && SYSTEM.includes('JSON array of 2–6 short strings')
    && SYSTEM.includes('LAST thing in the message'));

  // 4. Staff card lists the new tool as a read.
  const card = STAFF.tools.find((t) => t.name === 'get_contractors');
  check('STAFF card has get_contractors read entry', !!card && card.kind === 'read');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
