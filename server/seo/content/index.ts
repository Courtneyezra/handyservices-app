/**
 * SEO content module — the concrete implementation of SeoContentApi.
 *
 * Pure data + lookups, no I/O and no db. Cities and service identity come from
 * the authoritative constants in ../contract; the rich per-service copy lives
 * in ./services and the suburb lists in ./suburbs. Exposes both standalone
 * named functions and a bundled `content` object for callers that prefer one
 * injectable dependency.
 */
import {
    SEO_CITIES,
    type SeoCity,
    type SeoSuburb,
    type SeoServiceContent,
    type SeoContentApi,
} from '../contract';
import { SEO_SERVICE_CONTENT } from './services';
import { SEO_SUBURBS } from './suburbs';

// ---- Lookup indexes (built once at module load) -------------------------

const cityBySlug = new Map<string, SeoCity>(
    SEO_CITIES.map((c) => [c.slug, c]),
);

const serviceBySlug = new Map<string, SeoServiceContent>(
    SEO_SERVICE_CONTENT.map((s) => [s.slug, s]),
);

const suburbsByCity = new Map<string, SeoSuburb[]>();
for (const suburb of SEO_SUBURBS) {
    const list = suburbsByCity.get(suburb.citySlug);
    if (list) list.push(suburb);
    else suburbsByCity.set(suburb.citySlug, [suburb]);
}

const suburbByCityAndSlug = new Map<string, SeoSuburb>(
    SEO_SUBURBS.map((s) => [`${s.citySlug}/${s.slug}`, s]),
);

// ---- Named functions ----------------------------------------------------

export function getCity(slug: string): SeoCity | undefined {
    return cityBySlug.get(slug);
}

export function listCities(): SeoCity[] {
    return [...SEO_CITIES];
}

export function getService(slug: string): SeoServiceContent | undefined {
    return serviceBySlug.get(slug);
}

export function listServices(
    opts?: { deliverability?: 'core' | 'sub' },
): SeoServiceContent[] {
    if (opts?.deliverability) {
        return SEO_SERVICE_CONTENT.filter(
            (s) => s.deliverability === opts.deliverability,
        );
    }
    return [...SEO_SERVICE_CONTENT];
}

export function getSuburbs(citySlug: string): SeoSuburb[] {
    const list = suburbsByCity.get(citySlug);
    return list ? [...list] : [];
}

export function getSuburb(
    citySlug: string,
    suburbSlug: string,
): SeoSuburb | undefined {
    return suburbByCityAndSlug.get(`${citySlug}/${suburbSlug}`);
}

// ---- Bundled API object -------------------------------------------------

export const content: SeoContentApi = {
    getCity,
    listCities,
    getService,
    listServices,
    getSuburbs,
    getSuburb,
};
