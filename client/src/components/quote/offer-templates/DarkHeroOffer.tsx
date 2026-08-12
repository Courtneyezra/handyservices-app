import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Blinds,
  Check,
  DoorClosed,
  DoorOpen,
  Droplets,
  Hammer,
  Image,
  PaintRoller,
  Star,
  Tv,
  Wrench,
} from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { HS_GREEN, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'dark_hero' template — the welcome-gift / add-task interstitial, rendered on
 * the SAME navy stage chrome as the flex offer screen (AtHomeOffer): full-bleed
 * #1D2D3D page, white wordmark, the quote-skin header (avatar in a green ring
 * with a check badge + "{Skin}'s got your job, {name}" + rating·jobs), a white
 * extrabold headline whose *starred* span gets the brand-green hand-drawn
 * underline, a white rounded card where the task tiles live, a solid green pill
 * CTA and a small underlined decline link. The loading orbit resolves onto the
 * chosen face; this screen opens with that exact composition centred and slides
 * it up into header position while the body rises in beneath — one continuous
 * scene, identical to the old flex offer's handoff.
 *
 * This is the ONE template that implements the task menu, in two coexisting
 * modes keyed off `offer.type`:
 *   - add_task:     MULTI-select tap-to-toggle tiles (label + £); accept
 *     returns the selected ids via `payload.addonIds`.
 *   - welcome_gift: SINGLE-select tiles ("pick one, on us") showing the real
 *     price struck through + a solid green FREE pill; accept returns
 *     `payload.giftId`.
 * Other offer types just show the benefits card + accept (payload-less).
 */

/** navy at an alpha — the benefit-row ink on the white card. */
const navy = (a: number) => `rgba(15,23,42,${a})`;

// ── Per-task tile icons ──────────────────────────────────────────────────────
// The task tiles should feel like picking a gift, not filling in a form: each
// tile leads with its job's icon in a green-tinted square. Resolution is
// id-first (the stable addonMenu ids), then category slug, then a handyman
// hammer so an unmapped future item still gets a sensible mark.
const ADDON_ICON_BY_ID: Record<string, typeof Check> = {
  addon_reseal_silicone: Droplets,
  addon_patch_paint: PaintRoller,
  addon_blind_curtain: Blinds,
  addon_door_adjust: DoorOpen,
  addon_door_handle: DoorClosed,
  addon_leaking_tap: Wrench,
  addon_tv_mount: Tv,
  addon_hang_mirror: Image,
};
const ADDON_ICON_BY_CATEGORY: Record<string, typeof Check> = {
  silicone_sealant: Droplets,
  painting: PaintRoller,
  curtain_blinds: Blinds,
  door_fitting: DoorClosed,
  plumbing_minor: Wrench,
  tv_mounting: Tv,
  general_fixing: Hammer,
};
// Exported: UnifiedQuoteCard's in-list "add a small job" ghost slot renders the
// same menu with the same per-task icons, so both surfaces stay in lockstep.
export const addonIconFor = (id: string, category?: string): typeof Check =>
  ADDON_ICON_BY_ID[id] ?? (category ? ADDON_ICON_BY_CATEGORY[category] : undefined) ?? Hammer;

// Hand-drawn underline as an inline SVG data URI (brand green stroke) — same
// asset as the flex offer's headline flourish.
const HAND_UNDERLINE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='12' viewBox='0 0 120 12'><path d='M2 8 C 30 2, 70 2, 118 7' stroke='%237DB00E' stroke-width='4' fill='none' stroke-linecap='round'/></svg>\")";

