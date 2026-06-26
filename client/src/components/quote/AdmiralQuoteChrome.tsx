import { ShieldCheck, Check, Star, CalendarCheck, Hash, PlusCircle } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';

/**
 * Admiral-style quote-page chrome (the ?v=admiral variant). Two presentational
 * primitives the page composes around its EXISTING contextual pieces.
 *
 * The layout mirrors the Admiral car-insurance quote page: a LIGHT, navy-led
 * hero on white — blue greeting, navy "Here's your quote for {job}", the item
 * image, a big navy price with a monthly/deposit alternative, "includes all…",
 * then a meta-row list (valid-until / ref / guarantee / add-more) and a trust
 * strip. Green is reserved for the single primary action, exactly like Admiral.
 *
 *  - AdmiralPriceHero — the "pricing first" hero that opens the page.
 *  - AdmiralSection — a clean white card wrapper for the sections below it.
 *
 * No pricing logic lives here — the page owns the numbers and passes them in.
 */

const poundsGBP = (pence: number) => `£${Math.round((pence || 0) / 100).toLocaleString('en-GB')}`;

const ADMIRAL_NAVY = '#0b2a52'; // headings + price
const ADMIRAL_BLUE = '#1d6fe0'; // greeting + meta-row icons + links

interface AdmiralPriceHeroProps {
  customerName?: string;
  /** The hero headline — the AI-generated contextual headline (the same copy the
   *  original contextual ValueHero shows). Falls back upstream to a quote label. */
  headline?: string;
  /** The "insured item" image shown under the headline. */
  heroImage?: string;
  /** Quote total in pence (server-authoritative). */
  totalPence: number;
  /** Deposit due today in pence. */
  depositPence: number;
  /** Meta-row: how long the price holds. */
  validUntil?: string;
  /** Meta-row: quote reference. */
  quoteRef?: string;
  rating?: string;
  reviews?: number;
}

export function AdmiralPriceHero({
  customerName,
  headline,
  heroImage,
  totalPence,
  depositPence,
  validUntil,
  quoteRef,
  rating = '4.9',
  reviews = 127,
}: AdmiralPriceHeroProps) {
  const firstName = customerName?.trim().split(/\s+/)[0];

  return (
    <div className="bg-white">
      {/* Brand wordmark */}
      <div className="flex items-center justify-center gap-2 px-4 pt-7 pb-1">
        <img src={handyLogo} alt="HandyServices" className="w-8 h-8 object-contain" />
        <span className="text-lg font-extrabold tracking-tight" style={{ color: ADMIRAL_NAVY }}>
          Handy<span className="text-[#7DB00E]">Services</span>
        </span>
      </div>

      {/* Centered hero — greeting → headline → item → price → action */}
      <div className="mx-auto w-full max-w-md px-6 pt-4 pb-7 text-center">
        {firstName && (
          <p className="text-lg font-semibold mb-1" style={{ color: ADMIRAL_BLUE }}>
            Hi {firstName}!
          </p>
        )}
        <h1
          className="text-[26px] sm:text-[32px] font-extrabold leading-tight tracking-tight"
          style={{ color: ADMIRAL_NAVY }}
        >
          {headline || <>Here&rsquo;s your quote</>}
        </h1>

        {heroImage && (
          <div className="mt-6 mb-1 flex justify-center">
            <div className="w-full max-w-xs sm:max-w-sm aspect-[16/10] rounded-2xl overflow-hidden bg-slate-100 ring-1 ring-slate-200 shadow-sm">
              <img
                src={heroImage}
                alt=""
                className="w-full h-full object-cover object-[15%_30%] scale-[1.6]"
              />
            </div>
          </div>
        )}

        {/* Big price */}
        <div className="mt-5">
          <span
            className="text-6xl sm:text-7xl font-extrabold leading-none tracking-tight"
            style={{ color: ADMIRAL_NAVY }}
          >
            {poundsGBP(totalPence)}
          </span>{' '}
          <span className="text-xl font-semibold text-slate-400 align-baseline">fixed</span>
        </div>
        {depositPence > 0 && (
          <p className="mt-3 text-base text-slate-600">
            or{' '}
            <span className="font-bold" style={{ color: ADMIRAL_NAVY }}>
              {poundsGBP(depositPence)}
            </span>{' '}
            deposit today, pay the rest after
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">includes all labour &amp; materials</p>
      </div>

      {/* Meta-row list (icons in Admiral blue) */}
      <div className="bg-slate-50 border-y border-slate-200">
        <ul className="mx-auto w-full max-w-md px-6 py-2 divide-y divide-slate-200 text-sm text-slate-700">
          {validUntil && (
            <li className="flex items-center gap-3 py-2.5">
              <CalendarCheck className="w-4 h-4 shrink-0" style={{ color: ADMIRAL_BLUE }} />
              Your price is valid until {validUntil}
            </li>
          )}
          {quoteRef && (
            <li className="flex items-center gap-3 py-2.5">
              <Hash className="w-4 h-4 shrink-0" style={{ color: ADMIRAL_BLUE }} />
              Quote ref: {quoteRef}
            </li>
          )}
          <li className="flex items-center gap-3 py-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: ADMIRAL_BLUE }} />
            12-month workmanship guarantee included
          </li>
          <li className="flex items-center gap-3 py-2.5">
            <PlusCircle className="w-4 h-4 shrink-0" style={{ color: ADMIRAL_BLUE }} />
            Save even more when you add another task
          </li>
        </ul>
      </div>

      {/* Trust strip */}
      <div className="bg-white px-4 py-4 flex items-center justify-center gap-x-3 gap-y-2 flex-wrap text-xs text-slate-600 font-medium">
        <span className="inline-flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-[#00b67a] fill-[#00b67a]" /> {rating} · {reviews}+ reviews
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: ADMIRAL_BLUE }} /> £2M Insured
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1">
          <Check className="w-3.5 h-3.5 text-[#7DB00E]" strokeWidth={3} /> DBS Checked
        </span>
      </div>
    </div>
  );
}

interface AdmiralSectionProps {
  id?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /** When true, render children directly without the white card chrome. */
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function AdmiralSection({
  id,
  eyebrow,
  title,
  subtitle,
  bare = false,
  className = '',
  children,
}: AdmiralSectionProps) {
  return (
    <section id={id} className={`scroll-mt-4 bg-slate-50 px-4 py-6 md:py-8 ${className}`}>
      <div className="mx-auto w-full max-w-2xl md:max-w-3xl">
        {(eyebrow || title || subtitle) && (
          <div className="text-center mb-5">
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: ADMIRAL_BLUE }}>
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ADMIRAL_NAVY }}>
                {title}
              </h2>
            )}
            {subtitle && <p className="text-slate-500 mt-2 text-sm sm:text-base">{subtitle}</p>}
          </div>
        )}
        {bare ? (
          children
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-6">{children}</div>
        )}
      </div>
    </section>
  );
}
