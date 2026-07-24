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

/** Hero trust strip (on navy): stars + rating, insured, fixed quotes. */
const heroTrust = [
    '                    <ul class="trust-hero">',
    `                        <li><span class="stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span> <b>${escapeHtml(SEO_BRAND.ratingValue)}</b> from ${escapeHtml(SEO_BRAND.reviewCount)} Google reviews</li>`,
    `                        <li>${escapeHtml(SEO_BRAND.insured)}</li>`,
    '                        <li>Fixed quotes</li>',
    '                    </ul>',
].join('\n');

/**
 * Full-bleed hero band. Renders a navy gradient BEHIND the trade image so a
 * 404 image still looks intentional. `variant` chooses the arrangement.
 */
function heroSection(opts: {
    variant: Variant;
    eyebrow: string;
    h1: string;
    intro: string;
    imageSrc: string;
    imageAlt: string;
}): string {
    const { variant, eyebrow, h1, intro, imageSrc, imageAlt } = opts;
    const img = escapeHtml(imageSrc);
    const alt = escapeHtml(imageAlt);
    const copy = [
        `                    <p class="eyebrow">${escapeHtml(eyebrow)}</p>`,
        `                    <h1>${escapeHtml(h1)}</h1>`,
        `                    <p class="lede">${escapeHtml(intro)}</p>`,
        '                    <a class="btn btn-amber btn-arrow" href="/">Get a free quote</a>',
        heroTrust,
    ].join('\n');

    if (variant === 'b') {
        // Full-bleed image with navy overlay + text on top.
        return [
            '        <section class="hero hero-full">',
            `            <img class="hero-bg" src="${img}" alt="${alt}" width="1280" height="720" loading="eager" decoding="async">`,
            '            <div class="hero-scrim"></div>',
            '            <div class="container hero-inner">',
            copy,
            '            </div>',
            '        </section>',
        ].join('\n');
    }

    // Split hero — variant 'a' = image right, 'c' = image left.
    const variantClass = variant === 'c' ? 'hero hero-split var-c' : 'hero hero-split var-a';
    return [
        `        <section class="${variantClass}">`,
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

/** High-contrast social-proof band built from SEO_BRAND facts. */
function socialProofBand(placeName: string): string {
    return [
        '        <section class="block">',
        '            <div class="container">',
        '                <div class="proof">',
        '                    <div class="in">',
        '                        <div class="score">',
        `                            <div class="num">${escapeHtml(SEO_BRAND.ratingValue)}</div>`,
        '                            <div class="stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</div>',
        `                            <div class="rc">${escapeHtml(SEO_BRAND.reviewCount)} Google reviews</div>`,
        '                        </div>',
        '                        <div>',
        `                            <p class="say">&ldquo;Turned up on time, fixed price agreed before they started, and the job was spotless. Exactly what you want from a trade in ${escapeHtml(placeName)}.&rdquo;</p>`,
        '                            <ul class="facts">',
        `                                <li><span class="tick">&#10003;</span> ${escapeHtml(SEO_BRAND.insured)}</li>`,
        '                                <li><span class="tick">&#10003;</span> Vetted, local tradespeople</li>',
        '                                <li><span class="tick">&#10003;</span> Fixed quotes, no call-out charge</li>',
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
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: SEO_BRAND.ratingValue,
            reviewCount: SEO_BRAND.reviewCount,
        },
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
    },
    faqCount: number,
): RenderResult {
    const words = visibleWordCount(parts.bodyHtml);
    const links = internalLinkCount(parts.bodyHtml);
    const thin =
        words < SEO_THIN_CONTENT.minVisibleWords ||
        faqCount < SEO_THIN_CONTENT.minFaqItems ||
        links < SEO_THIN_CONTENT.minInternalLinks;

    const html = renderLayout({
        title: parts.title,
        metaDescription: parts.metaDescription,
        canonicalUrl: parts.canonicalUrl,
        ogTags: parts.ogTags,
        jsonLdBlocks: parts.jsonLdBlocks,
        bodyHtml: parts.bodyHtml,
        noindex: thin,
    });

    return { html, status: 200, noindexed: thin };
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
        socialProofBand(city.name),
        serviceMesh,
        suburbMesh,
        ctaBlock(
            `Get a fixed quote in ${city.name}`,
            'Tell us about your job and we will send a clear, no-obligation price. Most quotes back the same day.',
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
        },
        // City hub has no service FAQ; treat as satisfying the FAQ minimum so
        // the guard keys off word count + link count for hubs.
        SEO_THIN_CONTENT.minFaqItems,
    );
}

