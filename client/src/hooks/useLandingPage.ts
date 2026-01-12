
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { trackEvent } from "../lib/posthog";
import { apiRequest } from "../lib/queryClient";

export interface LandingPageContent {
    heroHeadline: string;
    heroSubhead: string;
    ctaText: string;
    heroImage: string;
    [key: string]: any;
}

export interface LandingPageVariant {
    id: number;
    name: string;
    weight: number;
    content: LandingPageContent;
}

export interface LandingPage {
    id: number;
    slug: string;
    name: string;
    variants: LandingPageVariant[];
}

export function useLandingPage(slug: string) {
    const { data: page, isLoading, error } = useQuery<LandingPage>({
        queryKey: ["landing-page", slug],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/landing-pages/${slug}`);
            return res.json();
        },
        retry: false
    });

    const [variant, setVariant] = useState<LandingPageVariant | null>(null);

    useEffect(() => {
        if (!page || !page.variants || page.variants.length === 0) return;

        // check local storage first
        const storageKey = `variant_${page.id}`;
        const storedVariantId = localStorage.getItem(storageKey);

        let selected: LandingPageVariant | undefined;

        if (storedVariantId) {
            selected = page.variants.find(v => v.id === parseInt(storedVariantId));
        }

        if (!selected) {
            // Weighted random selection
            const totalWeight = page.variants.reduce((sum, v) => sum + v.weight, 0);
            let random = Math.random() * totalWeight;

            for (const v of page.variants) {
                if (random < v.weight) {
                    selected = v;
                    break;
                }
                random -= v.weight;
            }
            // Fallback
            if (!selected) selected = page.variants[0];

            // Save selection
            localStorage.setItem(storageKey, selected.id.toString());
        }

        setVariant(selected);

        // Track View
        // De-duplicate views per session logic could go here, but for now we track every mount or rely on PostHog session
        trackEvent("landing_page_view", {
            page_id: page.id,
            variant_id: selected.id,
            slug: page.slug
        });

        // Track locally to DB for Admin Dashboard
        apiRequest("POST", "/api/content/track", {
            type: 'variant',
            id: selected.id,
            action: 'view'
        });

    }, [page]);

    const trackConversion = (source?: string) => {
        if (!page || !variant) return;

        trackEvent("landing_page_conversion", {
            page_id: page.id,
            variant_id: variant.id,
            slug: page.slug,
            source: source || 'unknown'
        });

        apiRequest("POST", "/api/content/track", {
            type: 'variant',
            id: variant.id,
            action: 'click'
        });
    };

    return { page, variant, isLoading, error, trackConversion };
}
