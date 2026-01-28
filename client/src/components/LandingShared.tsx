
import { Star } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import handyLogo from "@assets/Copy of Copy of Add a heading-3_1764600628729.webp";

export function HandLogo({ className = "w-12 h-12" }: { className?: string }) {
    return (
        <img
            src={handyLogo}
            alt="Handy Services"
            className={`${className} object-contain`}
        />
    );
}

export function GoogleReviewsBadge({ dark = false }: { dark?: boolean }) {
    return (
        <div className={`flex items-center gap-2 ${dark ? "text-slate-800" : "text-white"}`}>
            <SiGoogle className="w-5 h-5" />
            <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-4 h-4 ${dark ? "fill-white text-white" : "fill-amber-400 text-amber-400"}`} />
                ))}
            </div>
            <span className="text-sm font-medium">4.9 from 300+ Reviews</span>
        </div>
    );
}
