import { Star, ShieldCheck, BadgeCheck } from 'lucide-react';

/**
 * ContractorProfile — the "meet your handyman" trust section on the contextual
 * quote page (person-led brand: customers buy Ben AND Craig).
 *
 * Props-driven so it can be fed from a contractor record once assigned-
 * contractor selection exists; today it's rendered with Craig's details
 * (mirrors the hardcoded letterhead). `onDark` themes it for a dark feature
 * section / the confirmation hub; `compact` drops the gallery + review.
 */
export interface ContractorProfileWork {
  url: string;
  label?: string;
}
export interface ContractorProfileProps {
  name: string;
  brandSuffix?: string;
  headshotUrl: string;
  /** Optional wide landscape image. When set, renders a full-width hero banner
   *  with the name/rating overlaid, instead of the contained headshot square. */
  bannerUrl?: string;
  rating: number;
  jobsCount: number;
  bio: string;
  badges?: string[];
  work?: ContractorProfileWork[];
  review?: { text: string; author: string; location?: string };
  /** Compact variant (no gallery/review) — for the confirmation hub. */
  compact?: boolean;
  /** Dark theme — for a navy feature section or the dark confirmation hub. */
  onDark?: boolean;
}

export function ContractorProfile({
  name,
  brandSuffix = 'HandyServices',
  headshotUrl,
  bannerUrl,
  rating,
  jobsCount,
  bio,
  badges = [],
  work = [],
  review,
  compact = false,
  onDark = false,
}: ContractorProfileProps) {
  const useBanner = !!bannerUrl && !compact;
  const c = onDark
    ? {
        eyebrow: 'text-[#a3d65f]',
        heading: 'text-white', accent: 'text-[#a3d65f]',
        name: 'text-white', brand: 'text-[#a3d65f]',
        strong: 'text-white', muted: 'text-slate-300', hair: 'text-slate-500',
        badge: 'text-slate-200 bg-white/10',
        reviewCard: 'bg-white/5 ring-1 ring-white/10',
        reviewText: 'text-slate-100', reviewAuthor: 'text-white', reviewLoc: 'text-slate-400',
      }
    : {
        eyebrow: 'text-[#5a8209]',
        heading: 'text-slate-900', accent: 'text-[#5a8209]',
        name: 'text-slate-900', brand: 'text-[#5a8209]',
        strong: 'text-slate-900', muted: 'text-slate-600', hair: 'text-slate-400',
        badge: 'text-slate-700 bg-slate-100',
        reviewCard: 'bg-slate-50 ring-1 ring-slate-200',
        reviewText: 'text-slate-800', reviewAuthor: 'text-slate-900', reviewLoc: 'text-slate-500',
      };

  const badgeRow = badges.length > 0 && (
    <div className="flex flex-wrap gap-2 mt-4">
      {badges.map((b) => (
        <span key={b} className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 ${c.badge}`}>
          <BadgeCheck className="w-3.5 h-3.5 text-[#7DB00E]" /> {b}
        </span>
      ))}
    </div>
  );

  return (
    <div className="w-full max-w-2xl md:max-w-3xl mx-auto">
      {useBanner ? (
        /* ── Full-width hero banner: a wide environmental shot of the handyman
           with the name/rating overlaid; bio + badges sit below. ── */
        <>
          <div className={`text-center text-xs md:text-sm font-bold uppercase tracking-[0.12em] mb-3 ${c.eyebrow}`}>
            Meet your handyman
          </div>
          <div className="relative rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl aspect-[16/10] sm:aspect-[16/8]">
            <img src={bannerUrl} alt={`${name}, your handyman`} className="w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 text-left">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl sm:text-4xl font-extrabold text-white drop-shadow">{name}</span>
                <span className="font-semibold text-[#a3d65f]">from {brandSuffix}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-white/90">
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <b className="text-white">{rating.toFixed(1)}</b>
                </span>
                <span className="text-white/50">·</span>
                <span><b className="text-white">{jobsCount}</b> jobs completed</span>
              </div>
            </div>
          </div>
          <p className={`mt-5 text-[15px] leading-relaxed text-left ${c.muted}`}>{bio}</p>
          {badgeRow}
        </>
      ) : (
        <>
          {/* Big intro header — quote-page "meet your handyman" moment. Dropped
              in compact mode (post-purchase reassurance doesn't re-announce). */}
          {!compact && (
            <div className="text-center mb-8">
              <div className={`text-xs md:text-sm font-bold uppercase tracking-[0.12em] mb-2 ${c.eyebrow}`}>
                Meet your handyman
              </div>
              <h3 className={`text-3xl md:text-4xl lg:text-5xl font-extrabold leading-[1.1] tracking-tight ${c.heading}`}>
                {name} <span className={c.accent}>does your job.</span>
              </h3>
            </div>
          )}

          {/* Headshot + bio */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 text-left">
            <div className="shrink-0">
              <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden ring-4 ring-[#7DB00E] shadow-xl">
                <img src={headshotUrl} alt={`${name}, your handyman`} className="w-full h-full object-cover" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`text-2xl font-extrabold ${c.name}`}>{name}</span>
                <span className={`font-semibold ${c.brand}`}>from {brandSuffix}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-sm">
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <b className={c.strong}>{rating.toFixed(1)}</b>
                </span>
                <span className={c.hair}>·</span>
                <span className={c.muted}><b className={c.strong}>{jobsCount}</b> jobs completed</span>
              </div>
              <p className={`mt-3 text-[15px] leading-relaxed ${c.muted}`}>{bio}</p>
              {badgeRow}
            </div>
          </div>
        </>
      )}

      {!compact && work.length > 0 && (
        <div className="mt-10">
          <h4 className={`text-lg md:text-xl font-bold mb-4 text-left ${c.heading}`}>Recent work</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {work.map((w, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden aspect-[4/3] group">
                <img src={w.url} alt={w.label || 'Recent job'} className="w-full h-full object-cover" />
                {w.label && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
                    <span className="text-white text-xs font-semibold">{w.label}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && review && (
        <figure className={`mt-8 rounded-2xl p-6 text-left ${c.reviewCard}`}>
          <div className="flex items-center gap-0.5 mb-2" aria-label="5 out of 5 stars">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <blockquote className={`text-[15px] md:text-base leading-snug ${c.reviewText}`}>
            &ldquo;{review.text}&rdquo;
          </blockquote>
          <figcaption className="mt-3 flex items-center gap-2 text-sm">
            <span className={`font-semibold ${c.reviewAuthor}`}>{review.author}</span>
            {review.location && <span className={c.reviewLoc}>· {review.location}</span>}
            <span className={`inline-flex items-center gap-1 font-medium ml-auto ${c.accent}`}>
              <ShieldCheck className="w-3.5 h-3.5" /> Verified
            </span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
