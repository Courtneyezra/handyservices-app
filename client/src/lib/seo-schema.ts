/**
 * seo-schema.ts — schema.org JSON-LD builders for AEO/GEO (AI-search) citability.
 *
 * Pure, typed functions returning plain JSON-LD objects (no React). Feed the
 * output into <JsonLd data={...} /> (client/src/components/seo/JsonLd.tsx).
 *
 * Goal: make Handy Services maximally quotable by AI answer engines
 * (ChatGPT, Perplexity, Google AI Overviews) with clean, factual structured
 * data. Every fact below is real brand data — edit BRAND in one place.
 */

/* -------------------------------------------------------------------------- */
/* Brand constants — single source of truth. Edit here only.                  */
/* -------------------------------------------------------------------------- */

export const BRAND = {
  name: 'Handy Services',
  legalName: 'Handy Services',
  url: 'https://www.handyservices.app',
  logo: 'https://www.handyservices.app/assets/handy-logo-transparent.png',
  telephone: '+44 115 824 0000',
  email: 'hello@handyservices.app',
  priceRange: '££',
  currenciesAccepted: 'GBP',
  paymentAccepted: 'Cash, Credit Card, Debit Card, Apple Pay, Google Pay',
  /** Public-liability insurance cover. */
  insurance: '£2M public-liability insurance',
  aggregateRating: {
    ratingValue: '4.9',
    reviewCount: '127',
    bestRating: '5',
    worstRating: '1',
  },
  /** Authoritative external profiles / citations. */
  sameAs: [
    'https://www.google.com/search?q=Handy+Services+Nottingham',
    'https://www.facebook.com/handyservicesapp',
    'https://www.instagram.com/handyservicesapp',
  ],
  /** Cities served, with approximate geo centroids for LocalBusiness. */
  cities: {
    Nottingham: { region: 'Nottinghamshire', latitude: 52.9548, longitude: -1.1581 },
    Derby: { region: 'Derbyshire', latitude: 52.9225, longitude: -1.4746 },
  },
} as const;

export type ServedCity = keyof typeof BRAND.cities;

/** Full service list — the trades Handy Services delivers. */
export const SERVICES = [
  'Handyman',
  'Painting & Decorating',
  'Gutter Cleaning',
  'Fencing',
  'Plastering',
  'Kitchen Fitting',
  'Tiling',
  'Carpentry',
  'Garden & Landscaping',
  'Pressure Washing',
  'Decking',
  'Bathroom Fitting',
] as const;

export type Trade = (typeof SERVICES)[number];

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** A minimal JSON-LD node shape. */
export type JsonLdObject = Record<string, unknown>;

export interface LocalBusinessOptions {
  /** City the page targets. Drives areaServed + geo/address. */
  city: ServedCity;
  /** Canonical page URL. Defaults to the brand homepage. */
  url?: string;
  /** Override the default brand telephone. */
  telephone?: string;
  /** Optional richer business description. */
  description?: string;
  /** Optional @id for cross-referencing (e.g. from a Service node). */
  id?: string;
}

export interface ServiceOptions {
  /** The trade offered, e.g. "Gutter Cleaning". */
  trade: Trade | string;
  /** City the service is offered in. */
  city: ServedCity;
  /** Optional human description of the service. */
  description?: string;
  /** Canonical URL of the service page. */
  url?: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * HomeAndConstructionBusiness / LocalBusiness node for a given city.
 * Includes name, areaServed, aggregateRating, address + geo, priceRange, sameAs.
 */
export function localBusinessSchema(options: LocalBusinessOptions): JsonLdObject {
  const { city, url, telephone, description, id } = options;
  const geo = BRAND.cities[city];

  return {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    ...(id ? { '@id': id } : {}),
    name: BRAND.name,
    legalName: BRAND.legalName,
    description:
      description ??
      `${BRAND.name} is a professional handyman and home-improvement service in ${city}, ${geo.region}. Fully insured with ${BRAND.insurance}, rated ${BRAND.aggregateRating.ratingValue} stars on Google from ${BRAND.aggregateRating.reviewCount} reviews.`,
    url: url ?? BRAND.url,
    logo: BRAND.logo,
    image: BRAND.logo,
    telephone: telephone ?? BRAND.telephone,
    email: BRAND.email,
    priceRange: BRAND.priceRange,
    currenciesAccepted: BRAND.currenciesAccepted,
    paymentAccepted: BRAND.paymentAccepted,
    address: {
      '@type': 'PostalAddress',
      addressLocality: city,
      addressRegion: geo.region,
      addressCountry: 'GB',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: geo.latitude,
      longitude: geo.longitude,
    },
    areaServed: {
      '@type': 'City',
      name: city,
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: BRAND.aggregateRating.ratingValue,
      reviewCount: BRAND.aggregateRating.reviewCount,
      bestRating: BRAND.aggregateRating.bestRating,
      worstRating: BRAND.aggregateRating.worstRating,
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${BRAND.name} services`,
      itemListElement: SERVICES.map((trade) => ({
        '@type': 'OfferCatalog',
        name: trade,
      })),
    },
    sameAs: [...BRAND.sameAs],
  };
}

/**
 * Service node for a single trade in a single city. `provider` is the
 * LocalBusiness, so answer engines can join the service back to the brand.
 */
export function serviceSchema(options: ServiceOptions): JsonLdObject {
  const { trade, city, description, url } = options;
  const geo = BRAND.cities[city];

  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `${trade} in ${city}`,
    serviceType: trade,
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    provider: {
      '@type': 'HomeAndConstructionBusiness',
      name: BRAND.name,
      url: BRAND.url,
      telephone: BRAND.telephone,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: BRAND.aggregateRating.ratingValue,
        reviewCount: BRAND.aggregateRating.reviewCount,
      },
    },
    areaServed: {
      '@type': 'City',
      name: city,
      containedInPlace: {
        '@type': 'AdministrativeArea',
        name: geo.region,
      },
    },
  };
}

/** FAQPage node from a list of question/answer pairs. */
export function faqSchema(items: FaqItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}

/** BreadcrumbList node from an ordered list of {name, url}. */
export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
