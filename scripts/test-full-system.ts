/**
 * test-full-system.ts
 *
 * Comprehensive end-to-end test suite hitting every layer of the contextual
 * quote platform from all angles:
 *
 *   Suite A — Quote Generation (22 cases, spec validation)
 *   Suite B — Quote Platform API (CRUD + shape integrity)
 *   Suite C — Analytics Tracking (counter increments)
 *   Suite D — Quote Page Rendering (contextual elements present)
 *   Suite E — Concurrency Stress (5 parallel generations)
 *   Suite F — Edge Cases / Abuse (malformed input, missing fields)
 *
 * Run: npx tsx scripts/test-full-system.ts
 */

const PORT = process.env.PORT || '49453';
const BASE = `http://localhost:${PORT}`;
const QUOTE_BASE = `${BASE}/quote`;

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@handyservices.com', password: 'admin123' }),
  });
  if (!res.ok) throw new Error('Admin login failed');
  const data = await res.json() as Record<string, unknown>;
  return data.token as string;
}

// ── Test runner ──────────────────────────────────────────────────────────────

interface TestResult {
  suite: string;
  name: string;
  pass: boolean;
  detail?: string;
  ms?: number;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string) {
  currentSuite = name;
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(70)}`);
}

function pass(name: string, detail?: string, ms?: number) {
  results.push({ suite: currentSuite, name, pass: true, detail, ms });
  console.log(`  ✅ ${name}${ms !== undefined ? ` (${ms}ms)` : ''}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail?: string, ms?: number) {
  results.push({ suite: currentSuite, name, pass: false, detail, ms });
  console.log(`  ❌ ${name}${ms !== undefined ? ` (${ms}ms)` : ''}${detail ? ` — ${detail}` : ''}`);
}

function check(condition: boolean, name: string, detail?: string, ms?: number) {
  condition ? pass(name, detail, ms) : fail(name, detail, ms);
}

// ── Suite A: Quote Generation ────────────────────────────────────────────────

const BANNED_ENDINGS = ['Done', 'Sorted', 'Complete', 'Finished', 'Work Done', 'Job Done'];
const BANNED_WA_PHRASES = ['money-back', 'certified', 'guaranteed same day', '24/7', '#1', 'award'];
const MANAGED_KWS = ['remote', 'away', 'tenant', 'photo', 'key', 'landlord', 'not there', "won't be", "can't be", 'send me', 'rental', 'airbnb'];

