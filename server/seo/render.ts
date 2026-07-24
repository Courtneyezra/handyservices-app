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
import { renderLayout, escapeHtml, OgTag } from './layout';

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

function renderBenefits(benefits: string[], v: { service: string; place: string; city: string }): string {
    if (!benefits.length) return '';
    const items = benefits
        .map((b) => `                <li>${escapeHtml(subst(b, v))}</li>`)
        .join('\n');
    return `            <h2>Why choose us</h2>\n            <ul>\n${items}\n            </ul>`;
}

function renderFaq(faq: { q: string; a: string }[], v: { service: string; place: string; city: string }): string {
    if (!faq.length) return '';
    const items = faq
        .map(
            (f) =>
                `                <dt>${escapeHtml(subst(f.q, v))}</dt>\n                <dd>${escapeHtml(subst(f.a, v))}</dd>`,
        )
        .join('\n');
    return `            <h2>Frequently asked questions</h2>\n            <dl class="faq">\n${items}\n            </dl>`;
}

const trustStrip = [
    '            <div class="trust">',
    `                <span><b>${escapeHtml(SEO_BRAND.insured)}</b></span>`,
    `                <span><b class="star">&#9733; ${escapeHtml(SEO_BRAND.ratingValue)}</b> from ${escapeHtml(SEO_BRAND.reviewCount)} Google reviews</span>`,
    '                <span>Fixed quotes &middot; No call-out charge</span>',
    '            </div>',
].join('\n');