// ---- T2: service x city -------------------------------------------------

export function renderServiceCity(citySlug: string, serviceSlug: string): RenderResult {
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
    });

    const priceParagraph = service.priceFrom
        ? [
              `                <p class="pricefrom">Typical jobs from <strong>${escapeHtml(service.priceFrom)}</strong>. You get a fixed quote before any work starts.</p>`,
          ]
        : [];

    const introSection = proseSection([
        ...priceParagraph,
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

    const bodyHtml = [
        hero,
        benefitsCards(service.benefits, v),
        introSection,
        socialProofBand(city.name),
        faqBlocks(service.faq, v),
        suburbMesh,
        siblingMesh,
        ctaBlock(
            `Book ${service.label.toLowerCase()} in ${city.name}`,
            'Send us the details and we will come back with a clear fixed price, usually the same day.',
        ),
    ]
        .filter(Boolean)
        .join('\n');

    const jsonLdBlocks = [
        localBusinessLd(city),
        serviceLd(`${service.label} in ${city.name}`, city.name, intro),
        faqLd(service.faq, v),
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
        },
        service.faq.length,
    );
}

// ---- T3: job x suburb ---------------------------------------------------

export function renderJobSuburb(
    citySlug: string,
    serviceSlug: string,
    suburbSlug: string,
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
    });

    const priceParagraph = service.priceFrom
        ? [
              `                <p class="pricefrom">Typical ${escapeHtml(service.label.toLowerCase())} jobs in ${escapeHtml(suburb.name)} from <strong>${escapeHtml(service.priceFrom)}</strong>.</p>`,
          ]
        : [];

    const localised = proseSection([
        `                <p>Looking for a reliable ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(suburb.name)}? ${escapeHtml(SEO_BRAND.name)} covers ${escapeHtml(suburb.name)}${suburb.postcodeArea ? ` (${escapeHtml(suburb.postcodeArea)})` : ''} and the surrounding ${escapeHtml(city.name)} area. Our tradespeople know the local streets and housing, turn up on time, and give you a fixed price before starting so there are no surprises.</p>`,
        `                <p>Whether it is a small repair or a bigger project in ${escapeHtml(suburb.name)}, you get the same promise every time: a clear quote, ${escapeHtml(SEO_BRAND.insured)} cover, and a job that is not finished until you are happy with it.</p>`,
        ...priceParagraph,
        `                <p><a href="/${escapeHtml(citySlug)}/${escapeHtml(serviceSlug)}">All ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(city.name)}</a> &middot; <a href="/${escapeHtml(citySlug)}">${escapeHtml(city.name)} home services</a></p>`,
    ]);

    const nearbyMesh = linkMeshSection(
        `${service.label} near ${suburb.name}`,
        null,
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

    const bodyHtml = [
        hero,
        localised,
        benefitsCards(service.benefits, v),
        socialProofBand(suburb.name),
        faqBlocks(service.faq, v),
        nearbyMesh,
        otherServicesMesh,
        ctaBlock(
            `Book ${service.label.toLowerCase()} in ${suburb.name}`,
            `Tell us about your job in ${suburb.name} and we will send a fixed quote, usually the same day.`,
        ),
    ]
        .filter(Boolean)
        .join('\n');

    const jsonLdBlocks = [
        localBusinessLd(city, suburb.name),
        serviceLd(`${service.label} in ${suburb.name}`, `${suburb.name}, ${city.name}`, intro),
        faqLd(service.faq, v),
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
        },
        service.faq.length,
    );
}

// ---- sitemap ------------------------------------------------------------

export function renderSitemapXml(publishedServiceSlugs?: string[]): string {
    const cities = content.listCities();
    const coreServices = content.listServices({ deliverability: 'core' });

    const allowService = (slug: string): boolean =>
        !publishedServiceSlugs || publishedServiceSlugs.includes(slug);

    const urls: string[] = [];
    const push = (loc: string) => {
        urls.push(`    <url><loc>${escapeHtml(loc)}</loc></url>`);
    };

    for (const city of cities) {
        // T1 city hub
        push(absUrl(city.slug));

        const suburbs = content.getSuburbs(city.slug);
        for (const service of coreServices) {
            if (!allowService(service.slug)) continue;
            // T2 service x city
            push(absUrl(`${city.slug}/${service.slug}`));
            // T3 service x city x suburb
            for (const sub of suburbs) {
                push(absUrl(`${city.slug}/${service.slug}/${sub.slug}`));
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
