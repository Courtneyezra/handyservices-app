// client/src/components/admin/UnitForm.tsx
//
// Create/edit form for a Unit (Module 03 — Unit Bench).
// Used inside a Dialog from UnitsPage. Pure form — parent owns the
// mutation and the modal lifecycle.

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { X, Loader2 } from 'lucide-react';
import { CATEGORY_LABELS, type JobCategory } from '@shared/categories';
import type { Unit } from './UnitCard';

const ALL_CATEGORIES: JobCategory[] = Object.keys(CATEGORY_LABELS) as JobCategory[];

const CERTS = [
    { slug: 'gas_safe',   label: 'Gas Safe' },
    { slug: 'niceic',     label: 'NICEIC' },
    { slug: 'part_p',     label: 'Part P' },
    { slug: 'structural', label: 'Structural' },
] as const;

const SEGMENT_OPTIONS = [
    {
        value: 'builder',
        label: 'Builder',
        helper: 'Commits days in advance, receives day-pack offers, all-or-nothing completion bonus.',
    },
    {
        value: 'gap_filler',
        label: 'Gap-Filler',
        helper: 'Submits weekly availability, receives single-job offers, no day commitment.',
    },
    {
        value: 'specialist',
        label: 'Specialist',
        helper: 'Cert-gated work only. Requires verified Gas Safe / NICEIC / Part P / structural credentials.',
    },
] as const;

export type UnitFormValues = {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    businessName: string;
    bio: string;
    profileImageUrl: string;
    contractorSegment: 'builder' | 'gap_filler' | 'specialist' | '';
    unitType: 'single' | 'team';
    crewMax: number;
    homePostcode: string;
    areaCatchment: string[];
    skills: string[];
    acceptsSkus: string[];     // empty array → use skills filter
    certs: string[];
    minJobValuePencePounds: string;       // pounds in input, converted to pence on submit
    dayRateTargetPencePounds: string;
};

function unitToFormValues(u: Partial<Unit> | null): UnitFormValues {
    return {
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        email: u?.email ?? '',
        phone: '',
        businessName: u?.businessName ?? '',
        bio: '',
        profileImageUrl: u?.profileImageUrl ?? '',
        contractorSegment: u?.contractorSegment ?? '',
        unitType: u?.unitType ?? 'single',
        crewMax: u?.crewMax ?? 1,
        homePostcode: u?.homePostcode ?? '',
        areaCatchment: u?.areaCatchment ?? [],
        skills: u?.skills ?? [],
        acceptsSkus: [],
        certs: u?.certs ?? [],
        minJobValuePencePounds: u?.minJobValuePence != null ? String(u.minJobValuePence / 100) : '',
        dayRateTargetPencePounds: u?.dayRateTargetPence != null ? String(u.dayRateTargetPence / 100) : '',
    };
}

export interface UnitFormProps {
    initialUnit: Unit | null;          // null = create
    error?: string | null;             // server-side error to display (e.g. segment locked)
    submitting?: boolean;
    onCancel: () => void;
    onSubmit: (payload: any) => void | Promise<void>;
}

