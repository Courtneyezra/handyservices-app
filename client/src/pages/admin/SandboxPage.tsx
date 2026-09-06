/**
 * SandboxPage — the comms sandbox (/admin/sandbox, T5).
 *
 * Type as a customer on the left; watch the spine think on the right (LiveRunPanel over the
 * shared SSE stream, kept on screen after the run finishes); read the pass underneath: triage,
 * pack, the proposed reply, guards, decision, cost — and, loudest of all, what the exit WOULD
 * have done, because it did not do it.
 *
 * Nothing here can send. The thread lives on the reserved Ofcom drama number, every pass is a
 * dry run (server/spine/sandbox.ts explains the three layers), and this page never names a
 * conversation id to the server — every call is "the sandbox thread", whichever row that is.
 *
 * Data: GET/POST /api/comms-sandbox (server/spine/sandbox-routes.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, FlaskConical, Loader2, RotateCcw, Send, ShieldCheck, User } from 'lucide-react';
import { LiveRunPanel } from '@/components/comms/LiveRunPanel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- api shapes (server/spine/sandbox-routes.ts)

interface SandboxMessage { id: string; direction: 'inbound' | 'outbound' | string; content: string | null; createdAt: string | null; senderName: string | null }
interface SandboxQuote { id: string; slug: string; jobDescription: string; basePrice: number | null; expiresAt: string | null; createdAt: string | null; depositPaidAt: string | null; revokedAt: string | null }
interface SandboxRunRow { id: string; agent: string; decision: string | null; lane: string | null; costPence: number | null; model: string | null; durationMs: number | null; error: string | null; startedAt: string | null; sandbox: boolean; intent: string | null; bubbles: string[] }
export interface SandboxState {
    phone: { e164: string; wa: string };
    conversation: { id: string; stage: string | null; tags: string[]; contactName: string | null; createdAt: string | null; hasTrigger: boolean } | null;
    messages: SandboxMessage[];
    quote: SandboxQuote | null;
    runs: SandboxRunRow[];
}
export interface SandboxRun {
    runId: string;
    agent: string;
    pack: { id: string; version: number };
    triage: { lane: string; intent: string; exceptions: string[]; tags: string[]; reasons: string[]; source: string; model?: string | null };
    proposal: { intent: string; body: string[]; reasons: string[]; flag?: { exception: string; note: string } | null; tags?: string[]; artifact?: { kind: string; summary: string } | null } | null;
    guards: { ok: boolean; guardsHit: string[]; escalate: boolean; notes: string[] } | null;
    decision: { kind: string; approver?: string; reason?: string; exception?: string; dueAt?: string; note?: string };
    dryRun: boolean;
    sandbox: boolean;
    exitNote: string | null;
    skipped: string[];
    error: string | null;
    durationMs: number | null;
    costPence: number | null;
    model: string | null;
    caseFile: { stage: string; tags: string[]; quote: { slug: string; total?: number | null; paid: boolean } | null; window: { canFreeform: boolean; templateRequired: boolean } };
    benLaneClerk: { run: boolean; reason: string } | null;
    routeA: { ran: boolean; reason?: string } | null;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api/comms-sandbox${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    return body as T;
}

// ---------------------------------------------------------------- pure helpers (tested)

/** Pence → "£4.80" / "£480.00"; null when the row has no cost yet. */
export function pounds(pence: number | null | undefined): string | null {
    if (pence == null || !Number.isFinite(pence)) return null;
    return `£${(pence / 100).toFixed(2)}`;
}

