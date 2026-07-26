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
    /**
     * Absolute URL of the page's hero/social image. When present, emits
     * og:image + twitter:image (summary_large_image) so shared links preview
     * with the trade photo. City hub passes the "handyman" hero.
     */
    imageUrl?: string;
    /** Quote CTA URL for header / sticky bar. Defaults to "/". */
    ctaHref?: string;
    /** Contextual WhatsApp URL for the Ben sticky. Defaults to the generic message. */
    waHref?: string;
    /** City-specific Google review count for the footer trust line; displayed as "N+". */
    reviewCount?: number;
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
header.site a.brand{color:var(--navy);font-weight:800;font-size:20px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:10px}
.brand-logo{width:34px;height:34px;display:block;flex:none}
.fbrand{display:inline-flex;align-items:center;gap:9px}
.grev{display:grid;grid-template-columns:auto 1fr;gap:30px;align-items:center;background:var(--soft);border:1px solid var(--line);border-radius:var(--radius-lg);padding:30px}
.grev-badge{text-align:center;padding:0 14px;border-right:1px solid var(--line)}
.grev .rstars{color:var(--amber);font-size:22px;letter-spacing:2px}
.grev-num{font-size:40px;font-weight:800;color:var(--navy);line-height:1;margin-top:6px}
.grev-count{font-size:13px;color:var(--muted);margin-top:6px}
.grev-copy h2{margin:.05em 0 .3em}
.grev-btn{display:inline-flex;align-items:center;gap:8px;margin-top:14px;background:#fff;border:1.5px solid var(--navy);color:var(--navy);font-weight:800;border-radius:999px;padding:11px 22px}
.grev-btn:hover{text-decoration:none;background:var(--navy);color:#fff}
.grev-btn:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.proof a.rc{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}
.proof a.rc:hover{text-decoration:none;opacity:.85}
@media(max-width:640px){.grev{grid-template-columns:1fr;text-align:center}.grev-badge{border-right:none;border-bottom:1px solid var(--line);padding:0 0 18px}}
.futil{font-size:13px;opacity:.65}
.futil a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.futil a:hover{opacity:.85}
header.site a.brand:hover{text-decoration:none}
header.site .brand .dot{color:var(--amber)}
header.site a.book{background:var(--amber);color:var(--navy);padding:10px 18px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:var(--shadow);white-space:nowrap;flex:none}
header.site a.book:hover{text-decoration:none;background:var(--amber-600)}
header.site .container{gap:12px}
@media(max-width:560px){
  header.site .container{padding-top:11px;padding-bottom:11px}
  header.site a.brand{font-size:17px;gap:8px;min-width:0}
  header.site a.brand .wordmark{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  header.site .brand-logo{width:30px;height:30px}
  header.site a.book{padding:9px 15px;font-size:13.5px}
  /* Keep each hero trust item on one line (no mid-phrase break like "130+ / Google reviews"); trim size so it still fits to 320px.
     Scoped under .hero so it beats the later base .trust-hero rule at equal specificity. */
  .hero .trust-hero{font-size:13px;gap:8px 14px}
  .hero .trust-hero li{white-space:nowrap}
}
@media(max-width:380px){
  header.site a.book{font-size:0}
  header.site a.book::before{content:"Get a quote";font-size:13.5px}
}

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

/* Compact credibility row: small team faces + names + rating, one tidy block */
.team{display:flex;align-items:center;gap:13px;margin:0 0 24px}
.team-ava{display:flex;flex:none}
.team-ava img{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--navy);margin-left:-10px;box-shadow:0 4px 12px rgba(0,0,0,.35)}
.team-ava img:first-child{margin-left:0;border-color:var(--amber)}
.team-meta{min-width:0}
.team-names{margin:0;color:#fff;font-size:14.5px;line-height:1.3}
.team-names b{color:#fff;font-weight:800}
.team-rev{margin:2px 0 0;color:rgba(255,255,255,.82);font-size:13.5px;line-height:1.3}
.team-rev .rstars{color:var(--star);letter-spacing:1px}
.team-rev b{color:#fff;font-weight:800}

/* dual CTA row */
.hero-cta{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn-wa{background:#25D366;color:#fff;font-weight:800}
.btn-wa:hover{background:#1eb457}

/* split hero: copy + crisp image card (no muddy scrim) */
.hero-split .hero-inner{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center;padding:56px 20px 64px}
.hero-media{position:relative}
.hero-media::after{content:"";position:absolute;left:22px;bottom:-14px;right:22px;height:40px;background:rgba(245,166,35,.25);filter:blur(26px);border-radius:50%;z-index:-1}

/* ---- section scaffolding ---- */
section.block{padding:56px 0}
section.block.soft{background:var(--soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
/* Dark band for rhythm (like the landing's alternating sections) — white step cards pop on it. */
section.block.navy{background:linear-gradient(135deg,var(--navy) 0%,var(--navy-3) 100%);border:none}
section.block.navy h2{color:#fff}
section.block.navy .section-lead{color:rgba(255,255,255,.8)}
section.block h2{font-size:clamp(24px,3.2vw,34px);line-height:1.12;letter-spacing:-.01em;color:var(--navy);margin:0 0 8px;font-weight:800}
.kicker{display:inline-block;color:var(--amber-600);font-weight:800;text-transform:uppercase;letter-spacing:.13em;font-size:12.5px;margin:0 0 10px}
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

/* ---- how it works (4 steps) ---- */
.steps{list-style:none;margin:6px 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.steps li{position:relative;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:26px 22px 24px;box-shadow:var(--shadow)}
.steps li .n{position:relative;width:48px;height:48px;border-radius:50%;background:var(--navy);color:var(--amber);font-weight:800;font-size:20px;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -8px rgba(27,42,74,.6)}
.steps li .n::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(245,166,35,.28)}
.steps li h3{margin:16px 0 7px;font-size:17.5px;color:var(--navy);font-weight:800;letter-spacing:-.01em}
.steps li p{margin:0;color:var(--slate);font-size:14.5px;line-height:1.55}
.steps li:not(:last-child)::before{content:"";position:absolute;top:48px;right:-11px;width:22px;height:2px;background:linear-gradient(90deg,var(--amber),transparent);z-index:1}

/* ---- pricing block ---- */
.pricing{display:grid;grid-template-columns:.82fr 1.18fr;gap:22px;align-items:stretch;margin-top:6px}
.pricing .anchor{background:linear-gradient(150deg,var(--navy),var(--navy-3));color:#fff;border-radius:var(--radius-lg);padding:30px 28px;box-shadow:var(--shadow-lg);display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}
.pricing .anchor::before{content:"";position:absolute;inset:0;background:radial-gradient(420px 200px at 90% 120%,rgba(245,166,35,.22),transparent 60%)}
.pricing .anchor .rel{position:relative}
.pricing .anchor .from{color:var(--amber);font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:13px}
.pricing .anchor .amt{font-size:clamp(44px,6vw,60px);font-weight:800;line-height:1;margin:6px 0 10px;color:#fff;letter-spacing:-.02em}
.pricing .anchor .note{color:rgba(255,255,255,.78);font-size:14.5px;margin:0}
.pricing .incl{background:#fff;border:1px solid var(--line);border-radius:var(--radius-lg);padding:26px 26px 24px;box-shadow:var(--shadow)}
.pricing .incl h3{margin:0 0 14px;font-size:16px;color:var(--navy);font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.pricing .incl ul{list-style:none;margin:0;padding:0;display:grid;gap:11px}
.pricing .incl ul li{display:flex;gap:11px;align-items:flex-start;color:var(--ink);font-weight:600;font-size:15.5px}
.pricing .incl ul li .ic{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:rgba(22,163,74,.12);display:inline-flex;align-items:center;justify-content:center;margin-top:1px}
.pricing .incl ul li .ic svg{width:15px;height:15px;stroke:var(--green);fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.pricing .affects{margin:18px 0 0;padding:13px 16px;background:var(--amber-050);border:1px solid #f4d79a;border-radius:12px;color:var(--ink);font-size:14.5px}
.pricing .affects b{color:var(--navy)}
/* example job types under the pricing grid — tangible + AI-friendly, no prices */
.jobex{margin-top:20px}
.jobex-h{margin:0 0 12px;font-weight:700;color:var(--slate);font-size:15px}
.jobchips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:9px}
.jobchips li{background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 15px;font-size:14px;font-weight:600;color:var(--navy);box-shadow:var(--shadow)}

/* ---- reviews (3-up) ---- */
.reviews{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:6px}
.reviews .rev{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:24px 22px;box-shadow:var(--shadow);display:flex;flex-direction:column}
.reviews .rev .rstars{color:var(--star);letter-spacing:2px;font-size:16px;margin-bottom:12px}
.reviews .rev blockquote{margin:0 0 16px;color:var(--ink);font-size:16px;line-height:1.55;font-weight:500;flex:1}
.reviews .rev .who{display:flex;align-items:center;gap:11px}
.reviews .rev .who .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:var(--amber);font-weight:800;font-size:15px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.reviews .rev .who .nm{font-weight:800;color:var(--navy);font-size:15px;line-height:1.2}
.reviews .rev .who .loc{color:var(--muted);font-size:13px}

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
.cta .in h2{color:#fff;margin:0 0 10px;font-size:clamp(24px,3.4vw,34px);font-weight:800}
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
.ben-fab{position:fixed;right:18px;bottom:20px;z-index:70;display:inline-flex;align-items:center;gap:11px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 18px 8px 8px;box-shadow:0 14px 34px -10px rgba(15,23,42,.4);color:var(--navy);transition:transform .15s,box-shadow .15s}
.ben-fab:hover{text-decoration:none;transform:translateY(-1px);box-shadow:0 18px 40px -10px rgba(15,23,42,.5)}
.ben-fab:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.ben-fab .av{position:relative;width:44px;height:44px;flex:none}
.ben-fab .av img{width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;border:2px solid #25D366}
.ben-fab .av .wa{position:absolute;right:-2px;bottom:-2px;width:19px;height:19px;background:#25D366;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center}
.ben-fab .av .wa svg{width:11px;height:11px;fill:#fff}
.ben-fab .lab{display:flex;flex-direction:column;line-height:1.2}
.ben-fab .lab b{font-size:14px;font-weight:800}
.ben-fab .lab small{font-size:11px;color:var(--muted);font-weight:600}
@media(max-width:760px){.ben-fab{bottom:88px;right:12px;padding:6px}.ben-fab .lab{display:none}}
@media (max-width:760px){
  .hero-split .hero-inner{grid-template-columns:1fr;gap:22px;padding:26px 18px 40px}
  /* image on top as a capped banner, copy below — keeps the hero short on mobile */
  .hero-split .hero-media{order:1}
  .hero-split .hero-copy{order:2}
  .hero-img{aspect-ratio:16/9;max-height:230px}
  .team-ava img{width:46px;height:46px}
  .hero-cta{gap:10px}
  .hero-cta .btn{flex:1 1 100%;text-align:center;justify-content:center}
  .proof .in{grid-template-columns:1fr;gap:18px}
  .proof .score{border-right:0;border-bottom:1px solid rgba(255,255,255,.16);padding-right:0;padding-bottom:16px;display:flex;align-items:center;justify-content:center;gap:16px}
  .steps{grid-template-columns:repeat(2,1fr);gap:14px}
  .steps li:not(:last-child)::before{display:none}
  .pricing{grid-template-columns:1fr}
  .reviews{grid-template-columns:1fr}
  section.block{padding:40px 0}
  body{padding-bottom:78px}
  .mcta{display:block;position:fixed;left:0;right:0;bottom:0;z-index:60;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
  .mcta a{display:flex;align-items:center;justify-content:center;background:var(--amber);color:var(--navy);font-weight:800;border-radius:999px;padding:15px;font-size:17px;box-shadow:0 10px 24px -8px rgba(245,166,35,.65)}
  .mcta a:hover{text-decoration:none}
}
@media (max-width:440px){.steps{grid-template-columns:1fr}}
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
        imageUrl,
        ctaHref = '/',
        waHref,
        reviewCount,
    } = parts;
    const footerReviews = reviewCount != null ? `${reviewCount}+` : escapeHtml(SEO_BRAND.reviewCount);

    const bookHref = escapeHtml(ctaHref);
    const benWa = escapeHtml(waHref || 'https://wa.me/447508744402?text=Hi%2C%20I%20have%20a%20question%20about%20your%20handyman%20service');

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

    const imageHtml = imageUrl
        ? [
              `    <meta property="og:image" content="${escapeHtml(imageUrl)}">`,
              `    <meta property="og:image:alt" content="${escapeHtml(title)}">`,
              '    <meta name="twitter:card" content="summary_large_image">',
              `    <meta name="twitter:title" content="${escapeHtml(title)}">`,
              `    <meta name="twitter:description" content="${escapeHtml(metaDescription)}">`,
              `    <meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
          ].join('\n')
        : '';

    const brand = escapeHtml(SEO_BRAND.name);
    const brandMark = `<img class="brand-logo" src="/logo.webp" alt="" width="34" height="34" decoding="async"><span class="wordmark">Handy<span class="dot">.</span>Services</span>`;
    const year = new Date().getFullYear();

    return `<!doctype html>
<html lang="en-GB">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#1B2A4A">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">${robots}
    <link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">
    <meta property="og:site_name" content="${brand}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(metaDescription)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
${ogHtml}${imageHtml ? `\n${imageHtml}` : ''}
    <style>${INLINE_STYLE}</style>
${ldHtml}
</head>
<body>
    <header class="site">
        <div class="container">
            <a class="brand" href="${escapeHtml(SEO_BRAND.url)}">${brandMark}</a>
            <a class="book" href="${bookHref}">Get a free quote</a>
        </div>
    </header>
    <main>
${bodyHtml}
    </main>
    <footer class="site">
        <div class="container">
            <p class="fbrand">${brandMark}</p>
            <p><strong style="color:var(--slate)">${escapeHtml(SEO_BRAND.insured)}</strong> &middot; ${escapeHtml(SEO_BRAND.ratingValue)}&#9733; from ${footerReviews} Google reviews &middot; Fixed quotes, no call-out charge.</p>
            <p>&copy; ${year} ${brand}. Serving Nottingham, Derby &amp; the East Midlands. <a href="${bookHref}">Get a free quote</a></p>
            <p class="futil"><a href="/sitemap.xml">Sitemap</a> &middot; <a href="/llms.txt">llms.txt</a> &middot; <a href="/robots.txt">robots.txt</a></p>
        </div>
    </footer>
    <div class="mcta"><a href="${bookHref}">Get a free quote</a></div>
    <a class="ben-fab" href="${benWa}" target="_blank" rel="noopener" aria-label="Message Ben on WhatsApp">
        <span class="av"><img src="/assets/quote-images/ben-estimator.webp" alt="" width="44" height="44" decoding="async"><span class="wa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.03c-.24.68-1.42 1.31-1.95 1.35-.5.05-.98.24-3.3-.69-2.79-1.1-4.55-3.96-4.69-4.14-.14-.18-1.13-1.5-1.13-2.86 0-1.36.71-2.03.96-2.31.24-.27.53-.34.71-.34.18 0 .35 0 .5.01.16.01.38-.06.59.45.24.58.82 2 .89 2.14.07.14.12.31.02.49-.09.18-.14.29-.28.45-.14.16-.29.35-.42.47-.14.14-.28.28-.12.55.16.27.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.21 1.37.27.14.43.12.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.22.59-.14.24.09 1.51.71 1.77.84.27.14.44.2.5.31.07.11.07.63-.17 1.31z"/></svg></span></span>
        <span class="lab"><b>Chat to Ben</b><small>Questions? Tap to message</small></span>
    </a>
</body>
</html>`;
}
