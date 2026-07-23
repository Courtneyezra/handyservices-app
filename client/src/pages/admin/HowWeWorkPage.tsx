/**
 * /admin/how-we-work — the operating model, visible inside Handy OS.
 *
 * Internal reference: the job pipeline, the two contractor lanes, the pay
 * stack, the locked decisions and the standing warnings. Content mirrors
 * docs/OPERATING_MODEL_2026-07.md (the canonical source) — update both
 * together when a decision changes.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDown, Workflow, Users, PoundSterling, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Link } from 'wouter';

const PIPELINE = [
  { step: 'We market', detail: 'Demand engine: ads, SEO, WhatsApp — leads land with us, never with a contractor brand.' },
  { step: 'We quote', detail: 'AI contextual engine prices every line. Quote goes out in the HANDY skin featuring the assigned contractor/team (face + name — never their brand or number).' },
  { step: 'Customer accepts + pays deposit', detail: 'Customer contracts with Handy as PRINCIPAL. Our price, our guarantee, our complaints line.' },
  { step: 'Offer matched to availability', detail: 'Job (or routed bundle) offered against contractor-supplied live availability. Buffered calendar: customers only ever pick days we can honour.' },
  { step: 'Contractor delivers', detail: 'Their tools, their methods, our job standard. Materials on our trade card within the quoted budget. Plant/access hire agreed per job before lock.' },
  { step: 'Photo sign-off', detail: 'Before/after photos against the checklist. Completion stamps automatically (paid invoice or passed date backstop).' },
  { step: 'Customer pays balance', detail: 'Pay-by-link at sign-off — balance due on completion, not 14-day terms.' },
  { step: 'Contractor paid next day', detail: 'Bank transfer. Launch bonus line applies if active. Staged pay + ~10% retention (7 days) on big team blocks.' },
];

export default function HowWeWorkPage() {
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">How we work</h1>
        <p className="text-sm text-muted-foreground">
          The operating model, locked 22 Jul 2026. Canonical source: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">docs/OPERATING_MODEL_2026-07.md</code>
        </p>
      </div>

      {/* The pipeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Workflow className="w-4 h-4 text-handy-yellow" /> A job, end to end
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {PIPELINE.map((p, i) => (
              <li key={p.step}>
                <div className="flex gap-3">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-handy-navy text-white text-xs font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
                  <div className="pb-1">
                    <p className="font-bold text-sm">{p.step}</p>
                    <p className="text-sm text-muted-foreground leading-snug">{p.detail}</p>
                  </div>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div className="ml-3 my-1 text-muted-foreground/40"><ArrowDown className="w-3.5 h-3.5" /></div>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Two lanes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-handy-yellow" /> The two contractor lanes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4">
            <p className="font-extrabold">Pool <span className="text-xs font-bold text-muted-foreground">(self-employed, the default)</span></p>
            <ul className="mt-2 text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
              <li><span className="font-semibold text-foreground">Free accept/decline, always.</span> Never pressure someone to take a job "because you said you were free" — that habit converts the pool into workers.</li>
              <li>Declines have <em>market</em> consequences only: window-honouring is self-scored and drives priority + ladder position.</li>
              <li>Own tools, own insurance, genuine substitution, invoices us per job.</li>
            </ul>
          </div>
          <div className="rounded-xl border p-4">
            <p className="font-extrabold">Core <span className="text-xs font-bold text-muted-foreground">(the must-take lane)</span></p>
            <ul className="mt-2 text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>Binding scheduling <span className="font-semibold text-foreground">only in exchange for guaranteed money</span>, papered as committed-capacity or PAYE.</li>
              <li>Contractors graduate INTO this lane after proving out in the pool. It is never the default.</li>
              <li>Site-lead duties (running crews, quality) live here — with the 15% lead uplift.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Pay stack */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PoundSterling className="w-4 h-4 text-handy-yellow" /> The pay stack (per job, fixed before accept)
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p className="font-mono text-[13px] bg-muted rounded-lg px-3 py-2">
            pay = MAX( share% × labour, floor £/hr × est hours, per-visit minimum )
          </p>
          <ul className="text-muted-foreground space-y-1.5 list-disc pl-5">
            <li><span className="font-semibold text-foreground">Tiers:</span> Specialist 55% / £28 / £60 · Skilled 50% / £22 / £50 · General 45% / £18 / £40 · Outdoor 45% / £16 / £40 (share / hourly floor / visit min)</li>
            <li><span className="font-semibold text-foreground">Launch bonus:</span> +10% first 10 jobs — separate expiring line, never blended into base.</li>
            <li><span className="font-semibold text-foreground">Lead uplift:</span> +15% for running a multi-person managed job.</li>
            <li><span className="font-semibold text-foreground">Escalation:</span> unclaimed jobs bump +5% every 48h (max 3, margin-guarded) — watch it on <Link href="/admin/pricing-loop" className="underline font-semibold">Pricing Loop</Link>.</li>
            <li><span className="font-semibold text-foreground">Overrun valve:</span> verified actual &gt; 1.5× estimate re-rates the floor on actuals.</li>
            <li><span className="font-semibold text-foreground">Materials:</span> our card, raw-cost budget shown to the contractor — markup is ours, never their spend.</li>
          </ul>
        </CardContent>
      </Card>

      {/* Locked decisions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-handy-yellow" /> Locked decisions (change deliberately, not by drift)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal pl-5">
            <li>Quote skin = <span className="font-semibold text-foreground">Handy brand + contractor's face</span> — never their brand or phone number.</li>
            <li><span className="font-semibold text-foreground">Handy is principal</span> — customer pays us, we guarantee, VAT on the full invoice (registration status: accountant check URGENT).</li>
            <li><span className="font-semibold text-foreground">Two-lane allocation</span> — pool free-decline; must-take only in papered Core.</li>
            <li><span className="font-semibold text-foreground">Buffered calendar</span> — pickable days are honourable days.</li>
            <li><span className="font-semibold text-foreground">Supply capped to demand</span> — max 2–3 solos + 1 team until sold volume grows.</li>
            <li><span className="font-semibold text-foreground">Balance due on completion</span> — pay-by-link at photo sign-off.</li>
            <li><span className="font-semibold text-foreground">Team blocks: staged pay + ~10% retention</span> (7 days post-completion).</li>
          </ol>
        </CardContent>
      </Card>

      {/* Standing warnings */}
      <Card className="border-amber-500/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> What breaks this model
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>Letting decline-freedom erode into obligation — converts the pool into workers (Pimlico).</li>
            <li>Contractor brands or phone numbers on customer surfaces — converts the moat into lead-gen.</li>
            <li>Silent pay cuts instead of expiring bonuses — converts recruiting into Aspect (2.5★).</li>
            <li>Auto-optimising prices/pay without human veto — same.</li>
            <li>Onboarding faster than sold work grows — breaks the "we fill your days" promise that recruits everyone.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
