/**
 * SEO landing-page RENDERER — implements SeoRenderApi.
 *
 * Pure HTML string generation for the three page tiers:
 *   T1  renderCityHub        /:city
 *   T2  renderServiceCity    /:city/:service
 *   T3  renderJobSuburb      /:city/:service/:suburb
 *
 * Plus renderSitemapXml. No I/O, no DB — all data comes from the content
 * module (SeoContentApi). Each page emits full content + meta + JSON-LD in the
 * initial HTML so it is crawlable without JS.
 *
 * DESIGN: pages are brand-matched to the React HandymanLanding page — a navy
 * gradient hero with a trade image, amber CTAs, bold headings, rounded benefit
 * cards, styled FAQ blocks, a high-contrast social-proof band, and an
 * internal-link mesh rendered as chips/cards. Three hero LAYOUT VARIANTS
 * (image-right / full-bleed-overlay / image-left) are picked deterministically
 * from the page slug so neighbouring pages are not visually identical. Content
 * is identical across variants — only the hero/section arrangement differs.
 */

import {
    SeoRenderApi,
    RenderResult,
    SeoCity,
    SeoServiceContent,
    SeoSuburb,
    SEO_BRAND,
    SEO_THIN_CONTENT,
} from './contract';
import { content } from './content';
import { renderLayout, escapeHtml, getTradeHeroImage, OgTag } from './layout';

// ---- small pure helpers -------------------------------------------------

const ORIGIN = SEO_BRAND.url.replace(/\/+$/, '');

function absUrl(path: string): string {
    return `${ORIGIN}/${path.replace(/^\/+/, '')}`;
}

/** First sentence only — a short, punchy hero subhead. The full paragraph lives
 *  in the body (same SEO text, just not crammed into the hero). */
function firstSentence(text: string): string {
    const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
    return m ? m[0].trim() : text;
}

/** Substitute {service}/{place}/{city} tokens in a template string. */
function subst(template: string, v: { service: string; place: string; city: string }): string {
    return template
        .replace(/\{service\}/g, v.service)
        .replace(/\{place\}/g, v.place)
        .replace(/\{city\}/g, v.city);
}

