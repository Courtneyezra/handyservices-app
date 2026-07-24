# SEO / AEO structured data

JSON-LD builders live in `client/src/lib/seo-schema.ts`; render them with `<JsonLd>`.
Brand facts are centralised in the exported `BRAND` object — edit them there.

```tsx
import { JsonLd } from '@/components/seo/JsonLd';
import { localBusinessSchema, serviceSchema, faqSchema } from '@/lib/seo-schema';

export function GutterCleaningNottingham() {
  return (
    <>
      <JsonLd data={localBusinessSchema({ city: 'Nottingham' })} />
      <JsonLd data={serviceSchema({ trade: 'Gutter Cleaning', city: 'Nottingham' })} />
      <JsonLd data={faqSchema([
        { q: 'Do you cover Nottingham?', a: 'Yes — Nottingham and Derby.' },
        { q: 'Are you insured?', a: 'Yes, £2M public-liability insurance.' },
      ])} />
      {/* ...page content... */}
    </>
  );
}
```
