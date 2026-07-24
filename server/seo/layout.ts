/**
 * SEO landing-page HTML shell — the shared document skeleton for all
 * server-rendered T1/T2/T3 pages. Pure string assembly, no I/O.
 *
 * Given the semantic parts of a page (title, meta, canonical, OG tags,
 * JSON-LD blocks, body), it returns a complete, crawlable `<!doctype html>`
 * document with a tasteful, minimal, mobile-responsive inline stylesheet.
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
    /** Fully-formed, already-escaped HTML for the <main> content. */
    bodyHtml: string;
    /** When true, emit robots noindex,follow. */
    noindex?: boolean;
}

const INLINE_STYLE = `
:root{--navy:#0f2748;--navy-2:#1b3a63;--ink:#1a2333;--muted:#5a6b82;--line:#e2e8f0;--bg:#ffffff;--soft:#f5f8fc;--accent:#1a6feb;--star:#f5a623}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:65ch;margin:0 auto;padding:0 20px}
header.site{background:var(--navy);color:#fff}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;padding-top:16px;padding-bottom:16px}
header.site a.brand{color:#fff;font-weight:700;font-size:19px;letter-spacing:.2px}
header.site a.book{background:#fff;color:var(--navy);padding:8px 14px;border-radius:8px;font-weight:600;font-size:15px}
header.site a.book:hover{text-decoration:none;opacity:.92}
main{padding:32px 0 48px}
h1{font-size:30px;line-height:1.2;margin:.2em 0 .5em;color:var(--navy)}
h2{font-size:22px;margin:1.6em 0 .5em;color:var(--navy)}
h3{font-size:18px;margin:1.3em 0 .4em;color:var(--navy-2)}
p{margin:0 0 1em}
ul{padding-left:1.2em;margin:0 0 1em}
li{margin:.3em 0}
.hero{margin-bottom:8px}
.hero p.lede{font-size:19px;color:var(--muted)}
.trust{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:20px 0;font-size:15px;color:var(--ink)}
.trust b{color:var(--navy)}
.trust .star{color:var(--star)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:16px 0 8px;padding:0;list-style:none}
.grid li{margin:0}
.grid a{display:block;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-weight:600;color:var(--navy)}
.grid a:hover{border-color:var(--accent);text-decoration:none}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;padding:0;list-style:none}
.chips li{margin:0}
.chips a{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:15px}
.faq dt{font-weight:700;color:var(--navy);margin-top:1.1em}
.faq dd{margin:.2em 0 0}
.cta{background:var(--navy);color:#fff;border-radius:14px;padding:24px;margin:28px 0;text-align:center}
.cta h2{color:#fff;margin-top:0}
.cta p{color:#dbe6f5}
.cta a.btn{display:inline-block;background:#fff;color:var(--navy);font-weight:700;padding:12px 26px;border-radius:10px;margin-top:6px}
.cta a.btn:hover{text-decoration:none;opacity:.92}
.pricefrom{color:var(--muted);font-size:15px}
footer.site{border-top:1px solid var(--line);background:var(--soft);color:var(--muted);font-size:14px}
footer.site .wrap{padding:24px 20px}
footer.site a{color:var(--muted)}
@media (max-width:600px){h1{font-size:25px}body{font-size:16px}}
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
    const year = new Date().getFullYear();

    return `<!doctype html>
<html lang="en-GB">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
        <div class="wrap">
            <a class="brand" href="${escapeHtml(SEO_BRAND.url)}">${brand}</a>
            <a class="book" href="/">Get a quote</a>
        </div>
    </header>
    <main>
        <div class="wrap">
${bodyHtml}
        </div>
    </main>
    <footer class="site">
        <div class="wrap">
            <p><strong>${brand}</strong> — ${escapeHtml(SEO_BRAND.insured)} &middot; ${escapeHtml(SEO_BRAND.ratingValue)}&#9733; from ${escapeHtml(SEO_BRAND.reviewCount)} reviews.</p>
            <p>&copy; ${year} ${brand}. Serving Nottingham, Derby &amp; the East Midlands. <a href="/">Book a job</a></p>
        </div>
    </footer>
</body>
</html>`;
}
