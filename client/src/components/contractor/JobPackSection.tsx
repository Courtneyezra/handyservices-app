/**
 * The job pack on the contractor's page (P13 part 3): what a contractor at the door needs, carried
 * unchanged from the clerk, the estimator, Ben and the customer.
 *
 *   <JobPackTask>          per task: the customer's words, the photo for THAT task, procedure,
 *                          assumptions, exclusions, sizes / spec / supply-by, materials with where
 *                          to buy, hazards, disposal, lead time
 *   <JobPackJob>           per job: access, who is on site, parking, pets, prep, delivery, water /
 *                          power, what done looks like. Codes and contact unlock on accept.
 *   <ChangedSinceStrip>    "Changed since you accepted", from the pack's change log
 *   <PackChip>             "Pack complete" / "N missing" for lists
 *
 * Pure rendering; the pages fetch. Shapes mirror server/spine/job-pack-readers.ts.
 */
import { AlertTriangle, KeyRound, Lock, User, Car, PawPrint, Boxes, Truck, Plug, CheckCircle2, Quote as QuoteIcon, ImageIcon, ListChecks, Ban } from 'lucide-react';

export interface PackTaskView {
    lineId: string;
    customerWords: string[];
    mediaUrls: string[];
    procedure: string[];
    assumptions: string[];
    exclusions: string[];
    sizes: string | null;
    spec: string | null;
    supplyBy: string | null;
    materials: Array<{ name: string; qty: number; supplier: string | null; sku: string | null; size: string | null; unitPricePence: number | null }>;
    hazards: string[];
    disposal: string | null;
    leadTime: string | null;
    minutes: { low: number | null; point: number | null; high: number | null };
}

export interface PackJobView {
    accessMethod: string | null;
    accessCodes: string | null;
    onSiteContact: { name: string | null; phone: string | null; role: string | null } | null;
    locked: boolean;
    floor: number | null;
    hasLift: boolean | null;
    parkingDistance: string | null;
    parkingPermit: string | null;
    occupied: boolean | null;
    pets: string | null;
    prep: string | null;
    utilities: string | null;
    deliverySlot: string | null;
    doneLooksLike: string | null;
    accessNotes: string[];
}

export interface ContractorPackView {
    quoteId: string;
    tasks: PackTaskView[];
    job: PackJobView;
    changes: Array<{ at: string; field: string; label: string; to: unknown }>;
    missing: string[];
    missingLabels: string[];
    lockedAt: string | null;
    updatedAt: string;
}

export const PARKING_LABEL: Record<string, string> = {
    on_drive: 'On the drive', street_outside: 'On the street outside', street_within_50m: 'On the street, a short walk', '50m_plus': 'A walk away (car park or further)',
};

export const SUPPLIER_LABEL: Record<string, string> = { screwfix: 'Screwfix', catalog: 'Our stock', web: 'Online', model: 'Any merchant', manual: 'Any merchant' };

export function supplyLine(supplyBy: string | null): string | null {
    if (supplyBy === 'us') return 'We supply the materials';
    if (supplyBy === 'customer') return 'Customer supplies the materials';
    if (supplyBy === 'none') return 'Labour only';
    return null;
}

export function valueText(v: unknown): string {
    if (v == null || v === '') return 'cleared';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return PARKING_LABEL[v] ?? v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? (x as any).name ?? JSON.stringify(x) : String(x))).join(', ');
    if (typeof v === 'object') { const o = v as any; return [o.name, o.phone, o.role].filter(Boolean).join(' · ') || JSON.stringify(v); }
    return String(v);
}

function whenText(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Row({ icon: Icon, label, children, testId }: { icon: any; label: string; children: React.ReactNode; testId?: string }) {
    return (
        <div className="flex items-start gap-2.5 py-2" data-testid={testId}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#5C6470]" />
            <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5C6470]">{label}</div>
                <div className="text-[14px] leading-snug text-[#0E1116]">{children}</div>
            </div>
        </div>
    );
}

function Unknown({ what }: { what: string }) {
    return <span className="text-[#9AA3AE] italic" data-testid={`unknown-${what}`}>not yet known</span>;
}

// ---------------------------------------------------------------- per task