/** Count visible words after stripping tags and entities. */
function visibleWordCount(html: string): number {
    const text = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ');
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Count internal links (href to an app-relative path) in body HTML. */
function internalLinkCount(html: string): number {
    const m = html.match(/href="\/[^"]*"/g);
    return m ? m.length : 0;
}

/**
 * Deterministic hero/section variant from a slug: 'a' (image right),
 * 'b' (full-bleed image with overlay text), or 'c' (image left). Sum of char
 * codes % 3 keeps neighbouring pages visually distinct while a given URL is
 * always the same variant.
 */
type Variant = 'a' | 'b' | 'c';
function pickVariant(slug: string): Variant {
    let sum = 0;
    for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
    return (['a', 'b', 'c'] as const)[sum % 3];
}

// ---- shared UI fragments ------------------------------------------------

/** Inline check-in-circle icon used by benefit cards. */
const CHECK_ICON =
    '<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg></span>';

/** Hero trust strip (on navy): stars + rating, insured, fixed quotes. City-specific review count. */
function heroTrust(_reviewCount?: number): string {
    // Rating + count live in the cred row; these are the trust facts, each with its own icon.
    const svg = (paths: string) => `<svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    const items: { icon: string; label: string }[] = [
        { icon: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'), label: SEO_BRAND.insured },
        { icon: svg('<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4"/><path d="M15 11l2 2 4-4"/>'), label: 'Vetted local team' },
        { icon: svg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.4"/>'), label: 'Fixed quotes' },
        { icon: svg('<circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/>'), label: 'Work guaranteed' },
    ];
    return [
        '                    <ul class="trust-hero">',
        ...items.map((i) => `                        <li>${i.icon} ${escapeHtml(i.label)}</li>`),
        '                    </ul>',
    ].join('\n');
}

/**
 * Full-bleed hero band. Renders a navy gradient BEHIND the trade image so a
 * 404 image still looks intentional. `variant` chooses the arrangement.
 */
/** Quote CTA URL — carries service/city context + UTM attribution to the SPA intake. */
function quoteHref(citySlug: string, serviceSlug?: string, suburbSlug?: string): string {
    const p = new URLSearchParams();
    if (serviceSlug) p.set('service', serviceSlug);
    p.set('city', citySlug);
    if (suburbSlug) p.set('area', suburbSlug);
    p.set('utm_source', 'seo');
    p.set('utm_medium', 'organic');
    p.set('utm_campaign', serviceSlug ? `${serviceSlug}-${citySlug}` : citySlug);
    return `/?${p.toString()}`;
}

/** Contextual WhatsApp link for the Ben sticky — includes the source page so Ben knows where it came from. */
function waLink(placeLabel: string, serviceLabel?: string, sourceUrl?: string): string {
    const svc = serviceLabel ? serviceLabel.toLowerCase() : 'your handyman service';
    let text = `Hi, I have a question about ${svc} in ${placeLabel}`;
    if (sourceUrl) text += ` (via ${sourceUrl})`;
    return `https://wa.me/${SEO_BRAND.whatsapp}?text=${encodeURIComponent(text)}`;
}

/** The real team, mirroring the React landing's "Meet your handymen" cluster. */
const HERO_TEAM: { src: string; name: string }[] = [
    { src: '/assets/avatars/craig-avatar-1.webp', name: 'Craig' },
    { src: '/assets/quote-images/joe-estimator.webp', name: 'Joe' },
    { src: '/assets/avatars/emile-avatar-1.webp', name: 'Emile' },
    { src: '/assets/avatars/bezent-avatar-1.webp', name: 'Bezent' },
];

/**
 * Compact credibility row — real team faces + names + rating in ONE tidy block.
 * Replaces the old stacked (reviews strip + "Meet your handymen" pill + avatars
 * + names), which was too heavy above the headline.
 */
function compactCred(reviewCount: number): string {
    const avatars = HERO_TEAM.map(
        (t) =>
            `                            <img src="${escapeHtml(t.src)}" alt="${escapeHtml(t.name)}" width="40" height="40" loading="lazy" decoding="async">`,
    ).join('\n');
    return [
        '                    <div class="team">',
        '                        <div class="team-ava">',
        avatars,
        '                        </div>',
        '                        <div class="team-meta">',
        '                            <p class="team-names"><b>Craig, Joe</b> &amp; the local team</p>',
        `                            <p class="team-rev"><span class="rstars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span> <b>${escapeHtml(SEO_BRAND.ratingValue)}</b> &middot; ${reviewCount}+ Google reviews</p>`,
        '                        </div>',
        '                    </div>',
    ].join('\n');
}

/**
 * Hero — cloned from the React landing's look: amber reviews strip, real team
 * ("Meet your handymen") avatar cluster, bold H1, subhead, amber + WhatsApp
 * CTAs, and the per-trade image as a crisp card (no muddy full-bleed scrim).
 * Split layout on desktop; stacks (capped image on top) on mobile.
 */
function heroSection(opts: {
    variant: Variant;
    eyebrow: string;
    h1: string;
    intro: string;
    imageSrc: string;
    imageAlt: string;
    reviewCount: number;
}): string {
    const { eyebrow, h1, intro, imageSrc, imageAlt, reviewCount } = opts;
    const img = escapeHtml(imageSrc);
    const alt = escapeHtml(imageAlt);
    const waText = `Hi, I'd like a free quote — ${eyebrow}`;
    const wa = `https://wa.me/${SEO_BRAND.whatsapp}?text=${encodeURIComponent(waText)}`;
    const copy = [
        `                    <p class="eyebrow">${escapeHtml(eyebrow)}</p>`,
        `                    <h1>${escapeHtml(h1)}</h1>`,
        `                    <p class="lede">${escapeHtml(firstSentence(intro))}</p>`,
        compactCred(reviewCount),
        '                    <div class="hero-cta">',
        '                        <a class="btn btn-amber btn-arrow" href="/">Get a free quote</a>',
        `                        <a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a>`,
        '                    </div>',
        heroTrust(reviewCount),
    ].join('\n');

    return [
        '        <section class="hero hero-split">',
        '            <div class="container hero-inner">',
        '                <div class="hero-copy">',
        copy,
        '                </div>',
        '                <div class="hero-media">',
        `                    <img class="hero-img" src="${img}" alt="${alt}" width="880" height="660" loading="eager" decoding="async">`,
        '                </div>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/** Benefit list -> rounded cards with green check icons. */
function benefitsCards(
    benefits: string[],
    v: { service: string; place: string; city: string },
    heading = 'Why choose us',
): string {
    if (!benefits.length) return '';
    const items = benefits
        .map(
            (b) =>
                `                    <li>${CHECK_ICON}<span class="txt">${escapeHtml(subst(b, v))}</span></li>`,
        )
        .join('\n');
    return [
        '        <section class="block">',
        '            <div class="container">',
        `                <h2>${escapeHtml(heading)}</h2>`,
        '                <ul class="cards">',
        items,
        '                </ul>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/**
 * Two universal, objection-killing FAQs appended to every service page. They
 * cover the questions that convert (speed + is-it-really-fixed) without
 * duplicating the trade-specific FAQs, and are answer-shaped for AI engines.
 * {service}/{place} tokens are substituted per page so each renders uniquely.
 */
const UNIVERSAL_FAQS: { q: string; a: string }[] = [
    { q: 'How quickly can you start {service} in {place}?', a: 'Most {place} jobs are booked within a few days, and urgent work is often same-week. Tell us your ideal date when you enquire and we\'ll confirm the soonest slot — with a text before we\'re on our way.' },
    { q: 'Is the quote free, and is the price really fixed?', a: 'Yes to both. Quotes are free with no obligation, and the price is fixed and agreed in writing before any work starts — no call-out charge and no hourly-rate surprises.' },
];

/** Trade-specific FAQs + the two universal ones — used for both the visible block and the schema. */
function pageFaqs(service: SeoServiceContent): { q: string; a: string }[] {
    return [...service.faq, ...UNIVERSAL_FAQS];
}

/** FAQ -> styled Q&A blocks. */
function faqBlocks(
    faq: { q: string; a: string }[],
    v: { service: string; place: string; city: string },
): string {
    if (!faq.length) return '';
    const items = faq
        .map(
            (f) =>
                [
                    '                    <div class="qa">',
                    `                        <dt>${escapeHtml(subst(f.q, v))}</dt>`,
                    `                        <dd>${escapeHtml(subst(f.a, v))}</dd>`,
                    '                    </div>',
                ].join('\n'),
        )
        .join('\n');
    return [
        '        <section class="block">',
        '            <div class="container">',
        '                <h2>Frequently asked questions</h2>',
        '                <dl class="faq">',
        items,
        '                </dl>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/**
 * Brand-level "How it works" — the same 4 steps for every trade. Numbered
 * icon circles, great for AI/answer-engine extraction. Rendered on a soft band.
 */
function howItWorksSection(): string {
    const steps: { t: string; d: string }[] = [
        { t: 'Tell us the job', d: 'Send a few details and photos in minutes — online or over the phone. No site visit needed to get started.' },
        { t: 'Get a fixed quote', d: 'We come back with a clear, itemised price — usually the same day. No hourly-rate surprises, no call-out charge.' },
        { t: 'We turn up on time', d: 'A vetted, insured local tradesperson arrives in the agreed window and gets straight to work.' },
        { t: 'Job done, guaranteed', d: 'You get before-and-after photos and a tidy finish, backed by our work guarantee. Not right? We put it right.' },
    ];
    const items = steps
        .map(
            (s, i) =>
                [
                    '                    <li>',
                    `                        <div class="n" aria-hidden="true">${i + 1}</div>`,
                    `                        <h3>${escapeHtml(s.t)}</h3>`,
                    `                        <p>${escapeHtml(s.d)}</p>`,
                    '                    </li>',
                ].join('\n'),
        )
        .join('\n');
    return [
        '        <section class="block navy">',
        '            <div class="container">',
        '                <p class="kicker">Simple from start to finish</p>',
        '                <h2>How it works</h2>',
        '                <p class="section-lead">Four steps from your first message to a finished job you are happy with.</p>',
        '                <ol class="steps">',
        items,
        '                </ol>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/**
 * Pricing block — big "from £X" anchor, a scannable "what's included" list
 * (derived from the service benefits), and a one-line "what affects the price"
 * note. AEO-friendly. Only rendered when the service has a priceFrom anchor.
 */
function pricingSection(
    service: SeoServiceContent,
    placeName: string,
    v: { service: string; place: string; city: string },
): string {
    if (!service.priceFrom) return '';
    const label = service.label.toLowerCase();
    const source = service.benefits.length
        ? service.benefits
        : [
              'A fixed price agreed before any work starts',
              'Vetted, insured local tradespeople',
              'Tidy finish with before-and-after photos',
              'Every job backed by our work guarantee',
          ];
    const included = source
        .slice(0, 4)
        .map(
            (b) =>
                `                            <li>${CHECK_ICON}<span>${escapeHtml(subst(b, v))}</span></li>`,
        )
        .join('\n');
    // Concrete example job types (no invented prices) — makes pricing tangible + AI-friendly.
    const examples =
        service.priceExamples && service.priceExamples.length
            ? [
                  '                <div class="jobex">',
                  `                    <p class="jobex-h">Common ${escapeHtml(label)} jobs we quote in ${escapeHtml(placeName)}:</p>`,
                  '                    <ul class="jobchips">',
                  ...service.priceExamples.map(
                      (j) => `                        <li>${escapeHtml(subst(j, v))}</li>`,
                  ),
                  '                    </ul>',
                  '                </div>',
              ].join('\n')
            : '';
    return [
        '        <section class="block soft">',
        '            <div class="container">',
        '                <p class="kicker">Transparent pricing</p>',
        `                <h2>Typical ${escapeHtml(label)} prices in ${escapeHtml(placeName)}</h2>`,
        `                <p class="section-lead">Every quote is fixed and agreed up front, so the price we give is the price you pay.</p>`,
        '                <div class="pricing">',
        '                    <div class="anchor">',
        '                        <div class="rel">',
        '                            <div class="from">From</div>',
        `                            <div class="amt">${escapeHtml(service.priceFrom)}</div>`,
        `                            <p class="note">Typical starting price for ${escapeHtml(label)} in ${escapeHtml(placeName)}. You get an exact fixed quote before booking.</p>`,
        '                        </div>',
        '                    </div>',
        '                    <div class="incl">',
        "                        <h3>What's included</h3>",
        '                        <ul>',
        included,
        '                        </ul>',
        `                        <p class="affects"><b>What affects the price:</b> the size of the property, ease of access, and the condition and scope of the ${escapeHtml(label)} work. We factor it all into one fixed quote.</p>`,
        '                    </div>',
        '                </div>',
        examples,
        '            </div>',
        '        </section>',
    ].filter(Boolean).join('\n');
}

/**
 * Reviews — honest social proof. We do NOT invent testimonials; this shows the
 * real aggregate rating and links straight to the live Google reviews.
 */
function reviewsSection(placeName: string, reviewCount: number, reviewsUrl: string): string {
    const url = escapeHtml(reviewsUrl);
    return [
        '        <section class="block">',
        '            <div class="container">',
        '                <div class="grev">',
        '                    <div class="grev-badge">',
        '                        <div class="rstars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>',
        `                        <div class="grev-num">${escapeHtml(SEO_BRAND.ratingValue)} / 5</div>`,
        `                        <div class="grev-count">${reviewCount}+ Google reviews</div>`,
        '                    </div>',
        '                    <div class="grev-copy">',
        '                        <p class="kicker">What our customers say</p>',
        '                        <h2>Real reviews, not marketing</h2>',
        `                        <p>We don't write our own testimonials. See exactly what homeowners across ${escapeHtml(placeName)} and the wider area say about ${escapeHtml(SEO_BRAND.name)} — straight from Google.</p>`,
        `                        <a class="grev-btn" href="${url}" target="_blank" rel="noopener">Read our Google reviews</a>`,
        '                    </div>',
        '                </div>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/** High-contrast trust-score band built from SEO_BRAND facts. */
function socialProofBand(placeName: string, reviewCount: number, reviewsUrl: string): string {
    return [
        '        <section class="block">',
        '            <div class="container">',
        '                <div class="proof">',
        '                    <div class="in">',
        '                        <div class="score">',
        `                            <div class="num">${escapeHtml(SEO_BRAND.ratingValue)}</div>`,
        '                            <div class="stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>',
        `                            <a class="rc" href="${escapeHtml(reviewsUrl)}" target="_blank" rel="noopener">${reviewCount}+ Google reviews &rsaquo;</a>`,
        '                        </div>',
        '                        <div>',
        `                            <p class="say">The reliable, fixed-price way to get jobs done around your home in ${escapeHtml(placeName)}.</p>`,
        '                            <ul class="facts">',
        `                                <li><span class="tick">&#10003;</span> ${escapeHtml(SEO_BRAND.insured)}</li>`,
        '                                <li><span class="tick">&#10003;</span> Vetted local team</li>',
        '                                <li><span class="tick">&#10003;</span> No call-out charge</li>',
        '                                <li><span class="tick">&#10003;</span> Work guaranteed</li>',
        '                            </ul>',
        '                        </div>',
        '                    </div>',
        '                </div>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/** Big navy CTA band. */
function ctaBlock(headline: string, sub: string): string {
    return [
        '        <section class="block">',
        '            <div class="container">',
        '                <div class="cta">',
        '                    <div class="in">',
        `                        <h2>${escapeHtml(headline)}</h2>`,
        `                        <p>${escapeHtml(sub)}</p>`,
        '                        <a class="btn btn-amber btn-arrow" href="/">Get a free quote</a>',
        '                    </div>',
        '                </div>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

/** Prose section (localised copy paragraphs + optional price line). */
function proseSection(paragraphs: string[]): string {
    if (!paragraphs.length) return '';
    return [
        '        <section class="block">',
        '            <div class="container prose">',
        ...paragraphs,
        '            </div>',
        '        </section>',
    ].join('\n');
}

/** Internal-link mesh as chips (nearby suburbs) or a card grid (other trades). */
function linkMeshSection(
    heading: string,
    intro: string | null,
    links: { href: string; label: string }[],
    style: 'chips' | 'linkgrid',
): string {
    if (!links.length) return '';
    const items = links
        .map(
            (l) =>
                `                    <li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`,
        )
        .join('\n');
    return [
        '        <section class="block">',
        '            <div class="container">',
        `                <h2>${escapeHtml(heading)}</h2>`,
        intro ? `                <p class="section-lead">${escapeHtml(intro)}</p>` : '',
        `                <ul class="${style}">`,
        items,
        '                </ul>',
        '            </div>',
        '        </section>',
    ]
        .filter(Boolean)
        .join('\n');
}

// ---- JSON-LD builders ---------------------------------------------------

function localBusinessLd(city: SeoCity, placeName?: string): Record<string, unknown> {
    const areaServed: Record<string, unknown>[] = [
        { '@type': 'City', name: city.name },
        { '@type': 'AdministrativeArea', name: city.county },
    ];
    if (placeName && placeName !== city.name) {
        areaServed.unshift({ '@type': 'Place', name: `${placeName}, ${city.name}` });
    }
    return {
        '@context': 'https://schema.org',
        '@type': 'HomeAndConstructionBusiness',
        name: SEO_BRAND.name,
        url: SEO_BRAND.url,
        image: SEO_BRAND.logo,
        logo: SEO_BRAND.logo,
        ...(SEO_BRAND.telephone ? { telephone: SEO_BRAND.telephone } : {}),
        priceRange: SEO_BRAND.priceRange,
        address: {
            '@type': 'PostalAddress',
            addressLocality: city.name,
            addressRegion: city.county,
            addressCountry: 'GB',
        },
        geo: {
            '@type': 'GeoCoordinates',
            latitude: city.lat,
            longitude: city.lng,
        },
        areaServed,
        // No aggregateRating: Google disallows self-serving review markup for a
        // business on its own site (reviews live on Google, not on-page). The
        // visible star badge + "Read our Google reviews" link carry the proof.
        ...(SEO_BRAND.sameAs.length ? { sameAs: SEO_BRAND.sameAs } : {}),
    };
}

function serviceLd(
    serviceName: string,
    areaName: string,
    description: string,
): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: serviceName,
        serviceType: serviceName,
        description,
        areaServed: { '@type': 'Place', name: areaName },
        provider: {
            '@type': 'HomeAndConstructionBusiness',
            name: SEO_BRAND.name,
            url: SEO_BRAND.url,
        },
    };
}

function faqLd(faq: { q: string; a: string }[], v: { service: string; place: string; city: string }): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
            '@type': 'Question',
            name: subst(f.q, v),
            acceptedAnswer: { '@type': 'Answer', text: subst(f.a, v) },
        })),
    };
}

function breadcrumbLd(trail: { name: string; url: string }[]): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((t, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: t.name,
            item: t.url,
        })),
    };
}

// ---- 404 ----------------------------------------------------------------

function notFound(): RenderResult {
    const bodyHtml = [
        '        <section class="block">',
        '            <div class="container prose">',
        '                <h1 style="color:var(--navy)">Page not found</h1>',
        "                <p>Sorry, we couldn't find that page. <a href=\"/\">Return to Handy Services</a> to get a free quote.</p>",
        '            </div>',
        '        </section>',
    ].join('\n');
    const html = renderLayout({
        title: `Page not found | ${SEO_BRAND.name}`,
        metaDescription: 'The page you were looking for could not be found.',
        canonicalUrl: SEO_BRAND.url,
        bodyHtml,
        noindex: true,
    });
    return { html, status: 404 };
}

/** Assemble the final RenderResult, applying the thin-content guard. */
function finalize(
    parts: {
        title: string;
        metaDescription: string;
        canonicalUrl: string;
        ogTags?: OgTag[];
        jsonLdBlocks: unknown[];
        bodyHtml: string;
        imageUrl?: string;
        ctaHref?: string;
        waHref?: string;
        reviewCount?: number;
        /** Rollout gate: when true, force noindex regardless of content depth. */
        forceNoindex?: boolean;
    },
    faqCount: number,
): RenderResult {
    const words = visibleWordCount(parts.bodyHtml);
    const links = internalLinkCount(parts.bodyHtml);
    const thin =
        words < SEO_THIN_CONTENT.minVisibleWords ||
        faqCount < SEO_THIN_CONTENT.minFaqItems ||
        links < SEO_THIN_CONTENT.minInternalLinks;
    const noindex = thin || parts.forceNoindex === true;

    // Point the in-body "Get a free quote" buttons (hero + CTA band) at the
    // context-carrying quote URL, in one place.
    const bodyHtml = parts.ctaHref
        ? parts.bodyHtml.split('class="btn btn-amber btn-arrow" href="/"')
              .join(`class="btn btn-amber btn-arrow" href="${escapeHtml(parts.ctaHref)}"`)
        : parts.bodyHtml;

    const html = renderLayout({
        title: parts.title,
        metaDescription: parts.metaDescription,
        canonicalUrl: parts.canonicalUrl,
        ogTags: parts.ogTags,
        jsonLdBlocks: parts.jsonLdBlocks,
        bodyHtml,
        noindex,
        imageUrl: parts.imageUrl,
        ctaHref: parts.ctaHref,
        waHref: parts.waHref,
        reviewCount: parts.reviewCount,
    });

    return { html, status: 200, noindexed: noindex };
}

// ---- T1: city hub -------------------------------------------------------

export function renderCityHub(citySlug: string): RenderResult {
    const city = content.getCity(citySlug);
    if (!city) return notFound();

    const coreServices = content.listServices({ deliverability: 'core' });
    const suburbs = content.getSuburbs(citySlug);
    const canonical = absUrl(citySlug);
    const variant = pickVariant(citySlug);

    const title = `Handyman & Home Services in ${city.name} | ${SEO_BRAND.name}`;
    const metaDescription = `Trusted handyman, painting, gutter cleaning and home improvement services across ${city.name}, ${city.county}. ${SEO_BRAND.insured}, ${SEO_BRAND.ratingValue}-star rated. Get a free fixed quote.`;

    const hero = heroSection({
        variant,
        eyebrow: `${city.name} · ${city.county}`,
        h1: `Handyman & Home Services in ${city.name}`,
        intro: `Reliable local tradespeople for every job around your home in ${city.name} and across ${city.county}. One call, fixed quote, work guaranteed.`,
        imageSrc: getTradeHeroImage('handyman'),
        imageAlt: `Handyman services in ${city.name}`,
        reviewCount: city.reviewCount,
    });

    const intro = proseSection([
        `                <p>From a leaking gutter to a full kitchen fit, ${escapeHtml(SEO_BRAND.name)} brings vetted, insured tradespeople to homes throughout ${escapeHtml(city.name)}. We give you a clear fixed price up front, turn up when we say we will, and stand behind every job we complete. No hourly-rate surprises and no call-out charge.</p>`,
    ]);

    const serviceMesh = linkMeshSection(
        `Our services in ${city.name}`,
        `One trusted team for every trade around your home in ${city.name}.`,
        coreServices.map((s) => ({
            href: `/${citySlug}/${s.slug}`,
            label: `${s.label} in ${city.name}`,
        })),
        'linkgrid',
    );

    // Suburb links point at the flagship "handyman" T3 page for each area.
    const suburbMesh = linkMeshSection(
        `Areas we cover around ${city.name}`,
        null,
        suburbs.slice(0, 12).map((sub) => ({
            href: `/${citySlug}/handyman/${sub.slug}`,
            label: sub.name,
        })),
        'chips',
    );

    const bodyHtml = [
        hero,
        intro,
        howItWorksSection(),
        serviceMesh,
        reviewsSection(city.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        socialProofBand(city.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        suburbMesh,
        ctaBlock(
            `Get a fixed quote in ${city.name}`,
            'Tell us about your job and we will send a clear, no-obligation price. Most quotes back the same day.',
            city.slug,
        ),
    ]
        .filter(Boolean)
        .join('\n');

    const jsonLdBlocks = [
        localBusinessLd(city),
        breadcrumbLd([
            { name: SEO_BRAND.name, url: SEO_BRAND.url },
            { name: city.name, url: canonical },
        ]),
    ];

    return finalize(
        {
            title,
            metaDescription,
            canonicalUrl: canonical,
            jsonLdBlocks,
            bodyHtml,
            imageUrl: absUrl(getTradeHeroImage('handyman')),
            ctaHref: quoteHref(citySlug),
            waHref: waLink(city.name, undefined, canonical),
            reviewCount: city.reviewCount,
        },
        // City hub has no service FAQ; treat as satisfying the FAQ minimum so
        // the guard keys off word count + link count for hubs.
        SEO_THIN_CONTENT.minFaqItems,
    );
}

// ---- T2: service x city -------------------------------------------------

export function renderServiceCity(
    citySlug: string,
    serviceSlug: string,
    opts?: { indexable?: boolean },
): RenderResult {
    const city = content.getCity(citySlug);
    const service = content.getService(serviceSlug);
    if (!city || !service) return notFound();

    const v = { service: service.label, place: city.name, city: city.name };
    const canonical = absUrl(`${citySlug}/${serviceSlug}`);
    const variant = pickVariant(`${citySlug}/${serviceSlug}`);

    const title = subst(service.metaTitleTemplate, v);
    const metaDescription = subst(service.metaDescriptionTemplate, v);
    const h1 = subst(service.h1Template, v);
    const intro = subst(service.intro, v);

    const suburbs = content.getSuburbs(citySlug);
    const siblings = content
        .listServices({ deliverability: 'core' })
        .filter((s) => s.slug !== service.slug);

    const hero = heroSection({
        variant,
        eyebrow: `${service.label} · ${city.name}`,
        h1,
        intro,
        imageSrc: getTradeHeroImage(serviceSlug),
        imageAlt: `${service.label} in ${city.name}`,
        reviewCount: city.reviewCount,
    });

    const introSection = proseSection([
        `                <p>${escapeHtml(intro)}</p>`,
        `                <p>Whether it is a quick fix or a full project, ${escapeHtml(SEO_BRAND.name)} matches you with vetted, insured ${escapeHtml(service.label.toLowerCase())} specialists working right across ${escapeHtml(city.name)}. You get a fixed price agreed up front, a tradesperson who turns up when they say they will, and a finish that is guaranteed.</p>`,
        `                <p><a href="/${escapeHtml(citySlug)}">All ${escapeHtml(city.name)} services</a> &middot; ${escapeHtml(SEO_BRAND.insured)} &middot; work guaranteed.</p>`,
    ]);

    const suburbMesh = linkMeshSection(
        `${service.label} in your area`,
        `We cover ${service.label.toLowerCase()} jobs right across ${city.name}. Choose your neighbourhood:`,
        suburbs.map((sub) => ({
            href: `/${citySlug}/${serviceSlug}/${sub.slug}`,
            label: `${service.label} in ${sub.name}`,
        })),
        'chips',
    );

    const siblingMesh = linkMeshSection(
        `Other services in ${city.name}`,
        null,
        siblings.map((s) => ({
            href: `/${citySlug}/${s.slug}`,
            label: `${s.label} in ${city.name}`,
        })),
        'linkgrid',
    );

    const faq = pageFaqs(service);
    const bodyHtml = [
        hero,
        introSection,
        howItWorksSection(),
        benefitsCards(service.benefits, v),
        pricingSection(service, city.name, v),
        // Mid-page CTA — catch the visitor the moment the price convinces them.
        ctaBlock(
            `Ready for a fixed ${service.label.toLowerCase()} price in ${city.name}?`,
            'Send a photo and a few details — most quotes come back the same day, with no obligation.',
        ),
        reviewsSection(city.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        socialProofBand(city.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        faqBlocks(faq, v),
        suburbMesh,
        siblingMesh,
        ctaBlock(
            `Book ${service.label.toLowerCase()} in ${city.name}`,
            'Send us the details and we will come back with a clear fixed price, usually the same day.',
            citySlug,
        ),
    ]
        .filter(Boolean)
        .join('\n');

    const jsonLdBlocks = [
        localBusinessLd(city),
        serviceLd(`${service.label} in ${city.name}`, city.name, intro),
        faqLd(faq, v),
        breadcrumbLd([
            { name: SEO_BRAND.name, url: SEO_BRAND.url },
            { name: city.name, url: absUrl(citySlug) },
            { name: service.label, url: canonical },
        ]),
    ];

    return finalize(
        {
            title,
            metaDescription,
            canonicalUrl: canonical,
            jsonLdBlocks,
            bodyHtml,
            imageUrl: absUrl(getTradeHeroImage(serviceSlug)),
            ctaHref: quoteHref(citySlug, serviceSlug),
            waHref: waLink(city.name, service.label, canonical),
            reviewCount: city.reviewCount,
            // Rollout gate: T2 is indexable only when its trade is published.
            forceNoindex: opts?.indexable === false,
        },
        faq.length,
    );
}

// ---- T3: job x suburb ---------------------------------------------------

export function renderJobSuburb(
    citySlug: string,
    serviceSlug: string,
    suburbSlug: string,
    opts?: { indexable?: boolean },
): RenderResult {
    const city = content.getCity(citySlug);
    const service = content.getService(serviceSlug);
    const suburb = content.getSuburb(citySlug, suburbSlug);
    if (!city || !service || !suburb) return notFound();

    const v = { service: service.label, place: suburb.name, city: city.name };
    const canonical = absUrl(`${citySlug}/${serviceSlug}/${suburbSlug}`);
    const variant = pickVariant(`${citySlug}/${serviceSlug}/${suburbSlug}`);

    const title = subst(service.metaTitleTemplate, v);
    const metaDescription = subst(service.metaDescriptionTemplate, v);
    const h1 = subst(service.h1Template, v);
    const intro = subst(service.intro, v);

    const nearby: SeoSuburb[] = content
        .getSuburbs(citySlug)
        .filter((s) => s.slug !== suburb.slug);
    const otherServices: SeoServiceContent[] = content
        .listServices({ deliverability: 'core' })
        .filter((s) => s.slug !== service.slug);

    const hero = heroSection({
        variant,
        eyebrow: `${service.label} · ${suburb.name}, ${city.name}`,
        h1,
        intro,
        imageSrc: getTradeHeroImage(serviceSlug),
        imageAlt: `${service.label} in ${suburb.name}`,
        reviewCount: city.reviewCount,
    });

    const localised = proseSection([
        `                <p>${escapeHtml(intro)}</p>`,
        `                <p>Looking for a reliable ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(suburb.name)}? ${escapeHtml(SEO_BRAND.name)} covers ${escapeHtml(suburb.name)}${suburb.postcodeArea ? ` (${escapeHtml(suburb.postcodeArea)})` : ''} and the surrounding ${escapeHtml(city.name)} area. Our tradespeople know the local streets and housing, turn up on time, and give you a fixed price before starting so there are no surprises.</p>`,
        `                <p>Whether it is a small repair or a bigger project in ${escapeHtml(suburb.name)}, you get the same promise every time: a clear quote, ${escapeHtml(SEO_BRAND.insured)} cover, and a job that is not finished until you are happy with it.</p>`,
        `                <p><a href="/${escapeHtml(citySlug)}/${escapeHtml(serviceSlug)}">All ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(city.name)}</a> &middot; <a href="/${escapeHtml(citySlug)}">${escapeHtml(city.name)} home services</a></p>`,
    ]);

    const coverageLine = `We cover ${service.label.toLowerCase()} across ${suburb.name}${suburb.postcodeArea ? ` and the ${suburb.postcodeArea} postcode area` : ''} — and every neighbouring part of ${city.name}:`;

    const nearbyMesh = linkMeshSection(
        `${service.label} near ${suburb.name}`,
        coverageLine,
        nearby.slice(0, 12).map((s) => ({
            href: `/${citySlug}/${serviceSlug}/${s.slug}`,
            label: `${service.label} in ${s.name}`,
        })),
        'chips',
    );

    const otherServicesMesh = linkMeshSection(
        `Other trades in ${suburb.name}`,
        null,
        otherServices.slice(0, 12).map((s) => ({
            href: `/${citySlug}/${s.slug}/${suburbSlug}`,
            label: `${s.label} in ${suburb.name}`,
        })),
        'linkgrid',
    );

    const faq = pageFaqs(service);
    const bodyHtml = [
        hero,
        localised,
        howItWorksSection(),
        benefitsCards(service.benefits, v),
        pricingSection(service, suburb.name, v),
        // Mid-page CTA — catch the visitor the moment the price convinces them.
        ctaBlock(
            `Ready for a fixed ${service.label.toLowerCase()} price in ${suburb.name}?`,
            'Send a photo and a few details — most quotes come back the same day, with no obligation.',
        ),
        reviewsSection(suburb.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        socialProofBand(suburb.name, city.reviewCount, city.reviewsUrl ?? SEO_BRAND.reviewsUrl),
        faqBlocks(faq, v),
        nearbyMesh,
        otherServicesMesh,
        ctaBlock(
            `Book ${service.label.toLowerCase()} in ${suburb.name}`,
            `Tell us about your job in ${suburb.name} and we will send a fixed quote, usually the same day.`,
            citySlug,
        ),
    ]
        .filter(Boolean)
        .join('\n');

    const jsonLdBlocks = [
        localBusinessLd(city, suburb.name),
        serviceLd(`${service.label} in ${suburb.name}`, `${suburb.name}, ${city.name}`, intro),
        faqLd(faq, v),
        breadcrumbLd([
            { name: SEO_BRAND.name, url: SEO_BRAND.url },
            { name: city.name, url: absUrl(citySlug) },
            { name: service.label, url: absUrl(`${citySlug}/${serviceSlug}`) },
            { name: suburb.name, url: canonical },
        ]),
    ];

    return finalize(
        {
            title,
            metaDescription,
            canonicalUrl: canonical,
            jsonLdBlocks,
            bodyHtml,
            imageUrl: absUrl(getTradeHeroImage(serviceSlug)),
            ctaHref: quoteHref(citySlug, serviceSlug, suburbSlug),
            waHref: waLink(suburb.name, service.label, canonical),
            reviewCount: city.reviewCount,
            // Rollout gate: suburb pages ship as noindex,follow until enriched.
            forceNoindex: opts?.indexable === false,
        },
        faq.length,
    );
}

// ---- sitemap ------------------------------------------------------------

export function renderSitemapXml(
    publishedServiceSlugs?: string[],
    opts?: { includeSuburbs?: boolean },
): string {
    const cities = content.listCities();
    const coreServices = content.listServices({ deliverability: 'core' });
    const includeSuburbs = opts?.includeSuburbs === true;

    const allowService = (slug: string): boolean =>
        !publishedServiceSlugs || publishedServiceSlugs.includes(slug);

    const urls: string[] = [];
    const push = (loc: string) => {
        urls.push(`    <url><loc>${escapeHtml(loc)}</loc></url>`);
    };

    // Standard marketing landing pages (the React app's core pages). Listed so
    // Google discovers them too — the SEO city/service pages are additive to these.
    // NB: '' = homepage; /derby is emitted below as a city hub, so not repeated here.
    const STANDARD_PAGES = ['', 'property-managers', 'businesses', 'cleaning'];
    for (const p of STANDARD_PAGES) push(absUrl(p));

    for (const city of cities) {
        // T1 city hub
        push(absUrl(city.slug));

        const suburbs = content.getSuburbs(city.slug);
        for (const service of coreServices) {
            if (!allowService(service.slug)) continue;
            // T2 service x city
            push(absUrl(`${city.slug}/${service.slug}`));
            // T3 service x city x suburb — only when suburb pages are indexable
            // (they ship noindex during rollout, so are kept out of the sitemap).
            if (includeSuburbs) {
                for (const sub of suburbs) {
                    push(absUrl(`${city.slug}/${service.slug}/${sub.slug}`));
                }
            }
        }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

// ---- public api ---------------------------------------------------------

export const render: SeoRenderApi = {
    renderCityHub,
    renderServiceCity,
    renderJobSuburb,
    renderSitemapXml,
};

export default render;
