/**
 * SEO programmatic-pages CONTRACT — the shared interface all SEO page modules
 * build against, so content/render/routes can be developed independently.
 *
 * Architecture: T1/T2/T3 landing pages are SERVER-RENDERED HTML from Express
 * (full content + meta + JSON-LD in the initial response), mounted BEFORE the
 * SPA catch-all. They link into the SPA for the booking flow. This exists
 * because the app is a client-rendered SPA, which crawls poorly for
 * programmatic SEO at scale.
 *
 * URL structure:
 *   T1 city hub        /:city                         e.g. /nottingham
 *   T2 service x city  /:city/:service                e.g. /nottingham/gutter-cleaning
 *   T3 job x suburb    /:city/:service/:suburb         e.g. /nottingham/gutter-cleaning/beeston
 */

// ---- Core value types ---------------------------------------------------

export interface SeoCity {
    slug: string;        // "nottingham"
    name: string;        // "Nottingham"
    county: string;      // "Nottinghamshire"
    region: string;      // "East Midlands"
    lat: number;
    lng: number;
    /** City-specific Google review count (separate GBP profile per city). Displayed as "N+". */
    reviewCount: number;
    /** Optional per-city Google reviews URL; falls back to SEO_BRAND.reviewsUrl. */
    reviewsUrl?: string;
}

export interface SeoSuburb {
    slug: string;        // "beeston"
    name: string;        // "Beeston"
    citySlug: string;    // "nottingham"
    postcodeArea?: string; // "NG9"
}

/** Authoritative service identity (the rich copy lives in the content module). */
export interface SeoServiceRef {
    slug: string;        // "gutter-cleaning"
    label: string;       // "Gutter Cleaning"
    deliverability: 'core' | 'sub'; // core = deliver directly; sub = vetted pool (gated)
}

/** Rich, page-ready content for a service (provided by the content module). */
export interface SeoServiceContent extends SeoServiceRef {
    h1Template: string;      // "{service} in {place}" — {place} = suburb or city
    metaTitleTemplate: string;
    metaDescriptionTemplate: string;
    intro: string;           // 2-3 sentences, service-level
    benefits: string[];      // 3-6 bullet points
    faq: { q: string; a: string }[]; // 3-5 Q&A, used for FAQPage schema + visible
    priceFrom?: string;      // "£89" — optional "from" anchor
    /** Concrete example job types for this trade (NO invented prices) — shown as chips in
     *  the pricing block. Makes pricing tangible + gives AI job-type coverage. */
    priceExamples?: string[];
}

// ---- Module interfaces (implemented by ./content and ./render) ----------

/** Implemented in server/seo/content — pure data + lookups, no I/O. */
export interface SeoContentApi {
    getCity(slug: string): SeoCity | undefined;
    listCities(): SeoCity[];
    getService(slug: string): SeoServiceContent | undefined;
    listServices(opts?: { deliverability?: 'core' | 'sub' }): SeoServiceContent[];
    getSuburbs(citySlug: string): SeoSuburb[];
    getSuburb(citySlug: string, suburbSlug: string): SeoSuburb | undefined;
}

export interface RenderResult {
    html: string;
    status: number;       // 200, or 404 for unknown city/service/suburb
    /** true when the page failed the thin-content guard and was set to noindex */
    noindexed?: boolean;
}

/** Implemented in server/seo/render — pure HTML string generation. */
export interface SeoRenderApi {
    renderCityHub(citySlug: string): RenderResult;
    renderServiceCity(citySlug: string, serviceSlug: string): RenderResult;
    renderJobSuburb(citySlug: string, serviceSlug: string, suburbSlug: string): RenderResult;
    renderSitemapXml(publishedByCity?: Map<string, Set<string>>, opts?: { includeSuburbs?: boolean }): string;
}

// ---- Authoritative constants (single source of truth) -------------------

