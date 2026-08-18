/**
 * Post theme rotation for the automated GMB posting system.
 *
 * Each theme is an ANGLE, not a template — the generator hands the theme
 * brief plus the brand-voice files to Claude and lets the voice do the work.
 * Rotation picks the least-recently-used theme (per location) so the profile
 * never reads like a scheduler wrote it.
 */

const BASE_URL = (process.env.BASE_URL || 'https://www.handyservices.app').replace(/\/$/, '');

export interface PostTheme {
    key: string;
    /** Brief handed to the LLM — the angle, not the words. */
    brief: string;
    /** Optional per-theme detail values, one is picked per post (LRU within theme). */
    details?: string[];
    ctaType: 'LEARN_MORE' | 'BOOK' | 'CALL';
    ctaUrl?: string;
    /** Candidate images (public URLs); one is rotated in. Empty = text-only post. */
    images?: string[];
}

const img = (file: string) => `${BASE_URL}/assets/quote-images/${file}`;

/** Trade detail → matching image from the quote image library (Craig set — he's the face). */
const SERVICE_IMAGES: Record<string, string> = {
    'flat-pack furniture assembly': img('craig-flatpack.webp'),
    'TV wall mounting': img('craig-tv-mount.webp'),
    'bathroom resealing (silicone)': img('bathroom-seal.webp'),
    'door repairs and adjustments': img('door-greeting.webp'),
    'fence panel repairs': img('craig-fence.webp'),
    'gutter clearing': img('craig-gutter.webp'),
    'painting touch-ups': img('craig-painting.webp'),
    'tiling repairs': img('craig-tiling.webp'),
    'light fitting replacement': img('craig-light.webp'),
};

export const THEMES: PostTheme[] = [
    {
        key: 'service_spotlight',
        brief: 'Spotlight ONE specific service. Make the job feel small-and-sorted: what it is, that we do it properly, roughly how quick it is. No price unless the voice files say to.',
        details: Object.keys(SERVICE_IMAGES),
        ctaType: 'BOOK',
        ctaUrl: BASE_URL,
        images: [],  // resolved per-detail via serviceImage()
    },
    {
        key: 'seasonal_tip',
        brief: 'One genuinely useful home-maintenance tip for the CURRENT month in the East Midlands (the generator injects the date). Lead with the tip — the reader should get value even if they never call us. Soft close only.',
        ctaType: 'LEARN_MORE',
        ctaUrl: BASE_URL,
    },
    {
        key: 'proof_point',
        brief: 'One trust proof, concrete not braggy: photo proof on completion, turning up when we said, fixed price before we start, £2M insured, the come-back-free-if-not-right promise. Pick ONE and make it vivid.',
        ctaType: 'LEARN_MORE',
        ctaUrl: BASE_URL,
        images: [img('craig-guarantee.webp')],
    },
    {
        key: 'faq_buster',
        brief: 'Answer ONE question customers actually ask before booking. Answer it straight, no salesy pivot.',
        details: [
            'Do you charge a call-out fee?',
            'Is my job too small to bother you with?',
            'How does quoting work — do you need to visit first?',
            'Can you fit around tenants / can I not be there?',
            'How far do you cover from Nottingham?',
        ],
        ctaType: 'LEARN_MORE',
        ctaUrl: BASE_URL,
    },
    {
        key: 'landlord_corner',
        brief: 'Speak to landlords and property managers: you do not need to be there — tenant coordination, photo report, tax-ready invoice. One angle per post, not the whole list.',
        ctaType: 'BOOK',
        ctaUrl: BASE_URL,
        images: [img('cleaner-older-person-door.webp')],
    },
    {
        key: 'local_area',
        brief: 'A grounded "out and about" post naming a real Nottingham-area neighbourhood (West Bridgford, Beeston, Sherwood, Mapperley, Arnold, Wollaton...) and the kind of jobs we do there. Keep it neighbourly, never fake a specific job we did not do.',
        ctaType: 'CALL',
    },
];

export function serviceImage(detail: string): string | undefined {
    return SERVICE_IMAGES[detail];
}

export function themeByKey(key: string): PostTheme | undefined {
    return THEMES.find((t) => t.key === key);
}
