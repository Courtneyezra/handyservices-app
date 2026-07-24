/**
 * SEO landing-page HTML shell — the shared document skeleton for all
 * server-rendered T1/T2/T3 pages. Pure string assembly, no I/O.
 *
 * Given the semantic parts of a page (title, meta, canonical, OG tags,
 * JSON-LD blocks, body), it returns a complete, crawlable `<!doctype html>`
 * document with a premium, brand-matched, mobile-first inline stylesheet.
 *
 * The look mirrors the React HandymanLanding page: navy (#1B2A4A) gradient
 * heroes, amber (#F5A623) accents + CTAs, bold large headings, rounded cards,
 * slate neutrals and green for trust/success. Everything is inlined so a page
 * makes zero external requests and renders instantly for crawlers.
 */

import { SEO_BRAND } from './contract';

/** Escape a string for safe interpolation into HTML text / attribute values. */
export function escapeHtml(input: string): string {
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Hero image URL convention for a trade/service. Images are generated
 * separately and dropped into `client/public/assets/seo-heroes/`. The hero
 * band always renders a navy gradient BEHIND the image, so a 404 here still
 * looks intentional.
 *
 * @example getTradeHeroImage('gutter-cleaning') // => "/assets/seo-heroes/gutter-cleaning.webp"
 */
export function getTradeHeroImage(tradeSlug: string): string {
    const safe = String(tradeSlug).replace(/[^a-z0-9-]/gi, '').toLowerCase();
    return `/assets/seo-heroes/${safe || 'handyman'}.webp`;
}

/**
 * Serialise a JSON-LD object for a <script type="application/ld+json"> block.
 * Escapes `<` so a stray "</script>" or "<!--" in string data cannot break
 * out of the script element.
 */
function serializeJsonLd(obj: unknown): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export interface OgTag {
    property: string; // e.g. "og:title", "og:type"
    content: string;
}

export interface LayoutParts {
    title: string;
    metaDescription: string;
    canonicalUrl: string;
    ogTags?: OgTag[];
    /** Pre-built JSON-LD objects; each becomes its own ld+json script. */
    jsonLdBlocks?: unknown[];
    /**
     * Fully-formed, already-escaped HTML for the <main> content. Emitted
     * full-bleed (no forced wrapper): sections manage their own width via an
     * inner `.container`, so hero bands can span edge to edge.
     */
    bodyHtml: string;
    /** When true, emit robots noindex,follow. */
    noindex?: boolean;
}

const INLINE_STYLE = `
:root{
--navy:#1B2A4A;--navy-2:#24365c;--navy-3:#0f1c33;
--amber:#F5A623;--amber-600:#e0940c;--amber-050:#fff6e6;
--ink:#0f172a;--slate:#475569;--muted:#64748b;
--line:#e2e8f0;--bg:#ffffff;--soft:#f7f8fc;--green:#16a34a;--star:#F5A623;
--shadow:0 10px 30px -12px rgba(15,23,42,.18);--shadow-lg:0 24px 60px -24px rgba(15,23,42,.35);
--radius:18px;--radius-lg:28px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:"Poppins",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px;-webkit-font-smoothing:antialiased}
a{color:var(--navy);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:3px solid var(--amber);outline-offset:2px;border-radius:6px}
img{max-width:100%;display:block}
.container{max-width:1080px;margin:0 auto;padding:0 20px}

/* ---- header ---- */
header.site{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--line)}
header.site .container{display:flex;align-items:center;justify-content:space-between;padding-top:14px;padding-bottom:14px}
header.site a.brand{color:var(--navy);font-weight:800;font-size:20px;letter-spacing:-.01em}
header.site a.brand:hover{text-decoration:none}
header.site .brand .dot{color:var(--amber)}
header.site a.book{background:var(--amber);color:var(--navy);padding:10px 18px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:var(--shadow)}
header.site a.book:hover{text-decoration:none;background:var(--amber-600)}

/* ---- buttons ---- */
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:800;border-radius:999px;padding:15px 30px;font-size:17px;line-height:1;transition:transform .12s ease}
.btn:hover{text-decoration:none;transform:translateY(-1px)}
.btn-amber{background:var(--amber);color:var(--navy);box-shadow:0 12px 26px -10px rgba(245,166,35,.6)}
.btn-amber:hover{background:var(--amber-600)}
.btn-arrow::after{content:"\\2192";font-weight:700}

/* ---- hero (shared) ---- */
.hero{position:relative;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 55%,var(--navy-3) 100%);color:#fff;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(1100px 480px at 85% -10%,rgba(245,166,35,.16),transparent 60%);pointer-events:none}
.hero h1{font-size:clamp(30px,5vw,50px);line-height:1.06;letter-spacing:-.02em;margin:0 0 16px;color:#fff;font-weight:800}
.hero .lede{font-size:clamp(17px,2.1vw,21px);color:rgba(255,255,255,.82);margin:0 0 26px;max-width:44ch}
.eyebrow{display:inline-block;color:var(--amber);font-weight:800;text-transform:uppercase;letter-spacing:.14em;font-size:13px;margin:0 0 14px}
.trust-hero{list-style:none;display:flex;flex-wrap:wrap;gap:10px 18px;margin:26px 0 0;padding:0;font-size:15px;color:rgba(255,255,255,.9)}
.trust-hero li{display:inline-flex;align-items:center;gap:7px;font-weight:600}
.trust-hero li+li::before{content:"";width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.35);margin-right:11px}
.trust-hero .stars{color:var(--star);letter-spacing:1px}
.trust-hero b{color:#fff;font-weight:800}
.hero-img{border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);width:100%;height:100%;object-fit:cover;aspect-ratio:4/3;background:linear-gradient(135deg,var(--navy-2),var(--navy-3))}

/* variant A / C: split */
.hero-split .hero-inner{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center;padding:64px 20px 72px}
.hero-split.var-c .hero-copy{order:2}
.hero-split.var-c .hero-media{order:1}
.hero-media{position:relative}
.hero-media::after{content:"";position:absolute;left:22px;bottom:-14px;right:22px;height:40px;background:rgba(245,166,35,.25);filter:blur(26px);border-radius:50%;z-index:-1}

/* variant B: full-bleed image with overlay */
.hero-full{min-height:460px;display:flex;align-items:center}
.hero-full .hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero-full .hero-scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(15,28,51,.94) 0%,rgba(27,42,74,.86) 45%,rgba(27,42,74,.5) 100%)}
.hero-full .hero-inner{position:relative;z-index:2;padding:72px 20px;max-width:640px}

/* ---- section scaffolding ---- */
section.block{padding:52px 0}
section.block h2{font-size:clamp(24px,3.2vw,34px);line-height:1.12;letter-spacing:-.01em;color:var(--navy);margin:0 0 8px;font-weight:800}
.section-lead{color:var(--slate);font-size:18px;margin:0 0 26px;max-width:60ch}
.prose p{color:var(--slate);margin:0 0 1em;max-width:70ch}
.prose a{color:var(--navy);font-weight:700;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--amber)}
.pricefrom{background:var(--amber-050);border:1px solid #f4d79a;border-radius:14px;padding:14px 18px;color:var(--ink);font-size:16px;display:inline-block}
.pricefrom strong{color:var(--navy)}

/* ---- benefit cards ---- */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:0;padding:0;list-style:none}
.cards li{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:20px 20px 22px;box-shadow:var(--shadow);display:flex;gap:13px;align-items:flex-start}
.cards li .ic{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:rgba(22,163,74,.12);display:inline-flex;align-items:center;justify-content:center;margin-top:1px}
.cards li .ic svg{width:17px;height:17px;stroke:var(--green);fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.cards li span.txt{font-weight:600;color:var(--ink)}

/* ---- FAQ ---- */
.faq{display:grid;gap:14px;margin:0}
.faq .qa{background:var(--soft);border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:14px;padding:18px 20px}
.faq .qa dt{font-weight:800;color:var(--navy);font-size:17px;margin:0 0 6px}
.faq .qa dd{margin:0;color:var(--slate)}

/* ---- social proof band ---- */
.proof{background:var(--navy);color:#fff;border-radius:var(--radius-lg);padding:38px 28px;margin:0;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
.proof::before{content:"";position:absolute;inset:0;background:radial-gradient(700px 300px at 90% 120%,rgba(245,166,35,.18),transparent 60%)}
.proof .in{position:relative;display:grid;grid-template-columns:auto 1fr;gap:26px;align-items:center}
.proof .score{text-align:center;border-right:1px solid rgba(255,255,255,.16);padding-right:26px}
.proof .score .num{font-size:52px;font-weight:800;line-height:1;color:#fff}
.proof .score .stars{color:var(--star);font-size:20px;letter-spacing:2px;margin-top:4px}
.proof .score .rc{color:rgba(255,255,255,.7);font-size:13px;margin-top:6px}
.proof .say{font-size:19px;font-weight:600;line-height:1.4;color:#fff}
.proof .facts{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 0;padding:0}
.proof .facts li{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:7px 14px;font-size:14px;font-weight:600;color:rgba(255,255,255,.92)}
.proof .facts .tick{color:var(--amber);font-weight:800}

/* ---- link mesh (chips + cards) ---- */
.chips{display:flex;flex-wrap:wrap;gap:10px;margin:0;padding:0;list-style:none}
.chips a{display:inline-flex;align-items:center;background:#fff;border:1px solid var(--line);border-radius:999px;padding:9px 16px;font-size:15px;font-weight:600;color:var(--navy);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.chips a:hover{text-decoration:none;border-color:var(--amber);background:var(--amber-050)}
.linkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:0;padding:0;list-style:none}
.linkgrid a{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 17px;font-weight:700;color:var(--navy);box-shadow:var(--shadow)}
.linkgrid a:hover{text-decoration:none;border-color:var(--amber);transform:translateY(-1px);transition:transform .12s ease}
.linkgrid a::after{content:"\\2192";color:var(--amber);font-weight:800}

/* ---- big CTA band ---- */
.cta{background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;border-radius:var(--radius-lg);padding:44px 28px;text-align:center;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
.cta::before{content:"";position:absolute;inset:0;background:radial-gradient(600px 260px at 15% -20%,rgba(245,166,35,.2),transparent 60%)}
.cta .in{position:relative}
.cta h2{color:#fff;margin:0 0 10px;font-size:clamp(24px,3.4vw,34px);font-weight:800}
.cta p{color:rgba(255,255,255,.82);margin:0 0 22px;max-width:52ch;margin-left:auto;margin-right:auto}

/* ---- footer ---- */
footer.site{border-top:1px solid var(--line);background:var(--soft);color:var(--muted);font-size:14px;margin-top:8px}
footer.site .container{padding:34px 20px 40px}
footer.site .fbrand{color:var(--navy);font-weight:800;font-size:18px}
footer.site .fbrand .dot{color:var(--amber)}
footer.site p{margin:.5em 0}
footer.site a{color:var(--slate);font-weight:600}

/* ---- sticky mobile CTA ---- */
.mcta{display:none}
@media (max-width:760px){
  .hero-split .hero-inner{grid-template-columns:1fr;gap:26px;padding:40px 20px 46px}
  .hero-split.var-c .hero-copy{order:1}
  .hero-split.var-c .hero-media{order:2}
  .hero-img{aspect-ratio:16/10}
  .proof .in{grid-template-columns:1fr;gap:18px}
  .proof .score{border-right:0;border-bottom:1px solid rgba(255,255,255,.16);padding-right:0;padding-bottom:16px;display:flex;align-items:center;justify-content:center;gap:16px}
  section.block{padding:40px 0}
  body{padding-bottom:78px}
  .mcta{display:block;position:fixed;left:0;right:0;bottom:0;z-index:60;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
  .mcta a{display:flex;align-items:center;justify-content:center;background:var(--amber);color:var(--navy);font-weight:800;border-radius:999px;padding:15px;font-size:17px;box-shadow:0 10px 24px -8px rgba(245,166,35,.65)}
  .mcta a:hover{text-decoration:none}
}
@media (max-width:400px){.hero .lede{font-size:16px}}
`.trim();

/**
 * Assemble a complete HTML document from its parts.
 * Body HTML is inserted verbatim — callers are responsible for escaping any
 * dynamic text inside it (use escapeHtml).
 */
export function renderLayout(parts: LayoutParts): string {
    const {
        title,
        metaDescription,
        canonicalUrl,
        ogTags = [],
        jsonLdBlocks = [],
        bodyHtml,
        noindex = false,
    } = parts;

    const robots = noindex
        ? '\n    <meta name="robots" content="noindex,follow">'
        : '\n    <meta name="robots" content="index,follow">';

    const ogHtml = ogTags
        .map(
            (t) =>
                `    <meta property="${escapeHtml(t.property)}" content="${escapeHtml(t.content)}">`,
        )
        .join('\n');

    const ldHtml = jsonLdBlocks
        .map(
            (block) =>
                `    <script type="application/ld+json">${serializeJsonLd(block)}</script>`,
        )
        .join('\n');

    const brand = escapeHtml(SEO_BRAND.name);
    const brandMark = `Handy<span class="dot">.</span>Services`;
    const year = new Date().getFullYear();

    return `<!doctype html>
<html lang="en-GB">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#1B2A4A">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">${robots}
    <meta property="og:site_name" content="${brand}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(metaDescription)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
${ogHtml}
    <style>${INLINE_STYLE}</style>
${ldHtml}
</head>
<body>
    <header class="site">
        <div class="container">
            <a class="brand" href="${escapeHtml(SEO_BRAND.url)}">${brandMark}</a>
            <a class="book" href="/">Get a free quote</a>
        </div>
    </header>
    <main>
${bodyHtml}
    </main>
    <footer class="site">
        <div class="container">
            <p class="fbrand">Handy<span class="dot">.</span>Services</p>
            <p><strong style="color:var(--slate)">${escapeHtml(SEO_BRAND.insured)}</strong> &middot; ${escapeHtml(SEO_BRAND.ratingValue)}&#9733; from ${escapeHtml(SEO_BRAND.reviewCount)} Google reviews &middot; Fixed quotes, no call-out charge.</p>
            <p>&copy; ${year} ${brand}. Serving Nottingham, Derby &amp; the East Midlands. <a href="/">Get a free quote</a></p>
        </div>
    </footer>
    <div class="mcta"><a href="/">Get a free quote</a></div>
</body>
</html>`;
}
