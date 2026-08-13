/**
 * Published SEO trade pages per city — the internal-link source for the city
 * landing pages so the server-rendered /:city/:trade pages aren't orphaned
 * (GSC 12 Aug: they were "Discovered – currently not indexed", never crawled,
 * because nothing on-site linked to them).
 *
 * ⚠️ This MUST track the server rollout gate (keyword_targets.pagePublished via
 * server/seo/rollout.ts). Only list trades whose T2 page is actually PUBLISHED
 * (index,follow) — linking to a noindex/unpublished page wastes crawl and link
 * equity. Current state pulled from prod 12 Aug 2026. When you flip a trade
 * live in /admin/seo, add it here too.
 *
 * 'handyman' is intentionally EXCLUDED — the city landing (/nottingham, /derby)
 * is itself the city handyman page; linking /:city/handyman would split the
 * head term across two competing pages.
 */
export interface PublishedService {
    slug: string;
    label: string;
}

// Labels mirror SEO_SERVICES in server/seo/content/services.ts.
const LABELS: Record<string, string> = {
    'painter-decorator': 'Painting & Decorating',
    'gutter-cleaning': 'Gutter Cleaning',
    fencing: 'Fencing',
    plasterer: 'Plastering',
    'kitchen-fitting': 'Kitchen Fitting',
    carpenter: 'Carpentry',
    tiler: 'Tiling',
    'bathroom-fitting': 'Bathroom Fitting',
    landscaping: 'Garden & Landscaping',
    'pressure-washing': 'Pressure Washing',
    decking: 'Decking',
    'fitted-wardrobes': 'Fitted Wardrobes',
    flooring: 'Flooring',
    'artificial-grass': 'Artificial Grass',
    'garage-door': 'Garage Door Repair',
    'roof-cleaning': 'Roof Cleaning',
    'loft-boarding': 'Loft Boarding',
};

// Published trade slugs per city (excluding 'handyman'). Keep in sync with the
// rollout gate — see the file header.
const PUBLISHED_SLUGS: Record<string, string[]> = {
    nottingham: [
        'painter-decorator', 'plasterer', 'fencing', 'gutter-cleaning', 'landscaping',
        'kitchen-fitting', 'bathroom-fitting', 'carpenter', 'tiler', 'flooring',
        'fitted-wardrobes', 'decking', 'pressure-washing', 'artificial-grass',
        'garage-door', 'roof-cleaning', 'loft-boarding',
    ],
    derby: [
        'painter-decorator', 'plasterer', 'fencing', 'gutter-cleaning', 'landscaping',
    ],
};

/** Published trade pages for a city slug (lowercase), ready to render as links. */
export function publishedServices(citySlug: string): PublishedService[] {
    return (PUBLISHED_SLUGS[citySlug] ?? [])
        .filter((slug) => LABELS[slug])
        .map((slug) => ({ slug, label: LABELS[slug] }));
}
