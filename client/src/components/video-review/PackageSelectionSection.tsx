
import { motion } from "framer-motion";
import { Check, Shield, Star, Crown, Clock, PhoneCall, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Package {
    tier: "essential" | "enhanced" | "elite";
    name: string;
    price: number; // in pounds
    description: string;
    features: string[];
    isPopular?: boolean;
    hasAftercare?: boolean;
    warrantyMonths: number;
}

interface PackageSelectionSectionProps {
    packages: Package[];
    selectedTier: string;
    onSelect: (tier: "essential" | "enhanced" | "elite") => void;
}

export function PackageSelectionSection({ packages, selectedTier, onSelect }: PackageSelectionSectionProps) {
    // Sort logic: essential -> enhanced -> elite
    const sortedPackages = packages.sort((a, b) => {
        const order = { essential: 1, enhanced: 2, elite: 3 };
        return order[a.tier] - order[b.tier];
    });

    return (
        <div className="space-y-4 px-4 pb-32">
            {sortedPackages.map((pkg) => {
                const isSelected = pkg.tier === selectedTier;

                // Tier specific styles
                const tierStyles = {
                    essential: {
                        border: "border-slate-700",
                        activeBorder: "border-blue-500",
                        bg: "bg-slate-800/50",
                        activeBg: "bg-blue-900/20",
                        iconColor: "text-blue-400",
                        icon: Shield
                    },
                    enhanced: {
                        border: "border-amber-500/30",
                        activeBorder: "border-[#e8b323]",
                        bg: "bg-slate-800/50",
                        activeBg: "bg-amber-900/20",
                        iconColor: "text-[#e8b323]",
                        icon: Star
                    },
                    elite: {
                        border: "border-purple-500/30",
                        activeBorder: "border-purple-500",
                        bg: "bg-slate-800/50",
                        activeBg: "bg-purple-900/20",
                        iconColor: "text-purple-400",
                        icon: Crown
                    }
                };

                const style = tierStyles[pkg.tier];
                const Icon = style.icon;

                return (
                    <motion.div
                        key={pkg.tier}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => onSelect(pkg.tier)}
                        className={cn(
                            "relative rounded-xl border-2 transition-all duration-300 cursor-pointer overflow-hidden",
                            isSelected ? style.activeBorder : style.border,
                            isSelected ? style.activeBg : style.bg
                        )}
                    >
                        {/* Popular Badge */}
                        {pkg.isPopular && (
                            <div className="absolute top-0 right-0 bg-[#e8b323] text-black text-[10px] font-bold px-2 py-1 rounded-bl-lg z-10">
                                MOST POPULAR
                            </div>
                        )}

                        <div className="p-5">
                            {/* Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={cn("p-2 rounded-lg bg-slate-900/50", style.iconColor)}>
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-bold text-lg leading-tight">{pkg.name}</h3>
                                        <p className="text-slate-400 text-xs mt-0.5">{pkg.warrantyMonths}-month warranty</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-bold text-white">£{pkg.price}</div>
                                    {pkg.tier === 'essential' ? (
                                        <p className="text-[10px] text-slate-500">Pay in full</p>
                                    ) : (
                                        <div className="flex items-center justify-end gap-1 text-[10px] text-emerald-400 font-medium">
                                            <Zap className="w-3 h-3" />
                                            <span>Pay in {pkg.tier === 'elite' ? '3' : '2'}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Description Tagline */}
                            <p className="text-slate-300 text-sm mb-4 italic border-l-2 border-slate-700 pl-3">
                                "{pkg.description}"
                            </p>

                            {/* Features */}
                            <ul className="space-y-2.5">
                                {pkg.features.slice(0, 4).map((feature, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <Check className={cn("w-4 h-4 mt-0.5 shrink-0", style.iconColor)} />
                                        <span className="text-slate-300 text-sm">{feature}</span>
                                    </li>
                                ))}
                                {pkg.features.length > 4 && (
                                    <li className="text-xs text-slate-500 pl-7">
                                        + {pkg.features.length - 4} more benefits
                                    </li>
                                )}
                            </ul>
                        </div>

                        {/* Selection Indicator */}
                        {isSelected && (
                            <div className={cn("absolute inset-0 border-2 rounded-xl pointer-events-none", style.activeBorder)} />
                        )}
                    </motion.div>
                );
            })}
        </div>
    );
}
