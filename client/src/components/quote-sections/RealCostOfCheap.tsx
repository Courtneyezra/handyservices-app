
import { AlertTriangle, TrendingUp, XCircle, Clock, AlertOctagon } from "lucide-react";

export const RealCostOfCheap = () => {
    return (
        <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-6 md:p-8 mt-12 max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-red-500/20 rounded-lg">
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-white">THE REAL COST OF SAVING £50</h3>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <CostItem
                        icon={<AlertOctagon className="w-5 h-5 text-red-400" />}
                        title="No Insurance"
                        desc="You're personally liable if they damage your home or hit a pipe."
                    />
                    <CostItem
                        icon={<XCircle className="w-5 h-5 text-red-400" />}
                        title="No Warranty"
                        desc="You pay twice when the bodge job fails in 6 months."
                    />
                    <CostItem
                        icon={<TrendingUp className="w-5 h-5 text-red-400" />}
                        title="Poor Materials"
                        desc="Cheap brackets/fittings that rust or fail under load."
                    />
                </div>

                <div className="space-y-4">
                    <CostItem
                        icon={<Clock className="w-5 h-5 text-red-400" />}
                        title="No-Shows"
                        desc="Wasted day off work waiting for them. What's your time worth?"
                    />
                    <CostItem
                        icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
                        title="The 'Bodge' Job"
                        desc="Often costs 3x our quote to fix the mess they leave behind."
                    />
                </div>
            </div>

            <div className="mt-8 pt-6 border-t border-red-500/20 text-center">
                <p className="text-red-200/80 italic text-sm md:text-base">
                    "We've had <span className="font-bold text-white">23 customers this year</span> who came to us AFTER a cheap quote went wrong."
                </p>
            </div>
        </div>
    );
};

const CostItem = ({ icon, title, desc }: { icon: any, title: string, desc: string }) => (
    <div className="flex gap-3 items-start">
        <div className="mt-1 shrink-0">{icon}</div>
        <div>
            <div className="font-bold text-red-200">{title}</div>
            <div className="text-sm text-white/60 leading-snug">{desc}</div>
        </div>
    </div>
);