/** The decision, in the words the page shows. `send` is the one that must never read softly. */
export function decisionLabel(d: SandboxRun['decision']): { text: string; tone: 'send' | 'draft' | 'flag' | 'quiet' } {
    switch (d.kind) {
        case 'send': return { text: `SEND — would go to the customer with no approval (${d.approver ?? 'agent'})`, tone: 'send' };
        case 'pending': return { text: `DRAFT for Ben — ${d.reason ?? ''}`.trim(), tone: 'draft' };
        case 'flag': return { text: `FLAG for Ben — ${d.exception ?? ''}`.trim(), tone: 'flag' };
        case 'drop': return { text: `DROP — ${d.reason ?? ''}`.trim(), tone: 'quiet' };
        case 'none': return { text: `NOTHING — ${d.reason ?? ''}`.trim(), tone: 'quiet' };
        default: return { text: d.kind, tone: 'quiet' };
    }
}

/**
 * The five known wrong-move shapes (PRD §5, the 7 reject-`wrong_move` verdicts). These are
 * CUSTOMER lines to throw at the desk, not reply templates: the assistant's words stay its own.
 * Four of the five only exist with a live unpaid quote on the thread — seed one first.
 */
export const WRONG_MOVE_SHAPES: { label: string; needsQuote: boolean; text: string }[] = [
    { label: 'Objects on price', needsQuote: true, text: "That's a lot more than I was expecting to be honest. Is there any movement on that?" },
    { label: 'Quote too expensive', needsQuote: true, text: 'Sorry, the quote is too expensive for us. We will have to leave it.' },
    { label: 'Wants a call before paying', needsQuote: true, text: "Before I pay anything I'd like to speak to someone about it. Can someone give me a ring?" },
    { label: 'Skirts a negotiation', needsQuote: true, text: 'Hmm. What would it come to if I did the painting myself and you just did the fan?' },
    { label: 'Demands a price', needsQuote: false, text: 'Just tell me how much it is going to cost. I need a number before I go any further.' },
];

const TONE_CLASSES: Record<ReturnType<typeof decisionLabel>['tone'], string> = {
    send: 'border-red-300 bg-red-50 text-red-900',
    draft: 'border-sky-200 bg-sky-50 text-sky-900',
    flag: 'border-violet-200 bg-violet-50 text-violet-900',
    quiet: 'border-slate-200 bg-slate-50 text-slate-800',
};

// ---------------------------------------------------------------- pieces

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="min-w-0 break-words">{children}</div>
        </div>
    );
}

function Chips({ items, empty = '—' }: { items: string[] | undefined | null; empty?: string }) {
    if (!items?.length) return <span className="text-muted-foreground">{empty}</span>;
    return (
        <span className="flex flex-wrap gap-1">
            {items.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{t}</span>)}
        </span>
    );
}