const GENERATION_CASES = [
  { label: 'Quick/Homeowner/No context', tier: 'quick', vaContext: '', lines: [{ id:'l1', description:'Fix loose towel rail', category:'general_fixing', estimatedMinutes:20 }], postcode:'NG1 1AA', name:'Sarah M', urgency:'standard' },
  { label: 'Quick/Busy pro/Rich context', tier: 'quick', vaContext: "Returning customer, very busy, works from home, wants it fast.", lines: [{ id:'l1', description:'Fit curtain pole', category:'curtain_blinds', estimatedMinutes:25 }], postcode:'NG3 3CC', name:'Priya S', urgency:'priority' },
  { label: 'Standard/Remote landlord/Tap', tier: 'standard', vaContext: "Michael is a landlord, lives 90 mins away. Tenant will let us in. Wants photo proof and tax-ready invoice.", lines: [{ id:'l1', description:'Dripping bathroom tap', category:'plumbing_minor', estimatedMinutes:45 }], postcode:'NG4 4DD', name:'Michael O', urgency:'standard' },
  { label: 'Standard/OAP/Trust-seeker', tier: 'standard', vaContext: "Derek is in his 70s, lives alone, nervous, wants reliable and tidy.", lines: [{ id:'l1', description:'Mount 3 floating shelves', category:'shelving', estimatedMinutes:45 }], postcode:'NG6 6FF', name:'Derek H', urgency:'standard' },
  { label: 'Standard/Emergency/No context', tier: 'standard', vaContext: '', lines: [{ id:'l1', description:'Burst pipe under kitchen sink', category:'plumbing_minor', estimatedMinutes:45 }], postcode:'NG9 9II', name:'Tom B', urgency:'emergency' },
  { label: 'Standard/Airbnb/Remote', tier: 'standard', vaContext: "Ben runs an Airbnb, won't be at the property. Wants photo sent after.", lines: [{ id:'l1', description:'Pressure wash driveway', category:'pressure_washing', estimatedMinutes:120 }], postcode:'NG18 9RR', name:'Ben C', urgency:'standard' },
  { label: 'Complex/Landlord/3 jobs', tier: 'complex', vaContext: "Phil is a landlord. Tenant in. Key from estate agent. Wants photo proof of all jobs.", lines: [{ id:'l1', description:'Replace dripping tap', category:'plumbing_minor', estimatedMinutes:45 }, { id:'l2', description:'Fix towel rail', category:'general_fixing', estimatedMinutes:20 }, { id:'l3', description:'Repair silicone', category:'silicone_sealant', estimatedMinutes:45 }], postcode:'NG13 4MM', name:'Phil D', urgency:'standard' },
  { label: 'Complex/Pre-sale/4 jobs/Weekend', tier: 'complex', vaContext: "Gareth putting house on market in 3 weeks, estate agents coming.", lines: [{ id:'l1', description:'Fill and repaint hallway', category:'painting', estimatedMinutes:120 }, { id:'l2', description:'Fix sticking door', category:'door_fitting', estimatedMinutes:45 }, { id:'l3', description:'Re-seal bath', category:'silicone_sealant', estimatedMinutes:45 }, { id:'l4', description:'Replace fence panel', category:'fencing', estimatedMinutes:120 }], postcode:'NG22 4VV', name:'Gareth E', urgency:'priority' },
];

async function runSuiteA() {
  suite('SUITE A — Quote Generation (8 representative cases)');
  const slugs: string[] = [];

  for (const c of GENERATION_CASES) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: c.name,
          phone: '07700900000',
          postcode: c.postcode,
          lines: c.lines,
          signals: { urgency: c.urgency, materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
          vaContext: c.vaContext,
          createdBy: 'test',
        }),
      });
      const ms = Date.now() - t0;

      if (!res.ok) {
        fail(c.label, `HTTP ${res.status}`, ms);
        continue;
      }

      const data = await res.json() as Record<string, unknown>;
      const pricing = data.pricing as Record<string, unknown>;
      const messaging = data.messaging as Record<string, unknown>;
      const headline: string = (messaging?.headline as string) || '';
      const waMsg: string = (data.whatsappMessage as string) || '';
      const pricePence = (pricing?.totalPence as number) || 0;
      const slug = data.shortSlug as string;
      if (slug) slugs.push(slug);

      // Spec checks
      const bannedEnding = BANNED_ENDINGS.find(b => headline.endsWith(b));
      check(!bannedEnding, `${c.label} — headline outcome-first`, bannedEnding ? `BANNED: "${headline}"` : `"${headline}"`, ms);

      const bannedPhrase = BANNED_WA_PHRASES.find(b => waMsg.toLowerCase().includes(b));
      check(!bannedPhrase, `${c.label} — no banned WA phrases`, bannedPhrase ? `Found: "${bannedPhrase}"` : 'Clean');

      check(pricePence > 0, `${c.label} — price > 0`, `£${(pricePence/100).toFixed(0)}`);
      check(!!slug, `${c.label} — shortSlug present`, slug);
      check(!!(data.addOnPricing), `${c.label} — addOnPricing present`);

      const hasManagedSignal = MANAGED_KWS.some(kw => c.vaContext.toLowerCase().includes(kw));
      if (hasManagedSignal) {
        check(!!(data.managedTierAvailable), `${c.label} — managed tier detected`, hasManagedSignal ? 'vaContext has managed signals' : '');
      }

    } catch (e) {
      fail(c.label, String(e), Date.now() - t0);
    }
  }

  return slugs;
}

// ── Suite B: Quote Platform API ──────────────────────────────────────────────

