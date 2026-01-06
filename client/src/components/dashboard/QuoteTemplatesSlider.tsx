import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Wrench, Zap, Paintbrush, Hammer, Plus } from "lucide-react";

interface ServiceSKU {
    id: string;
    name: string;
    pricePence: number;
    description: string;
    category: string;
}

export function QuoteTemplatesSlider() {
    const { data: services, isLoading } = useQuery<ServiceSKU[]>({
        queryKey: ['contractor-services'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/services', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('contractorToken')}`
                }
            });
            if (!res.ok) throw new Error('Failed to fetch services');
            return res.json();
        }
    });

    console.log('[QuoteTemplatesSlider] Data:', services, 'Loading:', isLoading);

    if (isLoading) return <div className="p-4 text-center text-slate-500 animate-pulse">Loading templates...</div>;

    if (!services?.length) {
        return (
            <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-900/30 text-center">
                <p className="text-slate-500 text-sm mb-2">No templates found.</p>
                <div className="text-xs text-slate-600">Complete onboarding to generate SKUs.</div>
            </div>
        );
    }

    const getIcon = (category: string) => {
        const c = category.toLowerCase();
        if (c.includes('plumb')) return <Wrench className="w-5 h-5 text-blue-400" />;
        if (c.includes('electric')) return <Zap className="w-5 h-5 text-yellow-400" />;
        if (c.includes('paint')) return <Paintbrush className="w-5 h-5 text-pink-400" />;
        if (c.includes('carpen')) return <Hammer className="w-5 h-5 text-amber-700" />;
        return <Wrench className="w-5 h-5 text-slate-400" />;
    };

    return (
        <div className="w-full overflow-x-auto pb-4 -mt-2">
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3 px-1">
                Quick Start Templates
            </h3>
            <div className="flex gap-4">
                {services.map((sku) => (
                    <Link key={sku.id} href={`/contractor/dashboard/quotes/new?sku=${sku.id}`}>
                        <div className="min-w-[240px] p-4 bg-slate-900/50 border border-slate-800 rounded-xl hover:bg-slate-800/80 hover:border-amber-500/30 transition-all cursor-pointer group flex flex-col justify-between h-[110px]">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-slate-800 rounded-lg group-hover:scale-110 transition-transform">
                                    {getIcon(sku.category || sku.name)}
                                </div>
                                <span className="font-mono text-emerald-400 font-bold">
                                    £{(sku.pricePence / 100).toFixed(0)}
                                </span>
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-200 text-sm truncate group-hover:text-amber-400 transition-colors">
                                    {sku.name.replace(' - ', ' • ')}
                                </h4>
                                <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                                    <span>Use Template</span>
                                    <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}

                {/* "Create Custom" Card */}
                <Link href="/contractor/dashboard/quotes/new">
                    <div className="min-w-[100px] flex flex-col items-center justify-center bg-slate-900/30 border border-dashed border-slate-800 rounded-xl hover:bg-slate-800/50 hover:border-slate-700 transition-all cursor-pointer h-[110px]">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center mb-2">
                            <Plus className="w-4 h-4 text-slate-400" />
                        </div>
                        <span className="text-xs text-slate-500 font-medium">Custom</span>
                    </div>
                </Link>
            </div>
        </div>
    );
}
