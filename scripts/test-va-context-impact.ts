/**
 * VA Customer Context Impact Test
 *
 * Tests whether vaContext actually influences LLM output.
 * Sends the SAME job through the engine 3 times:
 *   A. No context   — baseline, generic
 *   B. Thin context — just "Landlord. Remote."
 *   C. Rich context — full VA notes about the customer
 *
 * Then compares:
 *   - Headline (should reference customer situation in C)
 *   - WhatsApp message (should reference photos, tenant, remoteness in C)
 *   - Pricing (should differ based on signals read from context)
 *   - Specific keywords from context appearing in output
 *   - Value bullets (should be contextually relevant in C)
 *
 * Also runs a second triplet for a completely different customer type
 * (commercial / small business) to ensure context isolation.
 *
 * Usage:  npx tsx scripts/test-va-context-impact.ts [BASE_URL]
 *         BASE_URL defaults to http://localhost:5000
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = process.argv[2] || 'http://localhost:5000';
const ADMIN_EMAIL = 'admin@handyservices.com';
const ADMIN_PASSWORD = 'admin123';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m', blue: '\x1b[34m',
  magenta: '\x1b[35m', white: '\x1b[37m',
};

function pass(msg: string) { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${c.red}✗${c.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${c.grey}· ${msg}${c.reset}`); }
function warn(msg: string) { console.log(`  ${c.yellow}⚠ ${msg}${c.reset}`); }
function section(msg: string) { console.log(`\n${c.bold}${c.cyan}── ${msg} ──${c.reset}`); }
function header(msg: string) { console.log(`\n${c.bold}${c.magenta}${msg}${c.reset}`); }
function row(label: string, value: string, highlight = false) {
  const val = highlight ? `${c.yellow}${value}${c.reset}` : `${c.white}${value}${c.reset}`;
  console.log(`  ${c.grey}${label.padEnd(22)}${c.reset} ${val}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status})`);
  const data = await res.json() as any;
  return data.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quote creator
// ─────────────────────────────────────────────────────────────────────────────

async function createQuote(token: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/pricing/create-contextual-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Context triplets — same job, 3 context levels
// ─────────────────────────────────────────────────────────────────────────────

interface ContextVariant {
  label: string;
  vaContext?: string;
  // Keywords we expect to appear in output when context is rich enough
  expectedKeywords?: string[];
  // Keywords that should NOT appear (to detect hallucination)
  forbiddenKeywords?: string[];
}

interface Triplet {
  name: string;
  description: string;
  basePayload: Record<string, unknown>;
  variants: [ContextVariant, ContextVariant, ContextVariant]; // [none, thin, rich]
  // What specifically should change between thin→rich
  richContextSignals: string[];
}

const TRIPLETS: Triplet[] = [
  // ── Triplet 1: Dripping tap — landlord context ──────────────────────────────
  {
    name: 'Tap repair — Landlord context impact',
    description: 'Same job (dripping tap, 45min) run with no / thin / rich landlord context',
    basePayload: {
      customerName: 'Sarah Mitchell',
      phone: '07700901001',
      lines: [{
        id: 'l1',
        description: 'Dripping bathroom tap — needs washer replacement',
        category: 'plumbing_minor',
        estimatedMinutes: 45,
        materialsCostPence: 500,
      }],
      signals: {
        urgency: 'standard',
        materialsSupply: 'we_supply',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
    variants: [
      {
        label: 'A · No context',
        vaContext: undefined,
        forbiddenKeywords: [], // nothing expected or forbidden specifically
      },
      {
        label: 'B · Thin context',
        vaContext: 'Landlord. Remote.',
        expectedKeywords: [],
      },
      {
        label: 'C · Rich context',
        vaContext: "She's a landlord, lives about 2 hours away from her rental property. Tenant reported the dripping tap — she hasn't seen it herself. Very keen on photo proof sent after the job so she can confirm to the tenant it's done. Mentioned she's happy to pay a fair price but wants reliability above all. She won't be there — tenant will let us in. Wants the invoice emailed for her tax records.",
        expectedKeywords: ['photo', 'tenant', 'invoice', 'landlord'],
        forbiddenKeywords: ['pension', 'urgent', 'emergency'],
      },
    ],
    richContextSignals: ['Photo proof mentioned in message', 'Tenant coordination referenced', 'Remote/not present acknowledged'],
  },

  // ── Triplet 2: Electrical socket — commercial vs domestic context ────────────
  {
    name: 'Socket install — Commercial vs domestic context',
    description: 'Same job (socket install, 60min) with no / domestic / commercial context',
    basePayload: {
      customerName: 'Marcus Reid',
      phone: '07700901002',
      lines: [{
        id: 'l1',
        description: 'Install 2 new double sockets in the room',
        category: 'electrical_minor',
        estimatedMinutes: 60,
        materialsCostPence: 1200,
      }],
      signals: {
        urgency: 'standard',
        materialsSupply: 'we_supply',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
    variants: [
      {
        label: 'A · No context',
        vaContext: undefined,
      },
      {
        label: 'B · Domestic context',
        vaContext: 'Homeowner. New home office setup. Needs sockets behind desk.',
        expectedKeywords: [],
      },
      {
        label: 'C · Commercial context',
        vaContext: "He runs a small barbershop. Needs the sockets behind his barber chair for the clippers and a phone charging station. Says the shop is open 6 days a week — needs it done before opening on Monday. He's the owner, will be there. Mentioned he's price-conscious but won't compromise on safety.",
        expectedKeywords: ['monday', 'shop', 'barber', 'open'],
        forbiddenKeywords: ['bedroom', 'living room', 'home'],
      },
    ],
    richContextSignals: ['Commercial/business urgency reflected in message', 'Before-opening timeline acknowledged', 'Professional tone for business owner'],
  },

  // ── Triplet 3: Flat pack — OAP trust context vs young professional ───────────
  {
    name: 'Furniture assembly — OAP trust vs busy professional',
    description: 'Same job (wardrobe assembly, 90min) with no / OAP / busy-pro context',
    basePayload: {
      customerName: 'Pat Davies',
      phone: '07700901003',
      lines: [{
        id: 'l1',
        description: 'Assemble IKEA PAX wardrobe (standard 2-door)',
        category: 'flat_pack',
        estimatedMinutes: 90,
      }],
      signals: {
        urgency: 'standard',
        materialsSupply: 'labor_only',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
    variants: [
      {
        label: 'A · No context',
        vaContext: undefined,
      },
      {
        label: 'B · OAP / trust-seeker',
        vaContext: "Elderly lady, lives alone, quite nervous about letting people in. She was asking lots of questions about who would come and whether they're DBS checked. Very polite. Just needs one wardrobe put together — her grandson bought it for her. Any weekday morning works.",
        expectedKeywords: ['morning', 'secure', 'trust', 'alone', 'peace'],
        forbiddenKeywords: ['urgent', 'emergency', 'business'],
      },
      {
        label: 'C · Busy professional',
        vaContext: "Works in finance, very busy, very direct on the phone. Just needs it done — told me he doesn't care about the details, just give him a time and a price. Can only do evenings or weekends. Couldn't care less about the process, just wants the result.",
        expectedKeywords: ['quick', 'time', 'sorted', 'done'],
        forbiddenKeywords: ['worried', 'alone', 'nervous'],
      },
    ],
    richContextSignals: ['Tone shifts between OAP (reassuring) and busy-pro (efficient)', 'Availability preference reflected', 'No unnecessary detail for busy-pro'],
  },

  // ── Triplet 4: Emergency — with/without stress signals ───────────────────────
  {
    name: 'Burst pipe — stress and urgency context',
    description: 'Same emergency job with no / minimal / full stress context',
    basePayload: {
      customerName: 'Rachel Price',
      phone: '07700901004',
      lines: [{
        id: 'l1',
        description: 'Burst pipe under kitchen sink — water leaking',
        category: 'plumbing_minor',
        estimatedMinutes: 60,
        materialsCostPence: 2000,
      }],
      signals: {
        urgency: 'emergency',
        materialsSupply: 'we_supply',
        timeOfService: 'standard',
        isReturningCustomer: false,
        previousJobCount: 0,
        previousAvgPricePence: 0,
      },
    },
    variants: [
      {
        label: 'A · No context',
        vaContext: undefined,
      },
      {
        label: 'B · Minimal — just urgency',
        vaContext: 'Burst pipe. Very urgent.',
        expectedKeywords: [],
      },
      {
        label: 'C · Full stress context',
        vaContext: "She called back three times — clearly very stressed. Water is pooling on the kitchen floor and spreading to the hallway. She lives alone and has young children at home. Turned the stopcock off so water is stopped but it's still a mess. First time using us, found us on Google. She's worried about the cost but needs it sorted today.",
        expectedKeywords: ['today', 'sorted', 'quick', 'fast'],
        forbiddenKeywords: ['relax', 'no rush', 'flexible'],
      },
    ],
    richContextSignals: ['Urgency language in message for C', 'Reassuring tone for stressed solo parent', 'Cost sensitivity acknowledged'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Comparison engine
// ─────────────────────────────────────────────────────────────────────────────

interface QuoteOutput {
  label: string;
  headline: string;
  whatsappMessage: string;
  directPriceMessage: string | null;
  valueBullets: string[];
  totalFormatted: string;
  totalPence: number;
  layoutTier: string;
  proposalSummary: string;
  whatsappClosing: string;
}

function extractOutput(label: string, data: any): QuoteOutput {
  const messaging = data.messaging || {};
  const pricing = data.pricing || {};
  return {
    label,
    headline: messaging.headline || messaging.contextualHeadline || '',
    whatsappMessage: data.whatsappMessage || '',
    directPriceMessage: data.directPriceMessage || null,
    valueBullets: messaging.valueBullets || [],
    totalFormatted: pricing.totalFormatted || '?',
    totalPence: pricing.totalPence || 0,
    layoutTier: messaging.layoutTier || '?',
    proposalSummary: messaging.proposalSummary || messaging.message || '',
    whatsappClosing: messaging.whatsappClosing || '',
  };
}

// Check if keyword appears in any output field (case-insensitive)
function containsKeyword(output: QuoteOutput, keyword: string): boolean {
  const searchable = [
    output.headline,
    output.whatsappMessage,
    output.proposalSummary,
    output.whatsappClosing,
    ...output.valueBullets,
  ].join(' ').toLowerCase();
  return searchable.includes(keyword.toLowerCase());
}

function textDifference(a: string, b: string): number {
  // Simple measure: what % of words in b are not in a
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = b.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (wordsB.length === 0) return 0;
  const unique = wordsB.filter(w => !wordsA.has(w)).length;
  return Math.round((unique / wordsB.length) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║   VA Customer Context Impact Test                        ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.grey}  Target: ${BASE_URL}${c.reset}`);
  console.log(`${c.grey}  Triplets: ${TRIPLETS.length} (each = same job × 3 context levels)${c.reset}`);

  let token: string;
  section('Authentication');
  try {
    token = await getAuthToken();
    pass(`Logged in as ${ADMIN_EMAIL}`);
  } catch (e) {
    fail(`Auth failed: ${e}`);
    console.log(`\n${c.yellow}  ⚠ Start server with: npm run dev${c.reset}`);
    process.exit(1);
  }

  const allPassed: boolean[] = [];

  for (const triplet of TRIPLETS) {
    header(`\n╔══ ${triplet.name} ══`);
    info(triplet.description);

    const outputs: QuoteOutput[] = [];

    // Run all 3 variants
    for (const variant of triplet.variants) {
      const payload = {
        ...triplet.basePayload,
        ...(variant.vaContext !== undefined ? { vaContext: variant.vaContext } : {}),
      };

      try {
        const startMs = Date.now();
        const data = await createQuote(token, payload);
        const elapsed = Date.now() - startMs;
        const out = extractOutput(variant.label, data);
        outputs.push(out);
        info(`${variant.label} → ${out.totalFormatted} [${out.layoutTier}] in ${elapsed}ms`);
      } catch (e) {
        fail(`${variant.label} → ERROR: ${e}`);
        allPassed.push(false);
        continue;
      }
    }

    if (outputs.length < 3) {
      warn('Could not compare — one or more variants failed');
      allPassed.push(false);
      continue;
    }

    const [noCtx, thinCtx, richCtx] = outputs;

    // ── Side-by-side comparison table ─────────────────────────────────────────
    console.log('');
    console.log(`  ${c.bold}${''.padEnd(22)}  ${noCtx.label.padEnd(22)}  ${thinCtx.label.padEnd(22)}  ${richCtx.label}${c.reset}`);
    console.log(`  ${'─'.repeat(90)}`);

    const printRow = (label: string, ...vals: string[]) => {
      const cols = vals.map(v => (v || '—').substring(0, 30).padEnd(30));
      console.log(`  ${c.grey}${label.padEnd(22)}${c.reset}  ${cols.join('  ')}`);
    };

    printRow('Price', noCtx.totalFormatted, thinCtx.totalFormatted, richCtx.totalFormatted);
    printRow('Headline', noCtx.headline, thinCtx.headline, richCtx.headline);
    printRow('Layout tier', noCtx.layoutTier, thinCtx.layoutTier, richCtx.layoutTier);

    // WhatsApp first line
    const waLine1 = (out: QuoteOutput) => out.whatsappMessage.split('\n').filter(l => l.trim()).slice(1, 2).join('');
    printRow('WA line 1', waLine1(noCtx).substring(0, 30), waLine1(thinCtx).substring(0, 30), waLine1(richCtx).substring(0, 30));

    // Closing tone
    printRow('WA closing', noCtx.whatsappClosing.substring(0, 30), thinCtx.whatsappClosing.substring(0, 30), richCtx.whatsappClosing.substring(0, 30));

    console.log('');

    // ── Assertions ────────────────────────────────────────────────────────────
    let tripletPassed = true;

    section(`Assertions — ${triplet.name}`);

    // 1. All variants produce non-empty output
    for (const out of outputs) {
      const hasContent = out.headline.length > 0 && out.whatsappMessage.length > 0;
      if (hasContent) pass(`${out.label}: has headline and WhatsApp message`);
      else { fail(`${out.label}: missing headline or WhatsApp message`); tripletPassed = false; }
    }

    // 2. All WhatsApp messages start with "Hey"
    for (const out of outputs) {
      const ok = out.whatsappMessage.startsWith('Hey');
      if (ok) pass(`${out.label}: WhatsApp starts with "Hey"`);
      else { fail(`${out.label}: WhatsApp doesn't start with "Hey" — got: "${out.whatsappMessage.substring(0, 20)}"`); tripletPassed = false; }
    }

    // 3. Rich context produces different headline than no-context
    const headlineDiffers = richCtx.headline.toLowerCase() !== noCtx.headline.toLowerCase();
    if (headlineDiffers) pass(`Rich context changes headline: "${noCtx.headline}" → "${richCtx.headline}"`);
    else warn(`Headline unchanged between no-context and rich-context: "${richCtx.headline}" — LLM may not be using vaContext`);
    // Don't fail on this — headline may coincidentally match

    // 4. Rich context WhatsApp message has meaningful difference from no-context
    const msgDiff = textDifference(noCtx.whatsappMessage, richCtx.whatsappMessage);
    if (msgDiff >= 15) pass(`Rich context WA message is ${msgDiff}% different from no-context`);
    else { warn(`Rich context WA only ${msgDiff}% different — context may not be influencing message (threshold: 15%)`); }

    // 5. Expected keywords appear in rich context output
    const richVariant = triplet.variants[2];
    if (richVariant.expectedKeywords && richVariant.expectedKeywords.length > 0) {
      for (const kw of richVariant.expectedKeywords) {
        const found = containsKeyword(richCtx, kw);
        if (found) pass(`Rich context: expected keyword "${kw}" found in output`);
        else {
          warn(`Rich context: expected keyword "${kw}" NOT found — LLM may not be reading vaContext`);
          // Soft warning, not hard fail — LLM may paraphrase
        }
      }
    }

    // 6. Forbidden keywords do NOT appear in rich context output
    if (richVariant.forbiddenKeywords && richVariant.forbiddenKeywords.length > 0) {
      for (const kw of richVariant.forbiddenKeywords) {
        const found = containsKeyword(richCtx, kw);
        if (!found) pass(`Rich context: forbidden keyword "${kw}" correctly absent`);
        else { fail(`Rich context: forbidden keyword "${kw}" appeared — possible hallucination`); tripletPassed = false; }
      }
    }

    // 7. Pricing: rich context should not wildly diverge from no-context for same job/signals
    // (signals are identical — price should be within 50% of each other)
    const priceDelta = Math.abs(richCtx.totalPence - noCtx.totalPence);
    const priceRatio = noCtx.totalPence > 0 ? priceDelta / noCtx.totalPence : 0;
    if (priceRatio <= 0.5) pass(`Price within 50% across context levels (delta: £${(priceDelta / 100).toFixed(0)})`);
    else { warn(`Large price swing between context levels: ${noCtx.totalFormatted} → ${richCtx.totalFormatted} — check if vaContext is affecting price logic`); }

    // 8. Rich context output length > thin/no context (more personalised = more words)
    const richLength = richCtx.whatsappMessage.length;
    const noLength = noCtx.whatsappMessage.length;
    if (richLength >= noLength) pass(`Rich context message length (${richLength}) ≥ no-context (${noLength})`);
    else info(`Note: rich context message (${richLength} chars) shorter than no-context (${noLength}) — may still be fine if more precise`);

    // 9. Full WhatsApp message output for review
    console.log('');
    console.log(`  ${c.bold}WhatsApp messages side-by-side:${c.reset}`);
    for (const out of outputs) {
      console.log(`\n  ${c.cyan}${out.label}:${c.reset}`);
      for (const line of out.whatsappMessage.split('\n').slice(0, 8)) {
        console.log(`    ${c.grey}${line}${c.reset}`);
      }
    }

    allPassed.push(tripletPassed);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║   Context Impact Summary                                 ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════════╝${c.reset}\n`);

  TRIPLETS.forEach((t, i) => {
    const icon = allPassed[i] ? `${c.green}✓${c.reset}` : `${c.yellow}⚠${c.reset}`;
    console.log(`  ${icon} ${t.name}`);
  });

  const hardFails = allPassed.filter(p => !p).length;
  console.log('');
  if (hardFails === 0) {
    console.log(`${c.green}${c.bold}  All triplets passed hard checks ✓${c.reset}`);
    console.log(`${c.grey}  Review the side-by-side outputs above to confirm context is meaningfully changing the messaging${c.reset}`);
  } else {
    console.log(`${c.red}  ${hardFails} triplet(s) have hard failures — review above${c.reset}`);
  }
  console.log('');

  process.exit(hardFails > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
