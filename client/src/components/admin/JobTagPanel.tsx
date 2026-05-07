// client/src/components/admin/JobTagPanel.tsx
//
// Module 02 — Job Tagging at Quote Creation.
//
// Compact admin panel that captures the routing-decisive tags on a quote:
//   - crew_size_required (1 / 2 / 3 / 4)
//   - skills_required (free-form chip list)
//   - cert_required (Gas Safe / Part P / Structural / Asbestos)
//   - duration_estimate_minutes (pricing time, ADR-005)
//   - real_work_minutes  (ops time, ADR-005)  — must be <= pricing time
//   - complexity_flags  (multi-select chip cloud)
//   - heavy_lifting     (denormalised boolean, mirrors complexity flag)
//   - customer_flexibility (rigid / flexible / very_flexible)
//
// The panel is gated by FF_JOB_TAGGING — caller is responsible for not
// rendering it when the flag is OFF. Save POSTs to the Module 02 endpoint:
//   PUT /api/admin/quotes/:id/tags
//
// Brand styling per Module 13: navy header, yellow accent on active chip,
// rounded cards. We deliberately avoid the lib/posthog import — keep the
// panel side-effect-free so the integration tests can render it cheaply.
//
// Refs: docs/architecture/modules/02-job-tagging.md, ADR-005

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Tag, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — kept in sync with server/routes/admin-tagging-routes.ts
// ---------------------------------------------------------------------------

export type CertSlug = 'gas_safe' | 'part_p' | 'structural' | 'asbestos';
export type ComplexityFlag =
    | 'heavy_lifting'
    | 'awkward_access'
    | 'parking_difficult'
    | 'older_property'
    | 'unknowns'
    | 'hazardous';
export type CustomerFlexibility = 'rigid' | 'flexible' | 'very_flexible';

export interface JobTagValues {
    crew_size_required: 1 | 2 | 3 | 4;
    skills_required: string[];
    cert_required: CertSlug[];
    duration_estimate_minutes: number;
    real_work_minutes: number;
    complexity_flags: ComplexityFlag[];
    heavy_lifting: boolean;
    customer_flexibility: CustomerFlexibility;
}

interface Props {
    quoteId: string;
    initial?: Partial<JobTagValues>;
    onSaved?: (values: JobTagValues) => void;
    /** Skills suggested from the quote's line-item categories. */
    suggestedSkills?: string[];
}

// ---------------------------------------------------------------------------
// Static option metadata
// ---------------------------------------------------------------------------

const CERT_OPTIONS: { value: CertSlug; label: string }[] = [
    { value: 'gas_safe',   label: 'Gas Safe' },
    { value: 'part_p',     label: 'Part P (electrical)' },
    { value: 'structural', label: 'Structural' },
    { value: 'asbestos',   label: 'Asbestos' },
];

const COMPLEXITY_OPTIONS: { value: ComplexityFlag; label: string }[] = [
    { value: 'heavy_lifting',     label: 'Heavy lifting' },
    { value: 'awkward_access',    label: 'Awkward access' },
    { value: 'parking_difficult', label: 'Parking difficult' },
    { value: 'older_property',    label: 'Older property' },
    { value: 'unknowns',          label: 'Unknowns' },
    { value: 'hazardous',         label: 'Hazardous' },
];

const FLEX_OPTIONS: { value: CustomerFlexibility; label: string; sub: string }[] = [
    { value: 'rigid',         label: 'Rigid',         sub: 'fixed date / time' },
    { value: 'flexible',      label: 'Flexible',      sub: 'within a few days' },
    { value: 'very_flexible', label: 'Very flexible', sub: 'whenever' },
];