export function UnitForm({ initialUnit, error, submitting, onCancel, onSubmit }: UnitFormProps) {
    const isEdit = !!initialUnit;
    const [values, setValues] = useState<UnitFormValues>(() => unitToFormValues(initialUnit));
    const [areaInput, setAreaInput] = useState('');

    useEffect(() => {
        setValues(unitToFormValues(initialUnit));
        setAreaInput('');
    }, [initialUnit]);

    function patch(p: Partial<UnitFormValues>) {
        setValues((prev) => ({ ...prev, ...p }));
    }

    function toggleSkill(slug: string) {
        patch({
            skills: values.skills.includes(slug)
                ? values.skills.filter((s) => s !== slug)
                : [...values.skills, slug],
        });
    }

    function toggleCert(slug: string) {
        patch({
            certs: values.certs.includes(slug)
                ? values.certs.filter((s) => s !== slug)
                : [...values.certs, slug],
        });
    }

    function addArea() {
        const v = areaInput.trim().toUpperCase();
        if (!v) return;
        if (values.areaCatchment.includes(v)) {
            setAreaInput('');
            return;
        }
        patch({ areaCatchment: [...values.areaCatchment, v] });
        setAreaInput('');
    }

    function removeArea(v: string) {
        patch({ areaCatchment: values.areaCatchment.filter((a) => a !== v) });
    }

    function buildPayload() {
        const minPence = values.minJobValuePencePounds === ''
            ? null
            : Math.max(0, Math.round(Number(values.minJobValuePencePounds) * 100));
        const dayRatePence = values.dayRateTargetPencePounds === ''
            ? null
            : Math.max(0, Math.round(Number(values.dayRateTargetPencePounds) * 100));

        const segment = values.contractorSegment === '' ? null : values.contractorSegment;

        return {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            email: values.email.trim(),
            phone: values.phone.trim() || null,
            businessName: values.businessName.trim() || null,
            bio: values.bio.trim() || null,
            profileImageUrl: values.profileImageUrl.trim() || null,
            contractorSegment: segment,
            unitType: values.unitType,
            crewMax: values.unitType === 'team' ? Math.max(2, values.crewMax || 2) : 1,
            homePostcode: values.homePostcode.trim().toUpperCase() || null,
            areaCatchment: values.areaCatchment,
            skills: values.skills,
            acceptsSkus: values.acceptsSkus.length > 0 ? values.acceptsSkus : null,
            certs: values.certs,
            minJobValuePence: minPence,
            dayRateTargetPence: segment === 'builder' ? dayRatePence : null,
        };
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        await onSubmit(buildPayload());
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6" data-testid="unit-form">
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 rounded-md px-3 py-2 text-sm">
                    {error}
                </div>
            )}

            {/* Identity */}
            <section className="space-y-3">
                <h3 className="font-semibold text-[#0a2351]">Identity</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="firstName">First name</Label>
                        <Input
                            id="firstName"
                            value={values.firstName}
                            onChange={(e) => patch({ firstName: e.target.value })}
                            required
                            disabled={isEdit}
                        />
                    </div>
                    <div>
                        <Label htmlFor="lastName">Last name</Label>
                        <Input
                            id="lastName"
                            value={values.lastName}
                            onChange={(e) => patch({ lastName: e.target.value })}
                            required
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={values.email}
                            onChange={(e) => patch({ email: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                            id="phone"
                            value={values.phone}
                            onChange={(e) => patch({ phone: e.target.value })}
                            placeholder={isEdit ? '(unchanged)' : ''}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="businessName">Business name</Label>
                        <Input
                            id="businessName"
                            value={values.businessName}
                            onChange={(e) => patch({ businessName: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="profileImageUrl">Photo URL</Label>
                        <Input
                            id="profileImageUrl"
                            value={values.profileImageUrl}
                            onChange={(e) => patch({ profileImageUrl: e.target.value })}
                            placeholder="/api/media/contractors/profile/..."
                        />
                    </div>
                </div>
            </section>

            {/* Segment */}
            <section className="space-y-2">
                <h3 className="font-semibold text-[#0a2351]">Segment</h3>
                <RadioGroup
                    value={values.contractorSegment || ''}
                    onValueChange={(v: string) => patch({ contractorSegment: v as UnitFormValues['contractorSegment'] })}
                >
                    {SEGMENT_OPTIONS.map((opt) => (
                        <label
                            key={opt.value}
                            className="flex items-start gap-3 border rounded-md p-3 hover:bg-slate-50 cursor-pointer"
                        >
                            <RadioGroupItem value={opt.value} className="mt-1" />
                            <div>
                                <div className="font-medium text-sm">{opt.label}</div>
                                <div className="text-xs text-slate-500">{opt.helper}</div>
                            </div>
                        </label>
                    ))}
                </RadioGroup>
            </section>

            {/* Unit type / crew */}
            <section className="space-y-2">
                <h3 className="font-semibold text-[#0a2351]">Unit type</h3>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2">
                        <input
                            type="radio"
                            name="unitType"
                            value="single"
                            checked={values.unitType === 'single'}
                            onChange={() => patch({ unitType: 'single', crewMax: 1 })}
                        />
                        <span className="text-sm">Single</span>
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="radio"
                            name="unitType"
                            value="team"
                            checked={values.unitType === 'team'}
                            onChange={() => patch({ unitType: 'team', crewMax: Math.max(2, values.crewMax) })}
                        />
                        <span className="text-sm">Team</span>
                    </label>
                    {values.unitType === 'team' && (
                        <div className="flex items-center gap-2">
                            <Label htmlFor="crewMax" className="text-sm">Crew max:</Label>
                            <Input
                                id="crewMax"
                                type="number"
                                min={2}
                                value={values.crewMax}
                                onChange={(e) => patch({ crewMax: Math.max(2, Number(e.target.value) || 2) })}
                                className="w-24"
                            />
                        </div>
                    )}
                </div>
            </section>

            {/* Geography */}
            <section className="space-y-2">
                <h3 className="font-semibold text-[#0a2351]">Geography</h3>
                <div>
                    <Label htmlFor="homePostcode">Home postcode</Label>
                    <Input
                        id="homePostcode"
                        value={values.homePostcode}
                        onChange={(e) => patch({ homePostcode: e.target.value })}
                        placeholder="NG7 2AB"
                    />
                </div>
                <div>
                    <Label>Area catchment (postcode prefixes)</Label>
                    <div className="flex gap-2 mt-1">
                        <Input
                            value={areaInput}
                            onChange={(e) => setAreaInput(e.target.value.toUpperCase())}
                            placeholder="NG7"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); addArea(); }
                            }}
                        />
                        <Button type="button" variant="outline" onClick={addArea}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                        {values.areaCatchment.map((a) => (
                            <Badge key={a} variant="outline" className="gap-1">
                                {a}
                                <button
                                    type="button"
                                    onClick={() => removeArea(a)}
                                    className="text-slate-500 hover:text-red-600"
                                    aria-label={`Remove ${a}`}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </Badge>
                        ))}
                        {values.areaCatchment.length === 0 && (
                            <span className="text-xs italic text-slate-400">None — unit travels only from home postcode.</span>
                        )}
                    </div>
                </div>
            </section>

            {/* Capabilities */}
            <section className="space-y-2">
                <h3 className="font-semibold text-[#0a2351]">Capabilities</h3>

                <div>
                    <Label className="text-sm">Skills</Label>
                    <div className="grid grid-cols-3 gap-2 mt-1 max-h-48 overflow-y-auto border rounded-md p-2">
                        {ALL_CATEGORIES.map((slug) => (
                            <label key={slug} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={values.skills.includes(slug)}
                                    onCheckedChange={() => toggleSkill(slug)}
                                />
                                <span>{CATEGORY_LABELS[slug]}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <Label className="text-sm">Certifications</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                        {CERTS.map((c) => (
                            <label key={c.slug} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={values.certs.includes(c.slug)}
                                    onCheckedChange={() => toggleCert(c.slug)}
                                />
                                <span>{c.label}</span>
                            </label>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        Cert documents are verified separately. Specialist segment requires at least one verified cert before
                        the unit will be offered cert-gated work.
                    </p>
                </div>
            </section>

            {/* Economics */}
            <section className="space-y-2">
                <h3 className="font-semibold text-[#0a2351]">Economics</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="minJob">Min job value (£)</Label>
                        <Input
                            id="minJob"
                            type="number"
                            min={0}
                            value={values.minJobValuePencePounds}
                            onChange={(e) => patch({ minJobValuePencePounds: e.target.value })}
                            placeholder="0"
                        />
                        <p className="text-xs text-slate-500 mt-1">Below this, unit declines.</p>
                    </div>
                    {values.contractorSegment === 'builder' && (
                        <div>
                            <Label htmlFor="dayRate">Day-rate target (£)</Label>
                            <Input
                                id="dayRate"
                                type="number"
                                min={0}
                                value={values.dayRateTargetPencePounds}
                                onChange={(e) => patch({ dayRateTargetPencePounds: e.target.value })}
                                placeholder="280"
                            />
                            <p className="text-xs text-slate-500 mt-1">What this unit wants to earn for a full committed day.</p>
                        </div>
                    )}
                </div>
            </section>

            {/* Bio */}
            <section className="space-y-2">
                <Label htmlFor="bio">Notes</Label>
                <Textarea
                    id="bio"
                    value={values.bio}
                    onChange={(e) => patch({ bio: e.target.value })}
                    rows={3}
                />
            </section>

            <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-[#0a2351] hover:bg-[#081d44] text-white"
                >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {isEdit ? 'Save unit' : 'Create unit'}
                </Button>
            </div>
        </form>
    );
}

export default UnitForm;
