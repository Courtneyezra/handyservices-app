
import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronUp, Info } from 'lucide-react';

interface Service {
    id: string;
    name: string;
    skuCode: string;
    description: string;
    category: string;
}

interface SkillSelectorProps {
    value: Array<{
        skuId: string;
        proficiency: 'basic' | 'competent' | 'expert';
    }>;
    onChange: (skills: Array<{ skuId: string; proficiency: 'basic' | 'competent' | 'expert' }>) => void;
}

export default function SkillSelector({ value, onChange }: SkillSelectorProps) {
    const [capabilities, setCapabilities] = useState<Record<string, Service[]>>({});
    const [loading, setLoading] = useState(true);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    useEffect(() => {
        const fetchCapabilities = async () => {
            try {
                const token = localStorage.getItem('contractorToken');
                const res = await fetch('/api/contractor/onboarding/capabilities', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setCapabilities(data);
                }
            } catch (err) {
                console.error("Failed to fetch capabilities", err);
            } finally {
                setLoading(false);
            }
        };
        fetchCapabilities();
    }, []);

    const toggleSkill = (skuId: string) => {
        const exists = value.find(s => s.skuId === skuId);
        if (exists) {
            onChange(value.filter(s => s.skuId !== skuId));
        } else {
            onChange([...value, { skuId, proficiency: 'competent' }]);
        }
    };

    const updateProficiency = (skuId: string, level: 'basic' | 'competent' | 'expert') => {
        onChange(value.map(s => s.skuId === skuId ? { ...s, proficiency: level } : s));
    };

    if (loading) return <div className="p-8 text-center text-slate-400">Loading skills...</div>;

    return (
        <div className="space-y-4">
            {Object.entries(capabilities).map(([category, services]) => {
                const categorySelectedCount = services.filter(s => value.some(v => v.skuId === s.id)).length;
                const isExpanded = expandedCategory === category;

                return (
                    <div key={category} className="border border-slate-200 rounded-xl overflow-hidden bg-white transition-all">
                        {/* Category Header */}
                        <button
                            type="button"
                            onClick={() => setExpandedCategory(isExpanded ? null : category)}
                            className={`w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${categorySelectedCount > 0 ? 'bg-[#6C6CFF]/10 text-[#6C6CFF]' : 'bg-slate-100 text-slate-500'}`}>
                                    {category.substring(0, 1).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">{category}</h3>
                                    <p className="text-sm text-slate-500">
                                        {categorySelectedCount > 0
                                            ? `${categorySelectedCount} skills selected`
                                            : `${services.length} skills available`}
                                    </p>
                                </div>
                            </div>
                            <div className="text-slate-400">
                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                        </button>

                        {/* Skills List */}
                        {isExpanded && (
                            <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2 mb-4">
                                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <p>Select the specific tasks you are confident performing. Be accurate - this affects the jobs we send you.</p>
                                </div>

                                {services.map(service => {
                                    const selectedSkill = value.find(v => v.skuId === service.id);
                                    const isSelected = !!selectedSkill;

                                    return (
                                        <div key={service.id} className={`p-4 rounded-xl border transition-all ${isSelected ? 'border-[#6C6CFF] bg-[#6C6CFF]/5' : 'border-slate-200 hover:border-slate-300'}`}>
                                            <div className="flex items-start gap-3">
                                                <div
                                                    onClick={() => toggleSkill(service.id)}
                                                    className={`w-5 h-5 mt-0.5 rounded border cursor-pointer flex items-center justify-center transition-colors ${isSelected ? 'bg-[#6C6CFF] border-[#6C6CFF] text-white' : 'border-slate-300 bg-white'}`}
                                                >
                                                    {isSelected && <Check size={14} strokeWidth={3} />}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                        <div onClick={() => toggleSkill(service.id)} className="cursor-pointer">
                                                            <div className="font-medium text-slate-900">{service.name.split(':')[1] || service.name}</div>
                                                            <div className="text-xs text-slate-500 mt-0.5">{service.description}</div>
                                                        </div>

                                                        {isSelected && (
                                                            <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-slate-200 shadow-sm shrink-0">
                                                                {(['basic', 'competent', 'expert'] as const).map((level) => (
                                                                    <button
                                                                        key={level}
                                                                        type="button"
                                                                        onClick={() => updateProficiency(service.id, level)}
                                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${selectedSkill.proficiency === level ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                                                                    >
                                                                        {level.charAt(0).toUpperCase() + level.slice(1)}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