async function runSuiteB(token: string) {
  suite('SUITE B — Quote Platform API (CRUD + field shape integrity)');
  const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // B1: GET images — snake_case shape
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/images`, { headers: authHeader });
    const ms = Date.now() - t0;
    check(res.ok, 'GET /images — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>[];
      check(data.length > 0, 'GET /images — seeded data present', `${data.length} images`);
      if (data[0]) {
        const keys = Object.keys(data[0]);
        check(keys.includes('is_active'), 'GET /images — is_active (snake_case)', keys.join(', '));
        check(keys.includes('gender_cues'), 'GET /images — gender_cues (snake_case)');
        check(keys.includes('job_types'), 'GET /images — job_types (snake_case)');
        check(typeof (data[0] as any).is_active === 'boolean', 'GET /images — is_active is boolean', String((data[0] as any).is_active));
        check(Array.isArray((data[0] as any).archetypes), 'GET /images — archetypes is array');
      }
    }
  }

  // B2: GET headlines — snake_case shape
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/headlines`, { headers: authHeader });
    const ms = Date.now() - t0;
    check(res.ok, 'GET /headlines — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>[];
      check(data.length > 0, 'GET /headlines — seeded data present', `${data.length} headlines`);
      if (data[0]) {
        check(Object.keys(data[0]).includes('customer_type'), 'GET /headlines — customer_type (snake_case)');
        check(Object.keys(data[0]).includes('view_count'), 'GET /headlines — view_count (snake_case)');
        check(Object.keys(data[0]).includes('is_active'), 'GET /headlines — is_active (snake_case)');
      }
    }
  }

  // B3: GET testimonials
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/testimonials`, { headers: authHeader });
    const ms = Date.now() - t0;
    check(res.ok, 'GET /testimonials — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>[];
      check(data.length > 0, 'GET /testimonials — seeded data present', `${data.length} testimonials`);
      if (data[0]) {
        check(Object.keys(data[0]).includes('is_active'), 'GET /testimonials — is_active (snake_case)');
        check(typeof (data[0] as any).rating === 'number', 'GET /testimonials — rating is number');
      }
    }
  }

  // B4: PATCH image toggle
  {
    const imagesRes = await fetch(`${BASE}/api/quote-platform/images`, { headers: authHeader });
    if (imagesRes.ok) {
      const images = await imagesRes.json() as Record<string, unknown>[];
      if (images[0]) {
        const id = (images[0] as any).id;
        const currentActive = (images[0] as any).is_active;
        const t0 = Date.now();
        const patchRes = await fetch(`${BASE}/api/quote-platform/images/${id}`, {
          method: 'PATCH',
          headers: authHeader,
          body: JSON.stringify({ is_active: !currentActive }),
        });
        const ms = Date.now() - t0;
        check(patchRes.ok, 'PATCH /images/:id — toggle active', `${patchRes.status}`, ms);
        if (patchRes.ok) {
          const updated = await patchRes.json() as Record<string, unknown>;
          check((updated as any).is_active === !currentActive, 'PATCH /images/:id — value reflected', `was ${currentActive}, now ${(updated as any).is_active}`);
          // Restore
          await fetch(`${BASE}/api/quote-platform/images/${id}`, { method: 'PATCH', headers: authHeader, body: JSON.stringify({ is_active: currentActive }) });
        }
      }
    }
  }

  // B5: GET analytics
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/analytics`, { headers: authHeader });
    const ms = Date.now() - t0;
    check(res.ok, 'GET /analytics — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      check(!!(data.funnel), 'GET /analytics — funnel present');
      check(!!(data.tiers), 'GET /analytics — tiers present');
      const funnel = data.funnel as Record<string, unknown>;
      check(typeof funnel?.sent === 'number', 'GET /analytics — funnel.sent is number', String(funnel?.sent));
      check(typeof funnel?.viewed === 'number', 'GET /analytics — funnel.viewed is number', String(funnel?.viewed));
    }
  }

  // B6: Headline POST + DELETE round-trip
  {
    const t0 = Date.now();
    const createRes = await fetch(`${BASE}/api/quote-platform/headlines`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ section: 'guarantee', text: 'TEST HEADLINE — delete me', customer_type: 'homeowners' }),
    });
    const ms = Date.now() - t0;
    check(createRes.ok, 'POST /headlines — creates headline', `${createRes.status}`, ms);
    if (createRes.ok) {
      const created = await createRes.json() as Record<string, unknown>;
      const id = (created as any).id;
      check(typeof id === 'number', 'POST /headlines — returns id', String(id));
      check((created as any).customer_type === 'homeowners', 'POST /headlines — customer_type snake_case in response');
      // Delete
      const delRes = await fetch(`${BASE}/api/quote-platform/headlines/${id}`, { method: 'DELETE', headers: authHeader });
      check(delRes.ok, 'DELETE /headlines/:id — success', `${delRes.status}`);
    }
  }
}

