
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { Megaphone, X } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";

export default function SmartBanner() {
    const { data: banners } = useQuery<any[]>({
        queryKey: ["active-banners"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/banners/active");
            return res.json();
        }
    });

    // Simple session storage to dismiss
    const [dismissed, setDismissed] = useState<string[]>([]);

    useEffect(() => {
        const stored = sessionStorage.getItem("dismissed_banners");
        if (stored) setDismissed(JSON.parse(stored));
    }, []);

    const handleDismiss = (id: number) => {
        const newDismissed = [...dismissed, id.toString()];
        setDismissed(newDismissed);
        sessionStorage.setItem("dismissed_banners", JSON.stringify(newDismissed));
    };

    // Tracking
    const trackClick = (id: number) => {
        apiRequest("POST", "/api/content/track", {
            type: 'banner',
            id,
            action: 'click'
        });
    };

    // View tracking could be done here with useEffect once per session/mount
    useEffect(() => {
        if (banners) {
            banners.forEach(b => {
                if (!dismissed.includes(b.id.toString())) {
                    apiRequest("POST", "/api/content/track", {
                        type: 'banner',
                        id: b.id,
                        action: 'view'
                    });
                }
            })
        }
    }, [banners]);


    if (!banners || banners.length === 0) return null;

    // Show only the latest active banner that isn't dismissed? 
    // Or stack them? Let's show the first top-bar one.
    const activeBanner = banners.find(b => b.location === 'top-bar' && !dismissed.includes(b.id.toString()));

    if (!activeBanner) return null;

    return (
        <div className="bg-primary text-primary-foreground px-4 py-2 text-center relative text-sm font-medium z-50">
            <div className="container mx-auto flex items-center justify-center gap-2">
                <Megaphone className="h-4 w-4" />
                <div dangerouslySetInnerHTML={{ __html: activeBanner.content }} />
                {activeBanner.linkUrl && (
                    <Link href={activeBanner.linkUrl} onClick={() => trackClick(activeBanner.id)}>
                        <a className="underline ml-1 hover:text-white/80">Learn More</a>
                    </Link>
                )}
            </div>
            <button
                onClick={() => handleDismiss(activeBanner.id)}
                className="absolute right-4 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