function ctaBlock(headline: string, sub: string): string {
    return [
        '            <div class="cta">',
        `                <h2>${escapeHtml(headline)}</h2>`,
        `                <p>${escapeHtml(sub)}</p>`,
        '                <a class="btn" href="/">Get your free quote</a>',
        '            </div>',
    ].join('\n');
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
        '            <h1>Page not found</h1>',
        "            <p>Sorry, we couldn't find that page. <a href=\"/\">Return to Handy Services</a> to get a quote.</p>",
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

    const title = `Handyman & Home Services in ${city.name} | ${SEO_BRAND.name}`;
    const metaDescription = `Trusted handyman, painting, gutter cleaning and home improvement services across ${city.name}, ${city.county}. ${SEO_BRAND.insured}, ${SEO_BRAND.ratingValue}-star rated. Get a free fixed quote.`;

    const serviceGrid = coreServices.length
        ? [
              '            <h2>Our services in ' + escapeHtml(city.name) + '</h2>',
              '            <ul class="grid">',
              ...coreServices.map(
                  (s) =>
                      `                <li><a href="/${escapeHtml(citySlug)}/${escapeHtml(s.slug)}">${escapeHtml(s.label)} in ${escapeHtml(city.name)}</a></li>`,
              ),
              '            </ul>',
          ].join('\n')
        : '';

    // Suburb links point at the flagship "handyman" T3 page for each area.
    const topSuburbs = suburbs.slice(0, 12);
    const suburbLinks = topSuburbs.length
        ? [
              '            <h2>Areas we cover around ' + escapeHtml(city.name) + '</h2>',
              '            <ul class="chips">',
              ...topSuburbs.map(
                  (sub) =>
                      `                <li><a href="/${escapeHtml(citySlug)}/handyman/${escapeHtml(sub.slug)}">${escapeHtml(sub.name)}</a></li>`,
              ),
              '            </ul>',
          ].join('\n')
        : '';

    const bodyHtml = [
        '            <div class="hero">',
        `                <h1>Handyman &amp; Home Services in ${escapeHtml(city.name)}</h1>`,
        `                <p class="lede">Reliable local tradespeople for every job around your home in ${escapeHtml(city.name)} and across ${escapeHtml(city.county)}. One call, fixed quote, work guaranteed.</p>`,
        '            </div>',
        trustStrip,
        `            <p>From a leaking gutter to a full kitchen fit, ${escapeHtml(SEO_BRAND.name)} brings vetted, insured tradespeople to homes throughout ${escapeHtml(city.name)}. We give you a clear fixed price up front, turn up when we say we will, and stand behind every job we complete. No hourly-rate surprises and no call-out charge.</p>`,
        serviceGrid,
        suburbLinks,
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

    const title = subst(service.metaTitleTemplate, v);
    const metaDescription = subst(service.metaDescriptionTemplate, v);
    const h1 = subst(service.h1Template, v);
    const intro = subst(service.intro, v);

    const suburbs = content.getSuburbs(citySlug);
    const siblings = content
        .listServices({ deliverability: 'core' })
        .filter((s) => s.slug !== service.slug);

    const suburbMesh = suburbs.length
        ? [
              `            <h2>${escapeHtml(service.label)} in your area</h2>`,
              `            <p>We cover ${escapeHtml(service.label.toLowerCase())} jobs right across ${escapeHtml(city.name)}. Choose your neighbourhood:</p>`,
              '            <ul class="chips">',
              ...suburbs.map(
                  (sub) =>
                      `                <li><a href="/${escapeHtml(citySlug)}/${escapeHtml(serviceSlug)}/${escapeHtml(sub.slug)}">${escapeHtml(service.label)} in ${escapeHtml(sub.name)}</a></li>`,
              ),
              '            </ul>',
          ].join('\n')
        : '';

    const siblingMesh = siblings.length
        ? [
              `            <h2>Other services in ${escapeHtml(city.name)}</h2>`,
              '            <ul class="grid">',
              ...siblings.map(
                  (s) =>
                      `                <li><a href="/${escapeHtml(citySlug)}/${escapeHtml(s.slug)}">${escapeHtml(s.label)} in ${escapeHtml(city.name)}</a></li>`,
              ),
              '            </ul>',
          ].join('\n')
        : '';

    const priceLine = service.priceFrom
        ? `            <p class="pricefrom">Typical jobs from <strong>${escapeHtml(service.priceFrom)}</strong>. You get a fixed quote before any work starts.</p>`
        : '';

    const bodyHtml = [
        '            <div class="hero">',
        `                <h1>${escapeHtml(h1)}</h1>`,
        `                <p class="lede">${escapeHtml(intro)}</p>`,
        '            </div>',
        trustStrip,
        priceLine,
        renderBenefits(service.benefits, v),
        `            <p><a href="/${escapeHtml(citySlug)}">All ${escapeHtml(city.name)} services</a> &middot; ${escapeHtml(SEO_BRAND.insured)} &middot; work guaranteed.</p>`,
        renderFaq(service.faq, v),
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

    const localised = [
        `            <p>Looking for a reliable ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(suburb.name)}? ${escapeHtml(SEO_BRAND.name)} covers ${escapeHtml(suburb.name)}${suburb.postcodeArea ? ` (${escapeHtml(suburb.postcodeArea)})` : ''} and the surrounding ${escapeHtml(city.name)} area. Our tradespeople know the local streets and housing, turn up on time, and give you a fixed price before starting so there are no surprises.</p>`,
        `            <p>Whether it is a small repair or a bigger project in ${escapeHtml(suburb.name)}, you get the same promise every time: a clear quote, ${escapeHtml(SEO_BRAND.insured)} cover, and a job that is not finished until you are happy with it.</p>`,
    ].join('\n');

    const nearbyMesh = nearby.length
        ? [
              `            <h2>${escapeHtml(service.label)} near ${escapeHtml(suburb.name)}</h2>`,
              '            <ul class="chips">',
              ...nearby
                  .slice(0, 12)
                  .map(
                      (s) =>
                          `                <li><a href="/${escapeHtml(citySlug)}/${escapeHtml(serviceSlug)}/${escapeHtml(s.slug)}">${escapeHtml(service.label)} in ${escapeHtml(s.name)}</a></li>`,
                  ),
              '            </ul>',
          ].join('\n')
        : '';

    const otherServicesMesh = otherServices.length
        ? [
              `            <h2>Other trades in ${escapeHtml(suburb.name)}</h2>`,
              '            <ul class="grid">',
              ...otherServices
                  .slice(0, 12)
                  .map(
                      (s) =>
                          `                <li><a href="/${escapeHtml(citySlug)}/${escapeHtml(s.slug)}/${escapeHtml(suburbSlug)}">${escapeHtml(s.label)} in ${escapeHtml(suburb.name)}</a></li>`,
                  ),
              '            </ul>',
          ].join('\n')
        : '';

    const priceLine = service.priceFrom
        ? `            <p class="pricefrom">Typical ${escapeHtml(service.label.toLowerCase())} jobs in ${escapeHtml(suburb.name)} from <strong>${escapeHtml(service.priceFrom)}</strong>.</p>`
        : '';

    const bodyHtml = [
        '            <div class="hero">',
        `                <h1>${escapeHtml(h1)}</h1>`,
        `                <p class="lede">${escapeHtml(intro)}</p>`,
        '            </div>',
        trustStrip,
        localised,
        priceLine,
        renderBenefits(service.benefits, v),
        `            <p><a href="/${escapeHtml(citySlug)}/${escapeHtml(serviceSlug)}">All ${escapeHtml(service.label.toLowerCase())} in ${escapeHtml(city.name)}</a> &middot; <a href="/${escapeHtml(citySlug)}">${escapeHtml(city.name)} home services</a></p>`,
        renderFaq(service.faq, v),
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