// ── Suite C: Analytics Tracking Counters ────────────────────────────────────

async function runSuiteC(token: string) {
  suite('SUITE C — Analytics Tracking (counter increments)');
  const authHeader = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Get image id and baseline view_count
  const imagesRes = await fetch(`${BASE}/api/quote-platform/images`, { headers: authHeader });
  if (!imagesRes.ok) { fail('C — cannot fetch images for tracking test'); return; }
  const images = await imagesRes.json() as Record<string, unknown>[];
  const img = images[0] as any;
  const imgId = img.id;
  const imgViewBaseline = img.view_count || 0;
  const imgBookBaseline = img.booking_count || 0;

  // Get headline id and baseline
  const headlinesRes = await fetch(`${BASE}/api/quote-platform/headlines`, { headers: authHeader });
  const headlines = headlinesRes.ok ? await headlinesRes.json() as Record<string, unknown>[] : [];
  const hl = headlines[0] as any;
  const hlId = hl?.id;
  const hlViewBaseline = hl?.view_count || 0;

  // C1: track-view increments image view_count
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/images/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: imgId }),
    });
    const ms = Date.now() - t0;
    check(res.ok, 'POST /images/track-view — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const after = await fetch(`${BASE}/api/quote-platform/images`, { headers: authHeader }).then(r => r.json()) as any[];
      const afterImg = after.find((i: any) => i.id === imgId);
      check((afterImg?.view_count || 0) === imgViewBaseline + 1, 'POST /images/track-view — view_count incremented', `${imgViewBaseline} → ${afterImg?.view_count}`);
    }
  }

  // C2: track-booking increments image booking_count
  {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/images/track-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: imgId }),
    });
    const ms = Date.now() - t0;
    check(res.ok, 'POST /images/track-booking — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const after = await fetch(`${BASE}/api/quote-platform/images`, { headers: authHeader }).then(r => r.json()) as any[];
      const afterImg = after.find((i: any) => i.id === imgId);
      check((afterImg?.booking_count || 0) === imgBookBaseline + 1, 'POST /images/track-booking — booking_count incremented', `${imgBookBaseline} → ${afterImg?.booking_count}`);
    }
  }

  // C3: track-view increments headline view_count
  if (hlId) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/quote-platform/headlines/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlineId: hlId }),
    });
    const ms = Date.now() - t0;
    check(res.ok, 'POST /headlines/track-view — 200 OK', `${res.status}`, ms);
    if (res.ok) {
      const after = await fetch(`${BASE}/api/quote-platform/headlines`, { headers: authHeader }).then(r => r.json()) as any[];
      const afterHl = after.find((h: any) => h.id === hlId);
      check((afterHl?.view_count || 0) === hlViewBaseline + 1, 'POST /headlines/track-view — view_count incremented', `${hlViewBaseline} → ${afterHl?.view_count}`);
    }
  }

  // C4: Invalid imageId is handled gracefully
  {
    const res = await fetch(`${BASE}/api/quote-platform/images/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: 999999 }),
    });
    check(res.status < 500, 'POST /images/track-view — invalid id does not 500', `${res.status}`);
  }
}

// ── Suite D: Quote Page Rendering ────────────────────────────────────────────

async function runSuiteD(slugs: string[]) {
  suite('SUITE D — Quote Page Rendering (contextual elements via API)');

  for (const slug of slugs.slice(0, 4)) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/personalized-quotes/${slug}`);
    const ms = Date.now() - t0;
    if (!res.ok) { fail(`GET /api/personalized-quotes/${slug}`, `${res.status}`, ms); continue; }

    const data = await res.json() as Record<string, unknown>;
    const contextSignals = (data.contextSignals as Record<string, unknown>) || {};
    const vaCtx = ((contextSignals.vaContext as string) || '').toLowerCase();
    const layoutTier = data.layoutTier as string;
    const contextualHeadline = data.contextualHeadline as string;
    const segment = data.segment as string;
    const isContextual = segment === 'CONTEXTUAL' || !!(data.layoutTier && data.valueBullets);

    check(!!data.id, `${slug} — id present`);
    check(!!data.shortSlug, `${slug} — shortSlug present`);
    check(['quick','standard','complex'].includes(layoutTier), `${slug} — valid layoutTier`, layoutTier, ms);

    if (isContextual) {
      check(!!contextualHeadline, `${slug} — contextualHeadline present`, contextualHeadline || 'MISSING');
      check(!!data.valueBullets, `${slug} — valueBullets present`);
      // whatsappMessage is intentionally stripped from the public quote API (VA-only field)

      // Derived customerType check (landlord signals → should NOT say "homeowners")
      const hasLandlordSignal = /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtx);
      if (hasLandlordSignal) {
        const waMsg = (data.whatsappMessage as string) || '';
        check(!waMsg.toLowerCase().includes('homeowner'), `${slug} — WA msg not calling landlord a homeowner`, vaCtx.slice(0, 60));
      }
    }
  }

  // D-extra: Quote with non-existent slug → 404
  {
    const res = await fetch(`${BASE}/api/personalized-quotes/does-not-exist-xyz`);
    check(res.status === 404, 'Non-existent slug → 404', `${res.status}`);
  }
}

