// client/src/components/admin/UnitCard.tsx
//
// Display card for a single Unit (Module 03 — Unit Bench).
// Used by UnitsPage list. Click → opens the edit drawer/modal in the parent.

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Wrench, Pencil } from 'lucide-react';
import { CATEGORY_LABELS } from '@shared/categories';

export type Unit = {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    businessName: string | null;
    profileImageUrl: string | null;
    contractorSegment: 'builder' | 'gap_filler' | 'specialist' | null;
    unitType: 'single' | 'team';
    crewMax: number;
    homePostcode: string | null;
    areaCatchment: string[];
    skills: string[];
    certs: string[];
    minJobValuePence: number | null;
    dayRateTargetPence: number | null;
    reliabilityScore: number | null;
    availabilityStatus: string;
    verificationStatus: string;
};

const SEGMENT_BADGE: Record<NonNullable<Unit['contractorSegment']>, { label: string; cls: string }> = {
    builder:    { label: 'Builder',    cls: 'bg-[#0a2351] text-white border-transparent' },
    gap_filler: { label: 'Gap-Filler', cls: 'bg-[#e8b323] text-[#0a2351] border-transparent' },
    specialist: { label: 'Specialist', cls: 'bg-white text-emerald-700 border-emerald-600' },
};

function poundFromPence(p: number | null): string {
    if (p == null) return '—';
    return `£${(p / 100).toFixed(0)}`;
}

function categoryLabel(slug: string): string {
    return (CATEGORY_LABELS as Record<string, string>)[slug] ?? slug;
}

export function UnitCard({ unit, onEdit }: { unit: Unit; onEdit: (u: Unit) => void }) {
    const fullName = [unit.firstName, unit.lastName].filter(Boolean).join(' ') || '(unnamed unit)';
    const seg = unit.contractorSegment ? SEGMENT_BADGE[unit.contractorSegment] : null;

    const visibleSkills = unit.skills.slice(0, 3);
    const overflow = unit.skills.length - visibleSkills.length;

    return (
        <Card
            className="hover:shadow-md transition-shadow cursor-pointer border border-slate-200"
            onClick={() => onEdit(unit)}
            data-testid="unit-card"
        >
            <CardContent className="p-4">
                <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                        {unit.profileImageUrl ? (
                            <img src={unit.profileImageUrl} alt={fullName} className="w-full h-full object-cover" />
                        ) : (
                            <Wrench className="w-6 h-6 text-slate-500" />
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        {/* Name + segment */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-[#0a2351] truncate">{fullName}</h3>
                            {seg && <Badge className={seg.cls}>{seg.label}</Badge>}
                            {unit.unitType === 'team' && (
                                <Badge variant="outline" className="text-xs">Team · {unit.crewMax}</Badge>
                            )}
                            {unit.availabilityStatus === 'inactive' && (
                                <Badge variant="outline" className="text-xs text-slate-500">Inactive</Badge>
                            )}
                        </div>
                        {unit.businessName && (
                            <p className="text-xs text-slate-500 truncate">{unit.businessName}</p>
                        )}

                        {/* Skills row */}
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                            {visibleSkills.map((s) => (
                                <Badge key={s} variant="outline" className="text-xs font-normal">
                                    {categoryLabel(s)}
                                </Badge>
                            ))}
                            {overflow > 0 && (
                                <span className="text-xs text-slate-500">+{overflow}</span>
                            )}
                            {unit.skills.length === 0 && (
                                <span className="text-xs italic text-slate-400">No skills set</span>
                            )}
                        </div>

                        {/* Geography + economics row */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                            <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {unit.homePostcode || '—'}
                                {unit.areaCatchment.length > 0 && (
                                    <span className="text-slate-400 ml-1">+{unit.areaCatchment.length} areas</span>
                                )}
                            </span>
                            {unit.contractorSegment === 'builder' && (
                                <span>
                                    Day rate target: <strong>{poundFromPence(unit.dayRateTargetPence)}</strong>
                                </span>
                            )}
                            {unit.contractorSegment !== 'builder' && unit.minJobValuePence != null && (
                                <span>Min job: <strong>{poundFromPence(unit.minJobValuePence)}</strong></span>
                            )}
                            {unit.reliabilityScore != null && (
                                <span>
                                    Rel: <strong>{unit.reliabilityScore.toFixed(2)}</strong>
                                </span>
                            )}
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); onEdit(unit); }}
                        aria-label="Edit unit"
                    >
                        <Pencil className="w-4 h-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

export default UnitCard;
