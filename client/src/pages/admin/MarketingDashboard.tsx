import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import LandingPageBuilder from "./LandingPageBuilder";
import { Loader2 } from "lucide-react";

export default function MarketingDashboard() {
    // Master Page Architecture: Find the 'landing' slug page
    const { data: pages, isLoading } = useQuery<any[]>({
        queryKey: ["admin-landing-pages"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/landing-pages");
            return res.json();
        }
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const masterPage = pages?.find(p => p.slug === 'landing');

    if (!masterPage) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold tracking-tight mb-4">Marketing Control Center</h1>
                <div className="p-8 border border-dashed rounded-lg text-center">
                    <p className="text-muted-foreground">Master Landing Page (slug: 'landing') not found.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 max-w-7xl mx-auto">
            <div className="mb-4">
                <h1 className="text-2xl font-bold tracking-tight">Master Page Editor</h1>
                <p className="text-sm text-muted-foreground">
                    Edits here apply to both <code>/landing</code> and <code>/derby</code> automatically.
                </p>
            </div>
            {/* Render the Builder directly for the Master Page */}
            <LandingPageBuilder pageId={masterPage.id} />
        </div>
    );
}