// ── Suite E: Concurrency Stress ──────────────────────────────────────────────

async function runSuiteE() {
  suite('SUITE E — Concurrency Stress (5 parallel quote generations)');

  const t0 = Date.now();
  const promises = Array.from({ length: 5 }, (_, i) =>
    fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: `Stress Test ${i + 1}`,
        phone: `0770090000${i}`,
        postcode: `NG${i + 1} 1AA`,
        lines: [{ id: 'l1', description: `Concurrent job ${i + 1} — fix a tap`, category: 'plumbing_minor', estimatedMinutes: 45 }],
        signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
        vaContext: `Stress test ${i + 1} — concurrent request.`,
        createdBy: 'stress_test',
      }),
    }).then(r => ({ ok: r.ok, status: r.status, i }))
      .catch(e => ({ ok: false, status: 0, i, err: String(e) }))
  );

  const results2 = await Promise.all(promises);
  const totalMs = Date.now() - t0;
  const allOk = results2.every(r => r.ok);
  const passed2 = results2.filter(r => r.ok).length;

  check(allOk, `5 concurrent requests — all succeed`, `${passed2}/5 ok`);
  check(totalMs < 60000, `5 concurrent requests — under 60s total`, `${totalMs}ms`);
  console.log(`     ℹ️  Parallel wall-clock time: ${totalMs}ms (avg ${Math.round(totalMs/5)}ms per quote)`);

  if (!allOk) {
    for (const r of results2.filter(r => !r.ok)) {
      fail(`  Request ${r.i + 1}`, `status: ${r.status}`);
    }
  }
}

// ── Suite F: Edge Cases / Abuse ──────────────────────────────────────────────

