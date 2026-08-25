import { db } from "../server/db";
import { sql } from "drizzle-orm";

// Attribution note: single VA endpoint maps to Ben's user id, so his and the
// owner's answered calls are indistinguishable by id. Split by DATE using Ben's
// holiday handover (30 Jul) as the boundary. All rows below are handled_by='va'.
const BOUND = "2026-07-30";

type Row = Record<string, any>;

async function qualityForWindow(label: string, from: string, to: string | null) {
  const to_ = to ?? "9999-01-01";
  const r = (await db.execute(sql`
    SELECT
      count(*) AS n,
      count(*) FILTER (WHERE ai_scored_at IS NOT NULL) AS scored,
      avg((ai_score_json->>'overall')::numeric)                                        AS overall,
      avg((ai_score_json->'dimensions'->'discovery'->>'score')::numeric)              AS discovery,
      avg((ai_score_json->'dimensions'->'conversionBehaviour'->>'score')::numeric)    AS conv,
      avg((ai_score_json->'dimensions'->'rapport'->>'score')::numeric)                AS rapport,
      avg((ai_score_json->'dimensions'->'rapport'->'toneMatch'->>'score')::numeric)   AS tone,
      avg((ai_score_json->'dimensions'->'accuracy'->>'score')::numeric)               AS accuracy,
      avg(duration) FILTER (WHERE duration > 0)                                        AS avg_dur,
      -- discovery capture rates (did they ask the questions?)
      avg(((ai_score_json->'dimensions'->'discovery'->'captured'->>'name')::boolean)::int)::numeric      AS cap_name,
      avg(((ai_score_json->'dimensions'->'discovery'->'captured'->>'postcode')::boolean)::int)::numeric  AS cap_postcode,
      avg(((ai_score_json->'dimensions'->'discovery'->'captured'->>'urgency')::boolean)::int)::numeric   AS cap_urgency
    FROM calls
    WHERE handled_by='va' AND start_time >= ${from} AND start_time < ${to_}
  `)).rows[0] as Row;
  return { label, ...r };
}

async function outcomeMix(from: string, to: string | null) {
  const to_ = to ?? "9999-01-01";
  return (await db.execute(sql`
    SELECT outcome, count(*) AS n
    FROM calls
    WHERE handled_by='va' AND start_time >= ${from} AND start_time < ${to_}
    GROUP BY outcome ORDER BY n DESC
  `)).rows as Row[];
}

async function conversion(from: string, to: string | null) {
  const to_ = to ?? "9999-01-01";
  // Quotes whose source call falls in the window (call-attributed conversion)
  return (await db.execute(sql`
    SELECT
      count(*) AS quotes,
      count(*) FILTER (WHERE q.viewed_at IS NOT NULL) AS viewed,
      count(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL) AS paid,
      avg(COALESCE(q.selected_tier_price_pence, q.base_job_price_pence, q.base_price)::numeric)
        FILTER (WHERE COALESCE(q.selected_tier_price_pence, q.base_job_price_pence, q.base_price) > 0) AS avg_value_pence
    FROM personalized_quotes q
    JOIN calls c ON c.id = q.source_call_id
    WHERE c.handled_by='va' AND c.start_time >= ${from} AND c.start_time < ${to_}
  `)).rows[0] as Row;
}

const n2 = (x: any) => x == null ? "  -  " : Number(x).toFixed(1);
const pct = (a: any, b: any) => (b && Number(b) > 0) ? (100 * Number(a) / Number(b)).toFixed(0) + "%" : "-";

async function main() {
  const windows: [string, string, string | null][] = [
    ["YOU (30 Jul→now)", BOUND, null],
    ["BEN (Jul 1–29)",   "2026-07-01", BOUND],
    ["BEN (Jun)",        "2026-06-01", "2026-07-01"],
    ["BEN (May)",        "2026-05-01", "2026-06-01"],
  ];

  console.log("=== CALL QUALITY (AI scorecard, 0–100) — handled_by='va' ===\n");
  console.log("window              n   scored  overall  disc  conv  rapp  tone  accu  avgDur(s)");
  for (const [label, from, to] of windows) {
    const q = await qualityForWindow(label, from, to);
    console.log(
      label.padEnd(19) +
      String(q.n).padEnd(4) + String(q.scored).padEnd(8) +
      n2(q.overall).padEnd(9) + n2(q.discovery).padEnd(6) + n2(q.conv).padEnd(6) +
      n2(q.rapport).padEnd(6) + n2(q.tone).padEnd(6) + n2(q.accuracy).padEnd(6) +
      (q.avg_dur == null ? "-" : Number(q.avg_dur).toFixed(0))
    );
  }

  console.log("\n=== DISCOVERY CAPTURE — % of calls that got the info (your 'not asking enough' complaint) ===");
  console.log("window              name%   postcode%  urgency%");
  for (const [label, from, to] of windows) {
    const q = await qualityForWindow(label, from, to);
    if (q.scored == 0) continue;
    console.log(
      label.padEnd(19) +
      pct(q.cap_name, 1).padEnd(8) + pct(q.cap_postcode, 1).padEnd(11) + pct(q.cap_urgency, 1)
    );
  }

  console.log("\n=== OUTCOME MIX ===");
  for (const [label, from, to] of windows) {
    const mix = await outcomeMix(from, to);
    const tot = mix.reduce((s, m) => s + Number(m.n), 0);
    console.log(`\n${label}  (total ${tot})`);
    for (const m of mix) console.log(`  ${(m.outcome ?? 'NULL').padEnd(20)} ${m.n}  (${pct(m.n, tot)})`);
  }

  console.log("\n=== CALL→QUOTE→DEPOSIT CONVERSION (quotes whose source_call is in window) ===");
  console.log("NOTE: deposits lag — recent calls understate conversion (quote may still be live).\n");
  console.log("window              quotes  viewed  paid  paid/quote  paid/viewed  avg£");
  for (const [label, from, to] of windows) {
    const c = await conversion(from, to);
    const avg = c.avg_value_pence ? "£" + (Number(c.avg_value_pence) / 100).toFixed(0) : "-";
    console.log(
      label.padEnd(19) +
      String(c.quotes).padEnd(8) + String(c.viewed).padEnd(8) + String(c.paid).padEnd(6) +
      pct(c.paid, c.quotes).padEnd(12) + pct(c.paid, c.viewed).padEnd(13) + avg
    );
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