export const SEO_CITIES: SeoCity[] = [
    { slug: 'nottingham', name: 'Nottingham', county: 'Nottinghamshire', region: 'East Midlands', lat: 52.9548, lng: -1.1581, reviewCount: 130 },
    // Derby's own GBP is "Homefix Handyman" (separate brand). These pages are Handy Services,
    // so they show the Handy Services brand review count (130), not Homefix's — honest + policy-safe.
    { slug: 'derby', name: 'Derby', county: 'Derbyshire', region: 'East Midlands', lat: 52.9225, lng: -1.4746, reviewCount: 130 },
    // Expansion targets (competition scan Jul 2026 — docs/SEO-CITY-EXPANSION-SCAN-2026-07.md).
    // Kept UNPUBLISHED (pagePublished=false → noindex, off-sitemap) until a city GBP exists +
    // a crew can service it. reviewCount is a PLACEHOLDER — set to the city's real GBP count before publishing.
    { slug: 'chesterfield', name: 'Chesterfield', county: 'Derbyshire', region: 'East Midlands', lat: 53.2350, lng: -1.4210, reviewCount: 130 },
    { slug: 'grantham', name: 'Grantham', county: 'Lincolnshire', region: 'East Midlands', lat: 52.9120, lng: -0.6400, reviewCount: 130 },
];

/** Core = safe to publish T2/T3 now. Sub = gated behind pool capacity (T2 only, when pagePublished). */
export const SEO_SERVICES: SeoServiceRef[] = [
    { slug: 'handyman', label: 'Handyman', deliverability: 'core' },
    { slug: 'painter-decorator', label: 'Painting & Decorating', deliverability: 'core' },
    { slug: 'gutter-cleaning', label: 'Gutter Cleaning', deliverability: 'core' },
    { slug: 'fencing', label: 'Fencing', deliverability: 'core' },
    { slug: 'plasterer', label: 'Plastering', deliverability: 'core' },
    { slug: 'kitchen-fitting', label: 'Kitchen Fitting', deliverability: 'core' },
    { slug: 'carpenter', label: 'Carpentry', deliverability: 'core' },
    { slug: 'tiler', label: 'Tiling', deliverability: 'core' },
    { slug: 'bathroom-fitting', label: 'Bathroom Fitting', deliverability: 'core' },
    { slug: 'landscaping', label: 'Garden & Landscaping', deliverability: 'core' },
    { slug: 'pressure-washing', label: 'Pressure Washing', deliverability: 'core' },
    { slug: 'decking', label: 'Decking', deliverability: 'core' },
    // Widened universe (24 Jul full-trade sweep) — new core service pages
    { slug: 'fitted-wardrobes', label: 'Fitted Wardrobes', deliverability: 'core' },
    { slug: 'flooring', label: 'Flooring', deliverability: 'core' },
    { slug: 'artificial-grass', label: 'Artificial Grass', deliverability: 'core' },
    { slug: 'garage-door', label: 'Garage Door Repair', deliverability: 'core' },
    { slug: 'roof-cleaning', label: 'Roof Cleaning', deliverability: 'core' },
    { slug: 'loft-boarding', label: 'Loft Boarding', deliverability: 'core' },
    // Regulated / vetted-pool fork — kept out of T3 by default, T2 only when explicitly published
    { slug: 'ev-charger', label: 'EV Charger Installation', deliverability: 'sub' },
    { slug: 'roofer', label: 'Roofing', deliverability: 'sub' },
    { slug: 'locksmith', label: 'Locksmith', deliverability: 'sub' },
    { slug: 'plumber', label: 'Plumbing', deliverability: 'sub' },
    { slug: 'electrician', label: 'Electrical', deliverability: 'sub' },
];

/** Brand facts for server-rendered meta + JSON-LD. Mirror of client BRAND in seo-schema.ts. */
export const SEO_BRAND = {
    name: 'Handy Services',
    url: 'https://www.handyservices.app',
    telephone: '+447449501762',          // public booking line (matches app StickyCTA)
    whatsapp: '447449501762',            // business WhatsApp — the comms number (matches WhatsAppEscape WHATSAPP_NUMBER)
    reviewsUrl: 'https://g.page/r/CaTBbeu5MahxEBM/review', // real Handy Services Google Business reviews (Nottingham GBP)
    ratingValue: '4.9',
    reviewCount: '130',
    insured: '£2M insured',
    priceRange: '££',
    logo: 'https://www.handyservices.app/logo.png',
    // Entity-fusion signal: the site IS the Handy Services Google Business Profile.
    // (Derby's "Homefix Handyman" GBP is a separate brand — deliberately NOT linked.)
    sameAs: ['https://g.page/r/CaTBbeu5MahxEBM'] as string[],
} as const;

/** Thin-content guard: a rendered page must clear these to be indexable. */
export const SEO_THIN_CONTENT = {
    minVisibleWords: 250,
    minFaqItems: 3,
    minInternalLinks: 4,
} as const;
