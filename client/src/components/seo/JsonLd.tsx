/**
 * JsonLd — renders a schema.org JSON-LD block for AEO/GEO (AI-search) crawlers.
 *
 * Renders nothing visible: a single <script type="application/ld+json">.
 * Pair with the builders in client/src/lib/seo-schema.ts, e.g.
 *   <JsonLd data={localBusinessSchema({ city: 'Nottingham' })} />
 *
 * XSS-safety: the payload is serialised with JSON.stringify (never raw
 * interpolation), and any "</" is escaped so a string value cannot break out
 * of the <script> element.
 */

export interface JsonLdProps {
  /** A JSON-LD object (or array of them) from seo-schema.ts. */
  data: Record<string, unknown> | Record<string, unknown>[];
}

export function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      // Content is JSON.stringify output with "<" escaped — no HTML/JS can execute.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