export function JobPackTask({ task, onPhoto }: { task: PackTaskView; onPhoto?: (url: string) => void }) {
    const supply = supplyLine(task.supplyBy);
    return (
        <div className="mt-3 rounded-xl border border-[#E6E8EC] bg-[#FAFAF8] p-3" data-testid={`pack-task-${task.lineId}`}>
            {task.customerWords.length > 0 && (
                <div className="space-y-1.5" data-testid={`pack-words-${task.lineId}`}>
                    {task.customerWords.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-[13px] italic leading-snug text-[#0E1116]">
                            <QuoteIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9AA3AE]" /><span>“{w}”</span>
                        </div>
                    ))}
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9AA3AE]">The customer's words</div>
                </div>
            )}
            {task.mediaUrls.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto" data-testid={`pack-photos-${task.lineId}`}>
                    {task.mediaUrls.map((u, i) => (
                        <button key={i} type="button" onClick={() => onPhoto?.(u)} className="shrink-0" aria-label="Photo for this task">
                            {/\.(mp4|mov|webm)(\?|$)/i.test(u) ? <video src={u} className="h-20 w-20 rounded-lg bg-black object-cover" preload="metadata" /> : <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" loading="lazy" />}
                        </button>
                    ))}
                </div>
            )}
            {(task.sizes || task.spec || supply || task.leadTime) && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold" data-testid={`pack-spec-${task.lineId}`}>
                    {task.sizes && <span className="rounded-md bg-white px-2 py-0.5 text-[#0E1116] ring-1 ring-[#E6E8EC]">Sizes: {task.sizes}</span>}
                    {task.spec && <span className="rounded-md bg-white px-2 py-0.5 text-[#0E1116] ring-1 ring-[#E6E8EC]">Spec: {task.spec}</span>}
                    {supply && <span className="rounded-md bg-white px-2 py-0.5 text-[#0E1116] ring-1 ring-[#E6E8EC]">{supply}</span>}
                    {task.leadTime && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200">Lead time: {task.leadTime}</span>}
                </div>
            )}
            {task.procedure.length > 0 && (
                <div className="mt-2" data-testid={`pack-procedure-${task.lineId}`}>
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5C6470]"><ListChecks className="h-3.5 w-3.5" /> How</div>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] leading-snug text-[#0E1116]">{task.procedure.map((s, i) => <li key={i}>{s}</li>)}</ol>
                </div>
            )}
            {task.assumptions.length > 0 && (
                <div className="mt-2" data-testid={`pack-assumptions-${task.lineId}`}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5C6470]">Priced on the basis that</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-snug text-[#0E1116]">{task.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
            )}
            {task.exclusions.length > 0 && (
                <div className="mt-2" data-testid={`pack-exclusions-${task.lineId}`}>
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9C2F2F]"><Ban className="h-3.5 w-3.5" /> Not included</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-snug text-[#0E1116]">{task.exclusions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
            )}
            {task.materials.length > 0 && (
                <div className="mt-2" data-testid={`pack-materials-${task.lineId}`}>
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5C6470]"><Boxes className="h-3.5 w-3.5" /> Bring / buy</div>
                    <ul className="mt-1 divide-y divide-[#E6E8EC] rounded-lg bg-white ring-1 ring-[#E6E8EC]">
                        {task.materials.map((m, i) => (
                            <li key={i} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px]">
                                <span className="min-w-0 truncate text-[#0E1116]">{m.qty > 1 ? `${m.qty}× ` : ''}{m.name}{m.size ? <span className="text-[#5C6470]"> · {m.size}</span> : null}</span>
                                <span className="shrink-0 text-[11px] font-semibold text-[#5C6470]">{SUPPLIER_LABEL[m.supplier ?? ''] ?? m.supplier ?? 'Any merchant'}{m.sku ? ` · ${m.sku}` : ''}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {(task.hazards.length > 0 || task.disposal) && (
                <div className="mt-2 flex flex-col gap-1" data-testid={`pack-hazards-${task.lineId}`}>
                    {task.hazards.length > 0 && <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Watch for: {task.hazards.join(', ')}</span></div>}
                    {task.disposal && <div className="text-[12px] text-[#5C6470]">Waste: {task.disposal}</div>}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- per job

export function JobPackJob({ job, missingLabels }: { job: PackJobView; missingLabels?: string[] }) {
    const contact = job.onSiteContact;
    return (
        <div className="rounded-2xl border border-[#E6E8EC] bg-white px-4 py-1 divide-y divide-[#E6E8EC]" data-testid="pack-job">
            <Row icon={KeyRound} label="Getting in" testId="pack-access">
                {job.accessMethod ?? <Unknown what="access" />}
                {job.locked ? <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#5C6470]"><Lock className="h-3 w-3" /> Codes and the contact unlock on accept</div>
                    : job.accessCodes ? <div className="mt-0.5 font-mono text-[13px]" data-testid="pack-codes">{job.accessCodes}</div> : null}
                {job.accessNotes.length > 0 && <div className="mt-0.5 text-[12px] text-[#5C6470]">{job.accessNotes.join(' · ')}</div>}
            </Row>
            <Row icon={User} label="Who is on site" testId="pack-contact">
                {job.locked ? <span className="text-[#9AA3AE] italic">unlocks on accept</span>
                    : contact ? <span>{[contact.name, contact.role].filter(Boolean).join(' · ')}{contact.phone ? <> · <a href={`tel:${contact.phone}`} className="font-semibold underline">{contact.phone}</a></> : null}</span>
                        : <Unknown what="contact" />}
                {job.occupied != null && <div className="mt-0.5 text-[12px] text-[#5C6470]">{job.occupied ? 'Property occupied' : 'Property empty'}</div>}
            </Row>
            <Row icon={Car} label="Parking" testId="pack-parking">
                {job.parkingDistance ? (PARKING_LABEL[job.parkingDistance] ?? job.parkingDistance) : <Unknown what="parking" />}
                {job.parkingPermit && <div className="mt-0.5 text-[12px] text-[#5C6470]">{job.parkingPermit}</div>}
                {(job.floor != null || job.hasLift != null) && <div className="mt-0.5 text-[12px] text-[#5C6470]">{job.floor != null ? (job.floor === 0 ? 'Ground floor' : `Floor ${job.floor}`) : ''}{job.hasLift != null ? `${job.floor != null ? ' · ' : ''}${job.hasLift ? 'lift' : 'no lift'}` : ''}</div>}
            </Row>
            <Row icon={PawPrint} label="Pets" testId="pack-pets">{job.pets ?? <Unknown what="pets" />}</Row>
            <Row icon={Boxes} label="Prepared before you arrive" testId="pack-prep">{job.prep ?? <Unknown what="prep" />}</Row>
            <Row icon={Truck} label="Delivery" testId="pack-delivery">{job.deliverySlot ?? <Unknown what="delivery" />}</Row>
            {job.utilities && <Row icon={Plug} label="Water / power" testId="pack-utilities">{job.utilities}</Row>}
            {job.doneLooksLike && <Row icon={CheckCircle2} label="Done looks like" testId="pack-done">{job.doneLooksLike}</Row>}
            {missingLabels && missingLabels.length > 0 && (
                <div className="py-2 text-[12px] text-[#5C6470]" data-testid="pack-missing">Still being confirmed: {missingLabels.join('; ')}.</div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- changed since you accepted

export function ChangedSinceStrip({ changes }: { changes: ContractorPackView['changes'] }) {
    if (!changes.length) return null;
    return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3" data-testid="pack-changed">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Changed since you accepted</div>
            <ul className="mt-1.5 space-y-1 text-[13px] text-amber-950">
                {changes.map((c, i) => (
                    <li key={i} data-testid={`pack-change-${i}`}><span className="font-semibold">{c.label}</span>: {valueText(c.to)} <span className="text-[11px] text-amber-800">· {whenText(c.at)}</span></li>
                ))}
            </ul>
        </div>
    );
}

// ---------------------------------------------------------------- chip

export function PackChip({ pack }: { pack: { complete: boolean; missing: number; label: string } | null | undefined }) {
    if (!pack) return null;
    return (
        <span className={pack.complete ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800' : 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900'} data-testid="pack-chip">
            {pack.complete ? <CheckCircle2 className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}{pack.label}
        </span>
    );
}