export function DarkHeroOffer({ offer, render, customerName, skin, addonMenu, onAccept, onDecline }: OfferTemplateProps) {
  const firstName = firstNameOf(customerName);
  const giftMode = offer.type === 'welcome_gift';
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const hasMenu = !!addonMenu && addonMenu.length > 0;
  // Gift mode pre-selects the first tile ONCE the (async-fetched) pool lands.
  // Found live 12 Aug: a customer tapped through with nothing registered as
  // selected and the accept silently claimed no gift — they had to re-claim it
  // from the quote card's add-a-job band. With a default pick, every accept
  // path carries a gift; deselecting (tap the chosen tile) or the decline link
  // remain the explicit no-gift paths, so the guard ref keeps a deliberate
  // deselect from being re-selected.
  const giftAutoPicked = useRef(false);
  useEffect(() => {
    if (giftMode && hasMenu && !giftAutoPicked.current && !selectedGift) {
      giftAutoPicked.current = true;
      setSelectedGift(addonMenu![0].id);
    }
  }, [giftMode, hasMenu, addonMenu, selectedGift]);
  const toggleAddon = (id: string) => {
    if (giftMode) {
      // Single-select: tapping the chosen tile clears it; tapping another moves the pick.
      setSelectedGift((prev) => (prev === id ? null : id));
      return;
    }
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isSelected = (id: string) => (giftMode ? selectedGift === id : selectedAddons.has(id));
  const selectedCount = giftMode ? (selectedGift ? 1 : 0) : selectedAddons.size;
  const selectedTotalPence = hasMenu && !giftMode
    ? addonMenu!.filter((a) => selectedAddons.has(a.id)).reduce((s, a) => s + (a.pricePence || 0), 0)
    : 0;
  const handleAccept = () => {
    if (giftMode) {
      onAccept(selectedGift ? { addonIds: [], giftId: selectedGift } : undefined);
      return;
    }
    onAccept(hasMenu ? { addonIds: Array.from(selectedAddons) } : undefined);
  };

  // Quote skin — same face as the loading reveal + "Meet your handyman".
  const skinName = skin?.name ?? 'Craig';
  const skinAvatarUrl = skin?.avatarUrl ?? '/assets/avatars/craig-avatar-1.webp';
  const skinRating = skin?.rating ?? '4.9';
  const skinJobsLabel = skin?.jobsLabel ?? '214 jobs';
  const skinFirstName = skinName.split(/\s+/)[0];

  // Headline emphasis: a *starred* span gets the hand-drawn underline (brand
  // flourish) in green — e.g. "pick one small job, *on us*". Tokens inside it
  // are resolved by `render`. Gift fallback: DB-stored copy predates the star
  // convention, so an unstarred headline ending in "on us" still gets the
  // flourish on that phrase. Otherwise → plain white headline.
  let hl = offer.headline ?? '';
  if (giftMode && !/\*[\s\S]+\*/.test(hl)) {
    hl = hl.replace(/(\bon us[.!]?)\s*$/i, '*$1*');
  }
  const m = hl.match(/^([\s\S]*?)\*([\s\S]+?)\*([\s\S]*)$/);
  const hlBefore = render(m ? m[1] : hl);
  const hlEmphasis = m ? render(m[2]) : '';
  const hlAfter = m ? render(m[3]) : '';

  // Subhead emphasis: a **double-starred** span renders bold.
  const sh = offer.subhead ?? '';
  const sm = sh.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*([\s\S]*)$/);
  const shBefore = render(sm ? sm[1] : sh);
  const shBold = sm ? render(sm[2]) : '';
  const shAfter = sm ? render(sm[3]) : '';

  // ── Intro continuity — the reveal IS this screen's header ───────────────
  // The loading orbit resolves onto the chosen face; this screen then OPENS
  // with the same composition (avatar + "{Skin}'s got your job" centred) and
  // SLIDES it up into header position while the offer body rises in below —
  // one continuous scene instead of a reveal screen and a separate offer.
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [settled, setSettled] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    // Brief centred hold so the handoff frame registers, then slide up.
    const t = setTimeout(() => setSettled(true), 650);
    return () => clearTimeout(t);
  }, [reduceMotion]);

  return (
    <div className="min-h-screen bg-[#1D2D3D] text-white flex flex-col items-center justify-center px-6 py-2 font-sans antialiased">
      <style>{`
        @keyframes hs-ah-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .hs-ah-rise { animation: hs-ah-rise .5s cubic-bezier(.23,1,.32,1) both; }
        .hs-ah-d1 { animation-delay: .06s; }
        .hs-ah-d2 { animation-delay: .12s; }
        .hs-ah-d3 { animation-delay: .18s; }
        .hs-ah-d4 { animation-delay: .24s; }
        .hs-ah-underline { background-image: ${HAND_UNDERLINE}; background-repeat: no-repeat; background-position: bottom left; background-size: 100% 10px; padding-bottom: 6px; white-space: nowrap; }
      `}</style>

      {/* Brand wordmark — identical to the loading stage's */}
      <div className="flex items-center gap-2 mb-2">
        <img src={handyLogo} alt="HandyServices" className="w-7 h-7 object-contain" />
        <span className="text-base font-extrabold tracking-tight text-white">
          Handy<span className="text-[#7DB00E]">Services</span>
        </span>
      </div>

      <div className="w-full max-w-md">
        {/* The reveal-as-header — same composition the loading orbit resolved
            onto (avatar + "{Skin}'s got your job" + rating·jobs). Starts
            vertically centred (the handoff frame), then slides up into header
            position as the offer body rises in beneath it. */}
        <div
          className="flex flex-col items-center text-center mb-2.5 transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: settled ? 'none' : 'translateY(24vh)' }}
        >
          {/* Avatar mirrors the loading resolve EXACTLY (w-32, border-4, check
              badge) so the stage handoff is pixel-invisible; it shrinks as it
              slides up into header scale. The wrapper height tracks the scale
              so the tile card below stays above the fold on small phones. */}
          <div
            className="relative flex items-start justify-center transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ height: settled ? 78 : 128 }}
          >
            <div
              className="relative origin-top transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ transform: settled ? 'scale(0.61)' : 'scale(1)' }}
            >
              <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#7DB00E] shadow-2xl">
                <img src={skinAvatarUrl} alt={`${skinName}, your handyman`} className="w-full h-full object-cover" />
              </div>
              <span className="absolute top-0 right-0 w-8 h-8 rounded-full bg-[#7DB00E] flex items-center justify-center ring-4 ring-[#1D2D3D]" aria-hidden="true">
                <Check className="w-4.5 h-4.5 text-white" strokeWidth={3.5} />
              </span>
            </div>
          </div>
          <div className="mt-2 leading-tight">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#a3d65f]">
              Your handyman
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {skinFirstName}&rsquo;s got your job{firstName ? `, ${firstName}` : ''}
            </div>
            <div className="mt-1 text-sm text-slate-300 inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <b className="text-white">{skinRating}</b>
              </span>
              <span className="text-slate-500">·</span>
              <span>{skinJobsLabel} completed</span>
            </div>
          </div>
        </div>

        {/* Offer body — hidden during the centred hold, rises in as the
            header slides up. */}
        <div
          className="text-center transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={settled
            ? { opacity: 1, transform: 'none', transitionDelay: '150ms' }
            : { opacity: 0, transform: 'translateY(28px)', pointerEvents: 'none' }}
        >
          {/* Editorial headline — hand-underlined gift phrase, kept compact so
              the tiles stay above the fold on a 375px phone. */}
          <h1 className="text-[1.35rem] sm:text-[1.7rem] leading-[1.12] font-extrabold tracking-tight text-white hs-ah-rise hs-ah-d1">
            {hlBefore}
            {hlEmphasis && (
              <span className="hs-ah-underline text-[#a3d65f]">{hlEmphasis}</span>
            )}
            {hlAfter}
          </h1>

          {offer.subhead && (
            <p className="mt-1.5 text-[13px] leading-snug text-slate-300 hs-ah-rise hs-ah-d2">
              {shBefore}
              {shBold && <strong className="font-extrabold text-white">{shBold}</strong>}
              {shAfter}
            </p>
          )}

          {/* The white card — where the flex offer's benefits checklist sat.
              With a menu it holds the task tiles (gift: single-select,
              add_task: multi-select); otherwise the benefit rows render in the
              same card, verbatim flex-offer styling. */}
          {hasMenu ? (
            <div className="mt-3 bg-white rounded-2xl border border-slate-200 shadow-lg p-2 hs-ah-rise hs-ah-d3">
              <div className="grid grid-cols-2 gap-2" role={giftMode ? 'radiogroup' : undefined}>
                {addonMenu!.map((item) => {
                  const on = isSelected(item.id);
                  const Icon = addonIconFor(item.id, item.category);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleAddon(item.id)}
                      role={giftMode ? 'radio' : undefined}
                      aria-checked={giftMode ? on : undefined}
                      aria-pressed={giftMode ? undefined : on}
                      className={`relative flex min-h-[100px] flex-col rounded-2xl border-2 px-2.5 pt-2.5 pb-2 text-left transition-all duration-150 active:scale-[0.97] ${
                        on
                          ? 'bg-[#f6fbec] -translate-y-0.5'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                      style={on
                        ? {
                            borderColor: HS_GREEN,
                            boxShadow: `0 0 0 1px ${HS_GREEN}, 0 10px 22px -10px rgba(125,176,14,0.55)`,
                          }
                        : undefined}
                    >
                      {/* Top row — the job's icon in a green square (solid when
                          picked) + a bold circle-check selection mark. */}
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors ${
                            on ? 'text-white' : 'text-[#5a8209]'
                          }`}
                          style={{ backgroundColor: on ? HS_GREEN : 'rgba(125,176,14,0.14)' }}
                          aria-hidden="true"
                        >
                          <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
                        </span>
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            on ? '' : 'border-slate-300 bg-white'
                          }`}
                          style={on ? { backgroundColor: HS_GREEN, borderColor: HS_GREEN } : undefined}
                          aria-hidden="true"
                        >
                          {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />}
                        </span>
                      </span>
                      <span className="mt-1.5 block text-[14px] font-bold leading-[1.22] text-slate-900">
                        {item.label}
                      </span>
                      {/* Price row pinned to the tile floor so the grid reads
                          as one even set whatever the label wraps to. */}
                      {giftMode ? (
                        <span className="mt-auto flex items-center gap-1.5 pt-1">
                          <span className="text-[13px] font-semibold tabular-nums text-slate-400 line-through">
                            £{Math.round(item.pricePence / 100)}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-[#7DB00E] px-2.5 py-[2px] text-[11px] font-extrabold tracking-wide text-white">
                            FREE
                          </span>
                        </span>
                      ) : (
                        <span className="mt-auto block pt-1 text-[15px] font-extrabold tabular-nums text-[#5a8209]">
                          +£{Math.round(item.pricePence / 100)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* add_task keeps its running total; the gift pick needs no
                  confirm line — the solid-green tile + CTA say it, and the
                  extra row would push the CTA below the 375×812 fold. */}
              {selectedCount > 0 && !giftMode && (
                <p className="mt-2 text-center text-[12px] font-bold" style={{ color: navy(0.75) }}>
                  {selectedCount} extra job{selectedCount === 1 ? '' : 's'} · +£{Math.round(selectedTotalPence / 100)}
                </p>
              )}
            </div>
          ) : (
            offer.benefits?.length > 0 && (
              <div className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-lg p-4 hs-ah-rise hs-ah-d3">
                <ul className="space-y-1">
                  {offer.benefits.map((b, i) => (
                    <li key={i} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left">
                      <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[#7DB00E] text-white">
                        <Check className="w-5 h-5" strokeWidth={3} />
                      </span>
                      <span className="text-[14px] font-medium" style={{ color: navy(0.85) }}>{render(b.text)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          {/* CTAs — solid green pill + small underlined decline link */}
          <div className="mt-3 space-y-1.5 hs-ah-rise hs-ah-d4">
            <button
              onClick={handleAccept}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-extrabold text-white shadow-lg bg-[#7DB00E] hover:bg-[#6da000] transition-all active:scale-[0.98] whitespace-nowrap"
            >
              {hasMenu && selectedCount === 0 ? 'Continue to my price' : render(offer.acceptLabel)}
              <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
            </button>
            <button
              onClick={onDecline}
              className="w-full text-center text-sm font-semibold py-1 underline underline-offset-4 text-slate-300 decoration-white/25"
            >
              {render(offer.declineLabel)}
            </button>
          </div>

          {offer.finePrint && (
            <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400 hs-ah-rise hs-ah-d4">
              {render(offer.finePrint)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