/** The whole pass, once it has come back. The exit line sits on top because it is the point. */
export function RunDetail({ run }: { run: SandboxRun }) {
    const d = decisionLabel(run.decision);
    return (
        <div className="space-y-4" data-testid="sandbox-run-detail">
            <div className={cn('rounded-lg border-2 border-dashed p-3', 'border-amber-400 bg-amber-50')} data-testid="sandbox-exit-note">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <ShieldCheck className="h-4 w-4" /> NOT SENT — dry run
                </div>
                <p className="mt-1 text-sm text-amber-900">{run.exitNote ?? 'DRY RUN — nothing sent.'}</p>
            </div>

            <div className={cn('rounded-lg border p-3 text-sm font-medium', TONE_CLASSES[d.tone])} data-testid="sandbox-decision">
                Decision: {d.text}
            </div>

            {run.proposal ? (
                <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">Proposed reply <span className="font-normal text-muted-foreground">(intent <span className="font-mono">{run.proposal.intent}</span>)</span></div>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">not sent</span>
                    </div>
                    {run.proposal.body.length ? (
                        <div className="space-y-1.5">
                            {run.proposal.body.map((b, i) => (
                                <div key={i} className="whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-dashed border-amber-300 bg-white px-3 py-2 text-sm">{b}</div>
                            ))}
                        </div>
                    ) : <div className="text-sm text-muted-foreground">No words — side effects only{run.proposal.flag ? ` (flag: ${run.proposal.flag.exception})` : ''}.</div>}
                    {run.proposal.reasons.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                            {run.proposal.reasons.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                    )}
                    {run.proposal.flag && <div className="mt-2 text-xs text-violet-800">Flag for Ben: {run.proposal.flag.exception} — {run.proposal.flag.note}</div>}
                    {run.proposal.artifact && <div className="mt-2 text-xs text-slate-600">Artifact: {run.proposal.artifact.kind} — {run.proposal.artifact.summary}</div>}
                </div>
            ) : (
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">No proposal: the agent chose to say nothing{run.error ? ` (it failed: ${run.error})` : ''}.</div>
            )}

            <div className="space-y-2 rounded-lg border p-3">
                <Field label="Triage">
                    lane <span className="font-mono">{run.triage.lane}</span>, intent <span className="font-mono">{run.triage.intent}</span>, by {run.triage.source}{run.triage.model ? ` (${run.triage.model})` : ''}
                </Field>
                <Field label="Exceptions"><Chips items={run.triage.exceptions} empty="none" /></Field>
                <Field label="Tags"><Chips items={[...run.caseFile.tags, ...run.triage.tags]} empty="none" /></Field>
                {run.triage.reasons.length > 0 && (
                    <Field label="Why">
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{run.triage.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </Field>
                )}
                <Field label="Pack">
                    <span className="font-mono">{run.pack.id} v{run.pack.version}</span> → agent <span className="font-mono">{run.agent}</span>
                    {run.benLaneClerk ? <span className="text-xs text-muted-foreground"> · Ben-lane clerk: {run.benLaneClerk.run ? 'prepared' : 'no'} ({run.benLaneClerk.reason})</span> : null}
                </Field>
                <Field label="Guards">
                    {run.guards
                        ? run.guards.ok
                            ? <span className="text-emerald-700">clear</span>
                            : <span className="text-red-700">{run.guards.guardsHit.join(', ')}{run.guards.escalate ? ' — escalates to Ben' : ''}{run.guards.notes.length ? ` · ${run.guards.notes.join('; ')}` : ''}</span>
                        : <span className="text-muted-foreground">not run (no proposal)</span>}
                </Field>
                <Field label="Quote seen">
                    {run.caseFile.quote ? <>{run.caseFile.quote.slug} · {run.caseFile.quote.paid ? 'paid' : 'unpaid'}{run.caseFile.quote.total != null ? ` · £${run.caseFile.quote.total}` : ''}</> : <span className="text-muted-foreground">none on the thread</span>}
                </Field>
                <Field label="Window">{run.caseFile.window.canFreeform ? 'open (freeform ok)' : 'shut (template required)'}</Field>
                <Field label="Cost">
                    {pounds(run.costPence) ?? <span className="text-muted-foreground">not recorded</span>}
                    {run.model ? <span className="text-xs text-muted-foreground"> · {run.model}</span> : null}
                    {run.durationMs != null ? <span className="text-xs text-muted-foreground"> · {(run.durationMs / 1000).toFixed(1)}s</span> : null}
                </Field>
                {run.skipped.length > 0 && (
                    <Field label="Skipped">
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{run.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </Field>
                )}
                {run.error && <Field label="Error"><span className="text-red-700">{run.error}</span></Field>}
                <Field label="Run id"><span className="font-mono text-xs">{run.runId}</span></Field>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- the page

export default function SandboxPage() {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const [amount, setAmount] = useState('480');
    const [lastRun, setLastRun] = useState<SandboxRun | null>(null);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    const state = useQuery<SandboxState>({
        queryKey: ['comms-sandbox'],
        queryFn: () => api<SandboxState>(''),
        refetchOnWindowFocus: false,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['comms-sandbox'] });

    const reset = useMutation({
        mutationFn: () => api<{ ok: true }>('/reset', { method: 'POST' }),
        onSuccess: () => { setLastRun(null); setError(null); refresh(); },
        onError: (e: Error) => setError(e.message),
    });
    const seedQuote = useMutation({
        mutationFn: () => api<{ ok: true }>('/quote', { method: 'POST', body: JSON.stringify({ totalPence: Math.round(Number(amount) * 100) }) }),
        onSuccess: () => { setError(null); refresh(); },
        onError: (e: Error) => setError(e.message),
    });
    const send = useMutation({
        mutationFn: (t: string) => api<{ ok: true; run: SandboxRun }>('/message', { method: 'POST', body: JSON.stringify({ text: t }) }),
        onMutate: () => { setError(null); setLastRun(null); },
        onSuccess: (r) => { setLastRun(r.run); setText(''); refresh(); },
        onError: (e: Error) => setError(e.message),
    });

    const conv = state.data?.conversation ?? null;
    const msgs = state.data?.messages ?? [];
    const quote = state.data?.quote ?? null;
    const busy = send.isPending || reset.isPending || seedQuote.isPending;
    const amountOk = Number.isFinite(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 20_000;

    useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, lastRun?.runId, send.isPending]);

    const submit = () => {
        const t = text.trim();
        if (!t || busy) return;
        send.mutate(t);
    };

    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold"><FlaskConical className="h-6 w-6 text-amber-600" /> Comms sandbox</h1>
                    <p className="text-sm text-muted-foreground">Type as a customer. Watch the desk triage, think, and propose. Nothing is ever sent.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={busy} data-testid="sandbox-reset">
                        {reset.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                        {conv ? 'Reset thread' : 'Start a clean thread'}
                    </Button>
                </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="sandbox-banner">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                    <span className="font-semibold">Dry run only.</span> This thread lives on the reserved test number <span className="font-mono">{state.data?.phone.e164 ?? '+447700900942'}</span> (no subscriber exists),
                    every pass skips the exit (the only sender), and no schedule can ever pick it up. Replies shown here would have gone out live — they did not.
                </div>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}

            <div className="grid gap-4 lg:grid-cols-2">
                {/* ---------------- left: the conversation */}
                <section className="flex min-h-[32rem] flex-col rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> {conv?.contactName ?? 'No thread yet'}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {conv && <span>stage <span className="font-mono">{conv.stage ?? 'enquiry'}</span></span>}
                            {quote && !quote.depositPaidAt && !quote.revokedAt && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">unpaid quote {quote.slug}{quote.basePrice != null ? ` · ${pounds(quote.basePrice)}` : ''}</span>}
                        </div>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3" data-testid="sandbox-thread">
                        {state.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
                        {!state.isLoading && !conv && (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                No sandbox thread yet. Press <span className="font-medium">Start a clean thread</span>, then type a message below as the customer would.
                            </div>
                        )}
                        {msgs.map((m) => {
                            const inbound = m.direction === 'inbound';
                            return (
                                <div key={m.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                                    <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm', inbound ? 'rounded-tl-sm bg-white' : 'rounded-tr-sm bg-emerald-100')}>
                                        {!inbound && <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">synthetic · never sent</div>}
                                        {m.content}
                                    </div>
                                </div>
                            );
                        })}
                        {send.isPending && (
                            <div className="flex justify-end">
                                <div className="flex items-center gap-2 rounded-2xl rounded-tr-sm border border-dashed border-amber-300 bg-white px-3 py-2 text-sm text-muted-foreground">
                                    <Bot className="h-4 w-4 text-blue-600" /><Loader2 className="h-3 w-3 animate-spin" /> the desk is thinking…
                                </div>
                            </div>
                        )}
                        {lastRun && (
                            <div className="flex justify-end" data-testid="sandbox-proposed-bubble">
                                <div className="max-w-[85%]">
                                    <div className="mb-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-amber-800">proposed reply · NOT SENT · dry run</div>
                                    {lastRun.proposal?.body.length
                                        ? lastRun.proposal.body.map((b, i) => (
                                            <div key={i} className="mb-1 whitespace-pre-wrap rounded-2xl rounded-tr-sm border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm">{b}</div>
                                        ))
                                        : <div className="rounded-2xl rounded-tr-sm border-2 border-dashed border-slate-300 bg-white px-3 py-2 text-sm italic text-muted-foreground">(no reply proposed — {decisionLabel(lastRun.decision).text})</div>}
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <div className="space-y-2 border-t p-3">
                        <div className="flex flex-wrap gap-1.5">
                            {WRONG_MOVE_SHAPES.map((s) => (
                                <button
                                    key={s.label}
                                    type="button"
                                    onClick={() => setText(s.text)}
                                    disabled={busy}
                                    title={s.needsQuote && !quote ? 'Seed an unpaid quote first — this shape only exists once a quote is out' : s.text}
                                    className={cn('rounded-full border px-2 py-0.5 text-xs hover:bg-slate-100', s.needsQuote && !quote ? 'border-dashed text-muted-foreground' : 'text-slate-700')}
                                >
                                    {s.label}{s.needsQuote ? ' 💷' : ''}
                                </button>
                            ))}
                        </div>
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                            placeholder={conv ? 'Type as the customer… (Enter to send, Shift+Enter for a new line)' : 'Start a clean thread first'}
                            rows={3}
                            disabled={!conv || busy}
                            data-testid="sandbox-input"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1 text-xs">
                                <span className="text-muted-foreground">Seed an unpaid quote for £</span>
                                <input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    inputMode="decimal"
                                    className="w-16 rounded border px-1.5 py-0.5 text-xs"
                                    aria-label="quote amount in pounds"
                                />
                                <Button variant="outline" size="sm" onClick={() => seedQuote.mutate()} disabled={!conv || busy || !amountOk} data-testid="sandbox-seed-quote">
                                    {seedQuote.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Seed quote
                                </Button>
                            </div>
                            <Button onClick={submit} disabled={!conv || busy || !text.trim()} data-testid="sandbox-send">
                                {send.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                                Send as customer
                            </Button>
                        </div>
                    </div>
                </section>

                {/* ---------------- right: the desk thinking */}
                <section className="space-y-4">
                    <div className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-blue-600" /> Live: what the desk is doing</div>
                        {conv ? (
                            <>
                                <LiveRunPanel conversationId={conv.id} keepFinished />
                                {!send.isPending && !lastRun && <div className="text-sm text-muted-foreground">Send a message and the pass appears here step by step: case file, triage, pack, each tool the Scoper calls, the proposal, guards, decision, exit.</div>}
                            </>
                        ) : <div className="text-sm text-muted-foreground">Start a thread to watch runs.</div>}
                    </div>

                    {lastRun
                        ? <RunDetail run={lastRun} />
                        : (
                            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                The last pass's detail lands here: the exit line (what would have happened), decision, proposed reply, triage, pack, guards and cost.
                            </div>
                        )}

                    {(state.data?.runs.length ?? 0) > 0 && (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 text-sm font-medium">Earlier passes on this thread</div>
                            <ul className="divide-y text-xs">
                                {state.data!.runs.map((r) => (
                                    <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                                        <span className="font-mono text-muted-foreground">{r.startedAt ? new Date(r.startedAt).toLocaleTimeString('en-GB') : ''}</span>
                                        <span className="font-mono">{r.lane ?? '—'}</span>
                                        <span>→ <span className="font-medium">{r.decision ?? '—'}</span>{r.intent ? ` (${r.intent})` : ''}</span>
                                        <span className="text-muted-foreground">{pounds(r.costPence) ?? 'no cost'}</span>
                                        {!r.sandbox && <span className="rounded bg-red-100 px-1 text-red-800">not marked sandbox</span>}
                                        {r.error && <span className="text-red-700">{r.error}</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