const DEFAULT_VALUES: JobTagValues = {
    crew_size_required: 1,
    skills_required: [],
    cert_required: [],
    duration_estimate_minutes: 60,
    real_work_minutes: 30,
    complexity_flags: [],
    heavy_lifting: false,
    customer_flexibility: 'flexible',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JobTagPanel({ quoteId, initial, onSaved, suggestedSkills }: Props) {
    const { toast } = useToast();

    const [values, setValues] = useState<JobTagValues>(() => ({
        ...DEFAULT_VALUES,
        ...(initial ?? {}),
        skills_required: initial?.skills_required ?? suggestedSkills ?? [],
    }));
    const [skillInput, setSkillInput] = useState('');
    const [saving, setSaving] = useState(false);

    const validationError = useMemo(() => validate(values), [values]);
    const canSave = !validationError && !saving;

    function update<K extends keyof JobTagValues>(key: K, val: JobTagValues[K]) {
        setValues((v) => ({ ...v, [key]: val }));
    }

    function toggleCert(cert: CertSlug) {
        setValues((v) => ({
            ...v,
            cert_required: v.cert_required.includes(cert)
                ? v.cert_required.filter((c) => c !== cert)
                : [...v.cert_required, cert],
        }));
    }

    function toggleComplexity(flag: ComplexityFlag) {
        setValues((v) => {
            const has = v.complexity_flags.includes(flag);
            const next = has
                ? v.complexity_flags.filter((f) => f !== flag)
                : [...v.complexity_flags, flag];
            // Keep heavy_lifting denormalised boolean in sync with the chip.
            return {
                ...v,
                complexity_flags: next,
                heavy_lifting: flag === 'heavy_lifting' ? !has : v.heavy_lifting,
            };
        });
    }

    function addSkill() {
        const t = skillInput.trim();
        if (!t) return;
        setValues((v) =>
            v.skills_required.includes(t)
                ? v
                : { ...v, skills_required: [...v.skills_required, t] },
        );
        setSkillInput('');
    }

    function removeSkill(skill: string) {
        setValues((v) => ({
            ...v,
            skills_required: v.skills_required.filter((s) => s !== skill),
        }));
    }

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        try {
            const token = localStorage.getItem('adminToken');
            const res = await fetch(`/api/admin/quotes/${quoteId}/tags`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(values),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Save failed (${res.status})`);
            }
            toast({
                title: 'Tags saved',
                description: 'Job profile updated for routing.',
            });
            onSaved?.(values);
        } catch (e) {
            toast({
                title: 'Save failed',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card className="border border-amber-500/30 bg-slate-950 text-slate-100">
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-400">
                    <Tag className="w-4 h-4" />
                    Job Tags (routing inputs)
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {/* Crew size */}
                <section>
                    <Label className="text-xs uppercase tracking-wide text-slate-400">
                        Crew size required
                    </Label>
                    <RadioGroup
                        value={String(values.crew_size_required)}
                        onValueChange={(v) =>
                            update('crew_size_required', Number(v) as 1 | 2 | 3 | 4)
                        }
                        className="flex gap-3 mt-2"
                    >
                        {[1, 2, 3, 4].map((n) => (
                            <label
                                key={n}
                                htmlFor={`crew-${n}`}
                                className="flex items-center gap-2 cursor-pointer"
                            >
                                <RadioGroupItem id={`crew-${n}`} value={String(n)} />
                                <span>{n}</span>
                            </label>
                        ))}
                    </RadioGroup>
                </section>

                {/* Skills */}
                <section>
                    <Label className="text-xs uppercase tracking-wide text-slate-400">
                        Skills required
                    </Label>
                    <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
                        {values.skills_required.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => removeSkill(s)}
                                className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25"
                                aria-label={`remove ${s}`}
                            >
                                {s} <span aria-hidden>×</span>
                            </button>
                        ))}
                        {values.skills_required.length === 0 && (
                            <span className="text-xs text-slate-500">
                                No skills tagged yet.
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Input
                            value={skillInput}
                            onChange={(e) => setSkillInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addSkill();
                                }
                            }}
                            placeholder="e.g. plumbing_minor"
                            className="h-9"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addSkill}
                            className="h-9"
                        >
                            Add
                        </Button>
                    </div>
                </section>

                {/* Certifications */}
                <section>
                    <Label className="text-xs uppercase tracking-wide text-slate-400">
                        Certifications required
                    </Label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        {CERT_OPTIONS.map((c) => (
                            <label
                                key={c.value}
                                className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                                <Checkbox
                                    checked={values.cert_required.includes(c.value)}
                                    onCheckedChange={() => toggleCert(c.value)}
                                />
                                {c.label}
                            </label>
                        ))}
                    </div>
                </section>

                {/* Duration: pricing-time vs real-work (ADR-005) */}
                <section className="grid grid-cols-2 gap-3">
                    <div>
                        <Label className="text-xs uppercase tracking-wide text-slate-400">
                            Pricing time (min)
                        </Label>
                        <Input
                            type="number"
                            min={1}
                            value={values.duration_estimate_minutes}
                            onChange={(e) =>
                                update(
                                    'duration_estimate_minutes',
                                    parseInt(e.target.value, 10) || 0,
                                )
                            }
                            className="h-9 mt-1"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                            Used by EVE pricing. ADR-005.
                        </p>
                    </div>
                    <div>
                        <Label className="text-xs uppercase tracking-wide text-slate-400">
                            Real work (min)
                        </Label>
                        <Input
                            type="number"
                            min={1}
                            value={values.real_work_minutes}
                            onChange={(e) =>
                                update(
                                    'real_work_minutes',
                                    parseInt(e.target.value, 10) || 0,
                                )
                            }
                            className="h-9 mt-1"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                            On-site execution. Routing &amp; pay use this.
                        </p>
                    </div>
                </section>

                {/* Complexity flags */}
                <section>
                    <Label className="text-xs uppercase tracking-wide text-slate-400">
                        Complexity flags
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {COMPLEXITY_OPTIONS.map((f) => {
                            const active = values.complexity_flags.includes(f.value);
                            return (
                                <button
                                    key={f.value}
                                    type="button"
                                    onClick={() => toggleComplexity(f.value)}
                                    className={
                                        'text-xs px-3 py-1.5 rounded-full border transition ' +
                                        (active
                                            ? 'bg-amber-500/90 border-amber-500 text-slate-900 font-semibold'
                                            : 'bg-transparent border-slate-600 text-slate-300 hover:border-amber-500/60')
                                    }
                                >
                                    {f.label}
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* Customer flexibility (admin-captured; distinct from Module 01 flex_tier) */}
                <section>
                    <Label className="text-xs uppercase tracking-wide text-slate-400">
                        Customer flexibility
                    </Label>
                    <RadioGroup
                        value={values.customer_flexibility}
                        onValueChange={(v) =>
                            update('customer_flexibility', v as CustomerFlexibility)
                        }
                        className="grid grid-cols-3 gap-2 mt-2"
                    >
                        {FLEX_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                htmlFor={`flex-${opt.value}`}
                                className="flex items-center gap-2 cursor-pointer rounded-md border border-slate-700 p-2"
                            >
                                <RadioGroupItem id={`flex-${opt.value}`} value={opt.value} />
                                <span className="text-sm">
                                    <span className="block">{opt.label}</span>
                                    <span className="block text-[10px] text-slate-500">
                                        {opt.sub}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </section>

                {/* Validation + save */}
                {validationError && (
                    <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2.5 text-xs text-yellow-300">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{validationError}</span>
                    </div>
                )}

                <div className="flex justify-end">
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving…
                            </>
                        ) : (
                            'Save tags'
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Validation — mirrors the server schema (Module 02 §8)
// ---------------------------------------------------------------------------

function validate(v: JobTagValues): string | null {
    if (!Number.isInteger(v.crew_size_required) || v.crew_size_required < 1 || v.crew_size_required > 4) {
        return 'Crew size must be 1, 2, 3 or 4.';
    }
    if (v.duration_estimate_minutes <= 0) {
        return 'Pricing time must be greater than 0 minutes.';
    }
    if (v.real_work_minutes <= 0) {
        return 'Real work time must be greater than 0 minutes.';
    }
    if (v.real_work_minutes > v.duration_estimate_minutes) {
        return 'Real work time cannot exceed pricing time (ADR-005). The line is under-priced — adjust the quote.';
    }
    return null;
}