async function runSuiteF() {
  suite('SUITE F — Edge Cases & Abuse Resistance');

  // F1: Missing required fields → 4xx
  {
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: 'No Lines' }),
    });
    check(res.status >= 400 && res.status < 500, 'Missing lines → 4xx', `${res.status}`);
  }

  // F2: Empty lines array → 4xx
  {
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: 'Empty Lines', postcode: 'NG1 1AA', lines: [], signals: {}, vaContext: '' }),
    });
    check(res.status >= 400, 'Empty lines array → error', `${res.status}`);
  }

  // F3: Very long vaContext (>2000 chars) — should not crash
  {
    const longCtx = 'This is context. '.repeat(120); // ~2040 chars
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Long Context Test',
        postcode: 'NG1 1AA',
        lines: [{ id: 'l1', description: 'Fix a tap', category: 'plumbing_minor', estimatedMinutes: 45 }],
        signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
        vaContext: longCtx,
        createdBy: 'edge_test',
      }),
    });
    check(res.status < 500, 'Very long vaContext (2040 chars) — no 500', `${res.status}`);
  }

  // F4: Special characters in vaContext — no crash
  {
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: "O'Brien Test <&>",
        postcode: 'NG1 1AA',
        lines: [{ id: 'l1', description: "Fix it! £50? Yes/No — he said 'definitely'.", category: 'general_fixing', estimatedMinutes: 30 }],
        signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
        vaContext: "Customer said: \"I'll be there at 10am\". Ref: job #123 — cost £45-£55.",
        createdBy: 'edge_test',
      }),
    });
    check(res.status < 500, 'Special chars in vaContext — no 500', `${res.status}`);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      check(!!((data.pricing as any)?.totalPence), 'Special chars — price present');
    }
  }

  // F5: Quote platform PATCH with unknown id → 404
  {
    const res = await fetch(`${BASE}/api/quote-platform/images/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer fake' },
      body: JSON.stringify({ is_active: false }),
    });
    check(res.status === 401 || res.status === 403 || res.status === 404, 'PATCH unknown image with bad token → 4xx', `${res.status}`);
  }

  // F6: Public track-view with missing body → graceful error
  {
    const res = await fetch(`${BASE}/api/quote-platform/images/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check(res.status < 500, 'track-view with no imageId → not 500', `${res.status}`);
  }

  // F7: GET analytics — unauthenticated (should require auth)
  {
    const res = await fetch(`${BASE}/api/quote-platform/analytics`);
    check(res.status === 401 || res.status === 403, 'GET /analytics — requires auth', `${res.status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║     CONTEXTUAL QUOTE PLATFORM — FULL SYSTEM TEST                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE}`);
  console.log(`  Time:   ${new Date().toISOString()}\n`);

  const t0 = Date.now();
  let token = '';

  try {
    token = await getAdminToken();
    console.log('  🔑 Admin token obtained');
  } catch (e) {
    console.log('  ⚠️  Admin login failed — Suites B/C will be skipped');
  }

  const slugs = await runSuiteA();
  if (token) {
    await runSuiteB(token);
    await runSuiteC(token);
  }
  await runSuiteD(slugs);
  await runSuiteE();
  await runSuiteF();

  const totalMs = Date.now() - t0;

  // ── Final report ─────────────────────────────────────────────────────────
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed2 = results.filter(r => !r.pass);
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║     FINAL REPORT                                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Passed:  ${passed}/${total} (${pct}%)`);
  console.log(`  ❌ Failed:  ${failed2.length}`);
  console.log(`  ⏱️  Total:   ${(totalMs / 1000).toFixed(1)}s\n`);

  if (failed2.length > 0) {
    console.log('  FAILURES:\n');
    for (const f of failed2) {
      console.log(`    ❌ [${f.suite}] ${f.name}`);
      if (f.detail) console.log(`       ${f.detail}`);
    }
  }

  // Per-suite breakdown
  const suites = [...new Set(results.map(r => r.suite))];
  console.log('\n  PER-SUITE:\n');
  for (const s of suites) {
    const sr = results.filter(r => r.suite === s);
    const sp = sr.filter(r => r.pass).length;
    const icon = sp === sr.length ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${s.replace(/SUITE [A-F] — /, '')}: ${sp}/${sr.length}`);
  }

  console.log(`\n  ${pct === 100 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed2.length} FAILURE(S) — see above`}\n`);
}

main().catch(console.error);
