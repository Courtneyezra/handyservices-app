import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { addDays, format, isWeekend } from 'date-fns';
import {
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Lock,
  MapPin,
  MessageCircle,
  Percent,
  Plus,
  Route,
  Shield,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react';

/**
 * /labs/booking — Homeowner booking card, restyled.
 *
 * A faithful, self-contained COPY of the live homeowner `UnifiedQuoteCard`
 * (booking card only) running on mock data — same structure, copy, sections
 * and interactions, with a fresh visual skin. Nothing here touches Stripe,
 * Google Places or the real reserve-slot endpoint; the reservation hold +
 * countdown is simulated client-side.
 *
 * Two booking lanes:
 *   • "I'm flexible" (Lane A) — default, cheapest. We pick a nearby day,
 *     usually within the felt 5-day promise, and pass on the route saving.
 *   • "I want a set date" (Lane B) — pin a specific day. Always carries a
 *     dedicated-visit fee over the flexible price, plus a small extra on
 *     out-of-our-way days and the flat Saturday surcharge.
 *
 * The pricing model above is LIVE. The one lab control — the "Pricing
 * breakdown" toggle — is a DEV inspector: OFF shows the customer view (each
 * set-date day shows only its all-in total; the fence is never narrated); ON
 * reveals the per-day breakdown (dedicated visit / out-of-our-way / Saturday)
 * so you can audit how every number is built.
 */

// ── Brand + model constants (mirrors UnifiedQuoteCard) ───────────────────
const GREEN = '#7DB00E';

// Flexible lane (Lane A) — the cheapest, default-on option. The number the
// customer reads is the "5-day" felt promise agreed in the pricing council;
// the internal scheduling buffer may run wider, but must never breach what we
// show. (Operational window is a separate business param — see TODO below.)
const FLEX_WINDOW_DAYS = 5;
const FLEX_DISCOUNT_PERCENT = 7;
const FLEX_MIN_SAVING_PENCE = 1200;
const FLEX_MAX_SAVING_PENCE = 3000;

// Set-date lane (Lane B) — pinning a specific day always carries a dedicated-
// visit fee on top of the flexible reference price (EVE: reference price + the
// value of a guaranteed dedicated visit). This is the load-bearing fence
// between the lanes; we show the two prices, we never narrate "+£X premium".
const DEDICATED_VISIT_PENCE = 1500; // £15 — set-date vs flexible

const SAT_SURCHARGE_PENCE = 3000;
const DEPOSIT_PERCENT = 0.3;
const PAY_FULL_DISCOUNT = 0.03;
const RULE_OF_100_PENCE = 10000;
const RESERVE_WINDOW_SECONDS = 5 * 60;

// Route-impact buckets. The out-of-our-way premium is LIVE in the model; the
// "nearby" saving is NOT sold by the day — it's the reward for going flexible,
// so Lane B treats a nearby day as standard (see the routeDeltaApplied clamp).
const ROUTE_NEARBY_PENCE = -1200;
const ROUTE_PREMIUM_PENCE = 1500; // £15 out-of-our-way — single tier (per council)

// TODO(business · F1): FLEX_FLOOR_PENCE — the marginal cost of a flexible job
// on our worst-batched day. The flexible price (£167 on a £180 job) MUST sit
// above this, or the fence loses money. Set once route data is measured, then
// assert the flexible total >= FLEX_FLOOR_PENCE. Not wired into display yet.

// ── Mock quote data ──────────────────────────────────────────────────────
const CUSTOMER_NAME = 'Sarah Whitlock';
const POSTCODE = 'NG7 2AB';

// The person behind the job. Putting a name + face in the flow is the single
// biggest lever for "local human" over "faceless platform".
// Placeholder — swap for the real founder/lead's name + initials.
const PROVIDER = {
  name: 'Marcus',
  initials: 'MR',
  area: 'Nottingham',
  homes: '200+ local homes',
};

const LINE_ITEMS = [
  { lineId: 'l1', label: 'Replace kitchen tap', pricePence: 9500 },
  { lineId: 'l2', label: 'Re-seal bath & basin', pricePence: 5500 },
  { lineId: 'l3', label: 'Hang 3 pictures', pricePence: 3000 },
];
const BASE_PRICE = LINE_ITEMS.reduce((s, i) => s + i.pricePence, 0); // £180

interface AddOn {
  id: string;
  name: string;
  price: number;
  description: string;
  popular?: boolean;
}
const ADD_ONS: AddOn[] = [
  {
    id: 'addon_task',
    name: 'Add a small extra task',
    price: 4000,
    description: 'Fix one more thing while we are there — up to 30 min',
    popular: true,
  },
  {
    id: 'addon_warranty',
    name: '12-month workmanship warranty',
    price: 2500,
    description: 'Extended cover on everything we touch',
  },
  {
    id: 'addon_callback',
    name: 'Priority callback',
    price: 0,
    description: 'Jump the queue if you ever need us back',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────
const gbp = (pence: number) => `£${Math.round(pence / 100)}`;
const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

type RouteBucket = 'nearby' | 'standard' | 'premium';
interface DateMeta {
  date: Date;
  isWeekend: boolean;
  isBlocked: boolean;
  satFee: number;
  routeBucket: RouteBucket;
  routeDelta: number;
}

function buildDates(): DateMeta[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DateMeta[] = [];
  let routeIdx = 0;
  // 4-day floor: the soonest selectable day is today + 4. We never offer a
  // next-day / "priority" slot — every set-date job needs lead time so Lane A
  // can keep building optimised days around it.
  for (let i = 4; out.length < 12 && i <= 30; i++) {
    const date = addDays(today, i);
    if (date.getDay() === 0) continue; // skip Sundays
    const weekend = isWeekend(date); // Saturdays only now
    // A couple of mid-grid "fully booked" days for realistic scarcity,
    // never a Saturday (we want the surcharge demo).
    const blocked = !weekend && (out.length === 6 || out.length === 9);

    let routeBucket: RouteBucket = 'standard';
    let routeDelta = 0;
    if (!blocked && !weekend) {
      const r = routeIdx % 4;
      routeIdx++;
      if (r === 1) {
        routeBucket = 'nearby';
        routeDelta = ROUTE_NEARBY_PENCE;
      } else if (r === 3) {
        routeBucket = 'premium';
        routeDelta = ROUTE_PREMIUM_PENCE;
      }
    }

    out.push({
      date,
      isWeekend: weekend,
      isBlocked: blocked,
      satFee: weekend ? SAT_SURCHARGE_PENCE : 0,
      routeBucket,
      routeDelta,
    });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
export default function BookingTwoLaneLab() {
  const dates = useMemo(() => buildDates(), []);

  // Lab controls
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Voice: personal (local human) vs standard (the platform-flavoured default
  // we're moving away from). Lets you flip the same card and compare the tone.
  const [personalVoice, setPersonalVoice] = useState(true);

  // Payment mode + lane (homeowner defaults to flexible / Lane A)
  const [payFull, setPayFull] = useState(false);
  const [useFlexBooking, setUseFlexBooking] = useState(true);

  // Date selection (set-date / Lane B)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);

  // Reservation hold (simulated)
  const [isReserving, setIsReserving] = useState(false);
  const [reservation, setReservation] = useState<{ lockId: string } | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(RESERVE_WINDOW_SECONDS);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);

  // Add-ons + reveal-on-commit booking flow
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [bookingStarted, setBookingStarted] = useState(false);
  const [addressLine, setAddressLine] = useState('');
  const [inlineEmail, setInlineEmail] = useState('');
  const [paid, setPaid] = useState(false);

  // ── Countdown ticker ───────────────────────────────────────────────────
  useEffect(() => {
    if (!reservation || detailsConfirmed) return;
    const id = window.setInterval(() => {
      setCountdownSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [reservation, detailsConfirmed]);

  // ── Derived pricing ──────────────────────────────────────────────────────
  const selectedDateMeta = selectedDate
    ? dates.find((d) => d.date.toDateString() === selectedDate.toDateString()) ?? null
    : null;

  const addOnsTotal = selectedAddOns.reduce(
    (sum, id) => sum + (ADD_ONS.find((a) => a.id === id)?.price ?? 0),
    0,
  );
  const saturdayPremiumApplied = !useFlexBooking && selectedDateMeta?.isWeekend ? selectedDateMeta.satFee : 0;

  // Dedicated-visit fee: choosing the set-date lane always adds it (EVE — the
  // value of a guaranteed dedicated visit over the flexible reference price).
  // LIVE in both views; the dev toggle only controls whether we narrate the
  // breakdown. Applies the moment "I want a set date" is chosen.
  const dedicatedVisitApplied = !useFlexBooking ? DEDICATED_VISIT_PENCE : 0;

  // Lane B never receives the "nearby" discount — that saving is reserved for
  // the flexible lane. Pinning a specific day costs standard, or a small
  // out-of-our-way premium, never less. Also live in both views.
  const routeDeltaApplied =
    !useFlexBooking && selectedDateMeta ? Math.max(0, selectedDateMeta.routeDelta) : 0;

  const flexSaving = Math.min(
    FLEX_MAX_SAVING_PENCE,
    Math.max(FLEX_MIN_SAVING_PENCE, Math.round((BASE_PRICE * FLEX_DISCOUNT_PERCENT) / 100)),
  );
  const flexDiscountApplied = useFlexBooking ? flexSaving : 0;

  const wasPrice = BASE_PRICE + addOnsTotal + dedicatedVisitApplied + saturdayPremiumApplied + routeDeltaApplied;
  const total =
    BASE_PRICE + addOnsTotal + dedicatedVisitApplied + saturdayPremiumApplied + routeDeltaApplied - flexDiscountApplied;
  const savingsPercent = flexDiscountApplied > 0 ? Math.round((flexDiscountApplied / BASE_PRICE) * 100) : 0;

  const payFullTotal = Math.round(total * (1 - PAY_FULL_DISCOUNT));
  const payFullSaving = total - payFullTotal;
  const depositAmount = Math.round(total * DEPOSIT_PERCENT);
  const balanceOnCompletion = total - depositAmount;

  const flexBadgeText =
    BASE_PRICE < RULE_OF_100_PENCE
      ? `−${Math.round((flexSaving / BASE_PRICE) * 100)}%`
      : `−£${Math.round(flexSaving / 100)}`;
  const flexSavingText =
    BASE_PRICE < RULE_OF_100_PENCE ? `${Math.round((flexSaving / BASE_PRICE) * 100)}%` : `£${Math.round(flexSaving / 100)}`;

  // ── Flow helpers ─────────────────────────────────────────────────────────
  function clearBookingFlow() {
    setIsReserving(false);
    setReservation(null);
    setDetailsConfirmed(false);
    setBookingStarted(false);
    setPaid(false);
    setCountdownSeconds(RESERVE_WINDOW_SECONDS);
  }

  function startReserve() {
    clearBookingFlow();
    setIsReserving(true);
    window.setTimeout(() => {
      setIsReserving(false);
      setReservation({ lockId: `mock-${Date.now()}` });
    }, 1200);
  }

  function goFlexible() {
    if (useFlexBooking) return;
    setUseFlexBooking(true);
    setSelectedDate(null);
    clearBookingFlow();
  }
  function goSetDate() {
    if (!useFlexBooking) return;
    setUseFlexBooking(false);
  }

  function pickDate(d: DateMeta) {
    if (d.isBlocked) return;
    const isSelected = !!selectedDate && selectedDate.toDateString() === d.date.toDateString();
    if (isSelected) {
      // tap the held day again to release it
      setSelectedDate(null);
      clearBookingFlow();
      return;
    }
    // Commit the day only. The arrival window is confirmed once that day's
    // route is built, so intra-day sequencing stays free to optimise.
    if (useFlexBooking) setUseFlexBooking(false);
    setSelectedDate(d.date);
    startReserve();
  }

  function toggleAddOn(id: string) {
    setSelectedAddOns((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetDemo() {
    setPayFull(false);
    setUseFlexBooking(true);
    setSelectedDate(null);
    setShowAllDates(false);
    setSelectedAddOns([]);
    setAddressLine('');
    setInlineEmail('');
    clearBookingFlow();
  }

  const firstName = CUSTOMER_NAME.split(' ')[0];
  const visibleDates = showAllDates ? dates : dates.slice(0, 8);
  const canShowAddons = useFlexBooking || !!selectedDate;
  const canShowBook = useFlexBooking || (!!reservation && !isReserving);
  const addressOk = addressLine.trim().length > 3;
  const emailOk = isValidEmail(inlineEmail);

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#F6F7F4] text-[#16223A] font-sans">
      {/* Lab control bar */}
      <div className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-black/5">
        <div className="max-w-5xl mx-auto px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">labs / booking</p>
            <h1 className="text-[15px] font-bold tracking-tight leading-tight">Homeowner booking card</h1>
            <p className="text-[11px] text-slate-500 leading-tight">
              Styled copy of the live card · mock data, no real payment
            </p>
          </div>

          <div className="flex items-center gap-4">
            <VoiceSwitch on={personalVoice} onToggle={() => setPersonalVoice((v) => !v)} />
            <BreakdownSwitch on={showBreakdown} onToggle={() => setShowBreakdown((v) => !v)} />
            <button
              type="button"
              onClick={resetDemo}
              className="text-[12px] font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-full border border-slate-200 hover:border-slate-300 transition-colors whitespace-nowrap"
            >
              Reset demo
            </button>
          </div>
        </div>
        {showBreakdown && (
          <div className="border-t border-amber-200 bg-amber-50">
            <div className="max-w-5xl mx-auto px-5 py-2 flex items-start gap-2 text-[11.5px] text-amber-800 leading-snug">
              <Route className="w-4 h-4 shrink-0 mt-px" />
              <span>
                <span className="font-bold">Dev view — pricing breakdown.</span> The model is live; this toggle only
                reveals how each set-date day is priced (dedicated-visit fee, plus a small extra on out-of-our-way
                days). Customers see only the per-day total, never the split — flip this off for the customer view.
                The route saving isn't sold by the day; it's the reward for going{' '}
                <span className="font-semibold">flexible</span>.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* The card */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="bg-white rounded-[28px] ring-1 ring-black/[0.04] shadow-[0_18px_60px_-24px_rgba(16,34,58,0.28)] p-5 sm:p-8">
          <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-5 md:gap-8 md:items-start">
            {/* ── PRICE COLUMN ──────────────────────────────────────────── */}
            <div className="text-center md:col-span-2 md:sticky md:top-28 md:self-start bg-gradient-to-br from-[#F2F8E6] to-white border border-[#7DB00E]/30 rounded-3xl p-6">
              {!payFull && savingsPercent > 0 && (
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-xs font-bold mb-4"
                  style={{ backgroundColor: GREEN }}
                >
                  <Percent className="w-3.5 h-3.5" />
                  SAVE {savingsPercent}%
                </div>
              )}

              <div className="text-slate-600 text-sm mb-1">{firstName}, your quote</div>

              <div className="mb-1">
                {savingsPercent > 0 && !payFull && (
                  <span className="text-slate-400 line-through text-xl mr-3">{gbp(wasPrice)}</span>
                )}
                <AnimatePresence mode="wait">
                  {payFull ? (
                    <motion.div
                      key="full"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="inline-block"
                    >
                      <div className="flex items-baseline justify-center gap-1.5">
                        <span className="text-slate-400 line-through text-xl mr-1">{gbp(total)}</span>
                        <span className="text-5xl font-black" style={{ color: GREEN }}>
                          {gbp(payFullTotal)}
                        </span>
                      </div>
                      <div className="text-xs mt-1 text-slate-500">
                        Save {gbp(payFullSaving)} · pay today, nothing on the day
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="deposit"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="inline-block"
                    >
                      <span className="text-5xl font-black" style={{ color: GREEN }}>
                        {gbp(total)}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Payment mode toggle */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-1 xl:grid-cols-2 gap-2 text-left">
                <PayModeCard
                  active={!payFull}
                  onClick={() => setPayFull(false)}
                  title="I'll reserve it"
                  sub={`${gbp(depositAmount)} now · ${gbp(balanceOnCompletion)} later`}
                />
                <PayModeCard
                  active={payFull}
                  onClick={() => setPayFull(true)}
                  title="I'll pay in full"
                  sub={
                    <>
                      {gbp(payFullTotal)} now ·{' '}
                      <span className="font-bold" style={{ color: GREEN }}>
                        save {gbp(payFullSaving)}
                      </span>
                    </>
                  }
                />
              </div>

              {/* Line-item breakdown */}
              <div className="mt-3 pt-3 border-t text-left" style={{ borderColor: 'rgba(125,176,14,0.2)' }}>
                <div className="space-y-1.5">
                  {LINE_ITEMS.map((item) => (
                    <div key={item.lineId} className="flex justify-between items-center text-[13px]">
                      <span className="text-slate-600">{item.label}</span>
                      <span className="font-semibold text-slate-900 tabular-nums">{gbp(item.pricePence)}</span>
                    </div>
                  ))}
                </div>

                {/* Included as standard */}
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2 text-slate-500">
                    Included as standard
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { icon: <Tag className="w-4 h-4" />, label: 'Fixed price' },
                      { icon: <Camera className="w-4 h-4" />, label: 'Photo report' },
                      { icon: <Sparkles className="w-4 h-4" />, label: 'Full cleanup' },
                      { icon: <Shield className="w-4 h-4" />, label: 'Guaranteed' },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex flex-col items-center justify-center rounded-lg py-2.5 px-1 text-center bg-slate-50 border border-slate-200"
                      >
                        <div className="mb-1" style={{ color: GREEN }}>
                          {item.icon}
                        </div>
                        <span className="text-[10px] font-medium leading-tight text-slate-600">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Optional extras (ticked add-ons) */}
                {selectedAddOns.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Optional extras</p>
                    {selectedAddOns.map((id) => {
                      const extra = ADD_ONS.find((a) => a.id === id);
                      if (!extra) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleAddOn(id)}
                          className="w-full text-left text-[13px] leading-snug rounded-md px-2 py-2 transition-colors"
                          style={{ backgroundColor: 'rgba(125,176,14,0.1)' }}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className="shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5"
                              style={{ backgroundColor: GREEN, borderColor: GREEN }}
                            >
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-slate-800">{extra.name}</span>
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                              {extra.price === 0 ? 'FREE' : `+${gbp(extra.price)}`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Discounts & surcharges */}
                {(flexDiscountApplied > 0 ||
                  (payFull && payFullSaving > 0) ||
                  dedicatedVisitApplied > 0 ||
                  saturdayPremiumApplied > 0 ||
                  routeDeltaApplied > 0) && (
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
                    {(flexDiscountApplied > 0 || (payFull && payFullSaving > 0)) && (
                      <div className="rounded-lg px-3 py-2 space-y-1.5" style={{ backgroundColor: 'rgba(125,176,14,0.1)' }}>
                        {flexDiscountApplied > 0 && (
                          <SaveRow
                            icon={<Zap className="w-3.5 h-3.5 shrink-0" />}
                            label={`Flexible booking${BASE_PRICE < RULE_OF_100_PENCE ? ` (${Math.round((flexDiscountApplied / BASE_PRICE) * 100)}% off)` : ''}`}
                            value={`−${gbp(flexDiscountApplied)}`}
                          />
                        )}
                        {payFull && payFullSaving > 0 && (
                          <SaveRow
                            icon={<Percent className="w-3.5 h-3.5 shrink-0" />}
                            label={`Pay in full (${Math.round(PAY_FULL_DISCOUNT * 100)}% off)`}
                            value={`−${gbp(payFullSaving)}`}
                          />
                        )}
                      </div>
                    )}

                    {/* Set-date fee. Customer view folds the dedicated-visit fee
                        and any out-of-our-way amount into ONE neutral line, so
                        the maths foots without narrating the route fence. Dev
                        view (toggle on) splits them out for inspection. */}
                    {showBreakdown ? (
                      <>
                        {dedicatedVisitApplied > 0 && (
                          <div className="flex justify-between items-center text-[13px]">
                            <span className="flex items-center gap-1.5 font-medium text-slate-600">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              Dedicated visit
                            </span>
                            <span className="font-semibold tabular-nums text-slate-700">
                              +{gbp(dedicatedVisitApplied)}
                            </span>
                          </div>
                        )}
                        {routeDeltaApplied > 0 && (
                          <div className="flex justify-between items-center text-[13px]">
                            <span className="flex items-center gap-1.5 font-medium text-amber-700">
                              <Route className="w-3.5 h-3.5 shrink-0" />
                              Out-of-the-way route
                            </span>
                            <span className="font-semibold tabular-nums text-amber-700">+{gbp(routeDeltaApplied)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      dedicatedVisitApplied + routeDeltaApplied > 0 && (
                        <div className="flex justify-between items-center text-[13px]">
                          <span className="flex items-center gap-1.5 font-medium text-slate-600">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            Dedicated visit
                          </span>
                          <span className="font-semibold tabular-nums text-slate-700">
                            +{gbp(dedicatedVisitApplied + routeDeltaApplied)}
                          </span>
                        </div>
                      )
                    )}

                    {saturdayPremiumApplied > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span className="font-medium text-amber-700">
                          {personalVoice ? 'Saturday visit' : 'Saturday surcharge — peak demand'}
                        </span>
                        <span className="font-semibold tabular-nums text-amber-700">
                          +{gbp(saturdayPremiumApplied)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Total */}
                <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between items-center font-bold">
                  <span className="text-slate-900">Total</span>
                  <span className="text-lg tabular-nums" style={{ color: GREEN }}>
                    {gbp(payFull ? payFullTotal : total)}
                  </span>
                </div>
              </div>

              {/* WhatsApp link */}
              <div className="mt-3 text-center">
                <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {personalVoice ? `Question? Message ${PROVIDER.name}` : 'Have a question? Chat with us'}
                </span>
              </div>
            </div>

            {/* ── BOOKING COLUMN ────────────────────────────────────────── */}
            <div className="space-y-6 md:col-span-3">
              {/* Who's coming — the human, first-person voice. Personal voice
                  only; standard voice stays deliberately faceless for contrast. */}
              {personalVoice && (
                <div className="flex items-center gap-3 rounded-2xl border border-[#7DB00E]/30 bg-[#F2F8E6]/60 px-3.5 py-3">
                  <span
                    className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold"
                    style={{ backgroundColor: GREEN }}
                  >
                    {PROVIDER.initials}
                  </span>
                  <div className="leading-tight">
                    <p className="text-[13px] font-bold text-slate-900">
                      {PROVIDER.name} &amp; the team · {PROVIDER.area}
                    </p>
                    <p className="text-[11.5px] text-slate-600">
                      I'll look after your job myself — and text you the morning before.
                    </p>
                  </div>
                </div>
              )}

              {/* Scheduling header */}
              <div>
                <h4 className="text-3xl font-extrabold tracking-tight mb-3 flex items-center justify-center gap-2.5 text-center text-slate-800">
                  <Calendar className="w-7 h-7" style={{ color: GREEN }} />
                  {personalVoice ? 'When suits you?' : 'Secure your slot'}
                </h4>

                {/* Two-lane toggle: flexible vs set date */}
                <div className="mb-4">
                  <div className="space-y-2">
                    <LaneButton
                      active={useFlexBooking}
                      onClick={goFlexible}
                      title="I'm flexible"
                      badge={flexBadgeText}
                      sub={`Usually within ${FLEX_WINDOW_DAYS} days · we text you the morning before`}
                    />
                    <LaneButton
                      active={!useFlexBooking}
                      onClick={goSetDate}
                      activeGreen
                      title="I want a set date"
                      trailing={<Calendar className="ml-auto w-4 h-4 text-slate-400" />}
                      sub="Pick the exact day that suits you"
                    />
                  </div>
                  {useFlexBooking && (
                    <p className="text-center text-[11px] mt-2 text-slate-500">
                      We fit you in on a day we're already nearby — usually within {FLEX_WINDOW_DAYS} days, and we text
                      you the morning before. You save {flexSavingText}.
                    </p>
                  )}
                </div>

                {/* Date grid */}
                <AnimatePresence initial={false}>
                  {!useFlexBooking && (
                    <motion.div
                      key="date-grid"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="-mx-1.5 px-1.5"
                    >
                      {/* Scarcity + nudge */}
                      <div className="mb-4 space-y-2 text-center">
                        <div className="flex items-center justify-center gap-2 text-base font-bold text-slate-800">
                          {personalVoice ? (
                            <>
                              <Calendar className="w-4 h-4" style={{ color: GREEN }} />
                              <span className="font-medium">Here's where I can fit you in</span>
                            </>
                          ) : (
                            <>
                              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                                <span
                                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                  style={{ backgroundColor: GREEN }}
                                />
                                <span
                                  className="relative inline-flex h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: GREEN }}
                                />
                              </span>
                              <span className="font-medium">Real-time availability · updated just now</span>
                            </>
                          )}
                        </div>
                        {!selectedDate && (
                          <div className="flex items-center justify-center gap-1 text-sm text-slate-500">
                            <ChevronDown className="w-5 h-5" style={{ color: GREEN }} />
                            {personalVoice ? 'Pick whatever day works' : 'Tap a date below'}
                          </div>
                        )}
                      </div>

                      {/* Dev-view route legend (narration only) */}
                      {showBreakdown && (
                        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Route className="w-3.5 h-3.5 text-amber-700" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                              Priced by route
                            </span>
                            <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-200/70 px-1.5 py-0.5 rounded">
                              Dev view
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-amber-900/80">
                            <LegendDot color="#94a3b8" text="Standard day" />
                            <LegendDot color="#D97706" text="Out of our way — small extra" />
                          </div>
                          <p className="mt-1.5 text-[10.5px] leading-snug text-amber-900/70">
                            Customers don't see these tags — only the per-day total. Want the cheapest day? Pick{' '}
                            <span className="font-semibold">I'm flexible</span> — we fit you into a day we're already
                            nearby and pass you the saving.
                          </p>
                        </div>
                      )}

                      {/* Grid */}
                      <div className="grid grid-cols-4 gap-2">
                        {visibleDates.map((d) => {
                          const isSelected =
                            !!selectedDate && selectedDate.toDateString() === d.date.toDateString();

                          // Customer view keeps every available day visually
                          // identical — the price difference shows only in the
                          // number, never a colour cue (that's the unspoken
                          // fence). Dev view flags out-of-our-way days amber.
                          let tile = 'bg-slate-100 text-slate-700 hover:bg-slate-200';
                          if (d.isBlocked) {
                            tile = 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200';
                          } else if (isSelected) {
                            tile = 'text-slate-900 ring-2 ring-offset-2';
                          } else if (showBreakdown && d.routeBucket === 'premium') {
                            tile = 'bg-amber-50 text-slate-700 hover:bg-amber-100 border border-amber-300';
                          }

                          return (
                            <button
                              key={d.date.toISOString()}
                              onClick={() => pickDate(d)}
                              disabled={d.isBlocked}
                              className={`p-3 rounded-xl text-center transition-all relative min-h-[97px] flex flex-col items-center justify-center ${tile}`}
                              style={isSelected ? { backgroundColor: GREEN } : undefined}
                            >
                              {d.isWeekend && !d.isBlocked && !isSelected && d.satFee > 0 && (
                                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-[#FFD43B] text-[#1B2A4A] px-1.5 py-0.5 rounded">
                                  SAT
                                </div>
                              )}
                              <div className="text-xs font-medium">{format(d.date, 'EEE')}</div>
                              <div className="text-lg font-bold">{format(d.date, 'd')}</div>
                              {d.isBlocked ? (
                                <div className="text-[9px] font-medium mt-0.5 text-slate-400">Fully booked</div>
                              ) : isSelected ? (
                                <div className="text-[9px] font-bold mt-0.5 text-slate-900">Day held</div>
                              ) : showBreakdown ? (
                                // Dev view: narrate the per-day delta only.
                                d.routeDelta > 0 ? (
                                  <div className="text-[10px] mt-0.5 font-semibold text-amber-600">
                                    +{gbp(d.routeDelta)}
                                  </div>
                                ) : d.satFee > 0 ? (
                                  <div className="text-[10px] mt-0.5 text-[#B8860B] font-semibold">+{gbp(d.satFee)}</div>
                                ) : null
                              ) : (
                                // Customer view: show the day's all-in total.
                                <div className="text-[11px] mt-0.5 font-bold text-slate-700 tabular-nums">
                                  {gbp(BASE_PRICE + DEDICATED_VISIT_PENCE + d.satFee + Math.max(0, d.routeDelta))}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {saturdayPremiumApplied > 0 && (
                        <p className="mt-2 text-[11px] text-center text-amber-700">
                          <span className="font-semibold">+{gbp(saturdayPremiumApplied)}</span>{' '}
                          {personalVoice ? 'for a Saturday visit' : 'Saturday surcharge — peak demand'}
                        </p>
                      )}

                      {!showAllDates && dates.length > 8 && (
                        <button
                          onClick={() => setShowAllDates(true)}
                          className="w-full mt-2 text-sm font-medium rounded-xl py-2.5 transition-colors bg-slate-50 border border-slate-200 hover:bg-slate-100"
                          style={{ color: GREEN }}
                        >
                          Show more dates...
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Reservation hold (set-date only) */}
              <AnimatePresence>
                {selectedDate && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-3"
                  >
                    {isReserving && (
                      <div className="p-4 rounded-xl border border-green-200 bg-green-50 flex items-center gap-3">
                        <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center">
                          <svg className="w-11 h-11 animate-spin" viewBox="0 0 44 44">
                            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3" stroke="rgba(125,176,14,0.15)" />
                            <circle
                              cx="22"
                              cy="22"
                              r="18"
                              fill="none"
                              strokeWidth="3"
                              strokeLinecap="round"
                              stroke={GREEN}
                              strokeDasharray={2 * Math.PI * 18}
                              strokeDashoffset={2 * Math.PI * 18 * 0.7}
                            />
                          </svg>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            {personalVoice ? 'Pencilling you in…' : 'Holding your slot…'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {format(selectedDate, 'EEE d MMM')} · just a moment
                          </div>
                        </div>
                      </div>
                    )}

                    {reservation &&
                      (() => {
                        const secsLeft = countdownSeconds;
                        const m = Math.floor(secsLeft / 60);
                        const s = secsLeft % 60;
                        const mmss = `${m}:${String(s).padStart(2, '0')}`;
                        const frac = Math.max(0, Math.min(1, secsLeft / RESERVE_WINDOW_SECONDS));
                        const urgent = !detailsConfirmed && secsLeft <= 90;
                        const C = 2 * Math.PI * 18;
                        const dateLine = `${format(selectedDate, 'EEE d MMM')} · we'll confirm your window`;
                        return (
                          <div
                            className={`p-4 rounded-xl border space-y-3 transition-colors ${
                              detailsConfirmed
                                ? 'bg-green-50 border-green-200'
                                : urgent
                                  ? 'bg-amber-50 border-amber-300'
                                  : 'bg-green-50 border-green-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {detailsConfirmed ? (
                                <div
                                  className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                                  style={{ backgroundColor: 'rgba(125,176,14,0.2)' }}
                                >
                                  <Check className="w-5 h-5" style={{ color: GREEN }} />
                                </div>
                              ) : (
                                <div className="relative w-11 h-11 flex-shrink-0">
                                  <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                                    <circle
                                      cx="22"
                                      cy="22"
                                      r="18"
                                      fill="none"
                                      strokeWidth="3"
                                      stroke={urgent ? 'rgba(245,158,11,0.2)' : 'rgba(125,176,14,0.2)'}
                                    />
                                    <circle
                                      cx="22"
                                      cy="22"
                                      r="18"
                                      fill="none"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      stroke={urgent ? '#fbbf24' : GREEN}
                                      strokeDasharray={C}
                                      strokeDashoffset={C * (1 - frac)}
                                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span
                                      className={`text-[11px] font-bold tabular-nums ${urgent ? 'text-amber-600' : 'text-slate-900'}`}
                                    >
                                      {mmss}
                                    </span>
                                  </div>
                                </div>
                              )}
                              <div>
                                <div className="text-sm font-bold text-slate-900">
                                  {detailsConfirmed
                                    ? personalVoice
                                      ? "You're all set"
                                      : 'Slot secured'
                                    : personalVoice
                                      ? `Holding it for you · ${mmss}`
                                      : `Slot held — ${mmss} left`}
                                </div>
                                <div className="text-xs text-slate-500">{dateLine}</div>
                              </div>
                            </div>
                            <div
                              className={`flex items-center gap-2 text-xs ${urgent ? 'text-amber-700' : 'text-slate-500'}`}
                            >
                              <Lock className="w-3.5 h-3.5" style={{ color: urgent ? '#fbbf24' : GREEN }} />
                              <span>
                                {detailsConfirmed
                                  ? personalVoice
                                    ? "Add your details and you're booked"
                                    : 'Finish payment to confirm your booking'
                                  : personalVoice
                                    ? "No rush — I'll hold it while you decide"
                                    : 'Secure it now before the slot is released'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Add-ons */}
              <AnimatePresence>
                {canShowAddons && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <h4 className="text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-2 text-slate-700">
                      <Tag className="w-4 h-4" style={{ color: GREEN }} />
                      Add extras (optional)
                    </h4>
                    <div className="space-y-2">
                      {ADD_ONS.map((addOn) => {
                        const isSelected = selectedAddOns.includes(addOn.id);
                        return (
                          <button
                            key={addOn.id}
                            onClick={() => toggleAddOn(addOn.id)}
                            className={`w-full p-4 rounded-xl flex items-center gap-4 transition-all border-2 ${
                              isSelected
                                ? 'bg-[#7DB00E]/15 border-[#7DB00E]'
                                : 'bg-slate-50 border-transparent hover:bg-slate-100'
                            }`}
                          >
                            <div
                              className={`p-2 rounded-lg ${isSelected ? 'text-slate-900' : 'bg-slate-200 text-slate-500'}`}
                              style={isSelected ? { backgroundColor: GREEN } : undefined}
                            >
                              {addOn.id.includes('task') ? (
                                <Zap className="w-5 h-5" />
                              ) : addOn.id.includes('warranty') ? (
                                <Shield className="w-5 h-5" />
                              ) : (
                                <Plus className="w-5 h-5" />
                              )}
                            </div>
                            <div className="flex-1 text-left">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-900">{addOn.name}</span>
                                {addOn.popular && (
                                  <span className="text-[10px] bg-amber-500/20 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                                    POPULAR
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-slate-500">{addOn.description}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold" style={{ color: addOn.price === 0 ? GREEN : '#0f172a' }}>
                                {addOn.price === 0 ? 'FREE' : `+${gbp(addOn.price)}`}
                              </div>
                              <div
                                className={`w-6 h-6 rounded-full flex items-center justify-center ml-auto ${isSelected ? '' : 'bg-slate-200'}`}
                                style={isSelected ? { backgroundColor: GREEN } : undefined}
                              >
                                {isSelected ? (
                                  <Check className="w-4 h-4 text-slate-900" />
                                ) : (
                                  <Plus className="w-4 h-4 text-slate-500" />
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Trust strip */}
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {(personalVoice
                  ? ['DBS checked', 'Fully insured', PROVIDER.homes]
                  : ['DBS Checked', '£2M Insured', '4.9★ Google']
                ).map((label) => (
                  <span
                    key={label}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: 'rgba(125,176,14,0.1)',
                      color: '#5a8a00',
                      borderColor: 'rgba(125,176,14,0.2)',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Payment / Book (reveal-on-commit) */}
              {canShowBook && (
                <div>
                  {paid ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-5 rounded-2xl border border-green-200 bg-green-50 text-center space-y-1.5"
                    >
                      <div
                        className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                        style={{ backgroundColor: 'rgba(125,176,14,0.2)' }}
                      >
                        <Check className="w-6 h-6" style={{ color: GREEN }} />
                      </div>
                      <div className="text-base font-bold text-slate-900">Booking confirmed</div>
                      <p className="text-xs text-slate-500">Demo only — no payment was taken.</p>
                    </motion.div>
                  ) : !bookingStarted ? (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3"
                    >
                      <button
                        onClick={() => setBookingStarted(true)}
                        className="w-full h-14 rounded-2xl font-bold text-lg text-slate-900 transition-all hover:brightness-95"
                        style={{ backgroundColor: GREEN }}
                      >
                        <span className="flex items-center justify-center gap-2">
                          {personalVoice ? 'Book it in' : 'Book my slot'}
                          <ChevronRight className="w-5 h-5" />
                        </span>
                      </button>
                      <p className="text-xs text-center text-slate-400">
                        {payFull
                          ? `${gbp(payFullTotal)} · secure payment by Stripe`
                          : `Just ${gbp(depositAmount)} to secure it · ${gbp(balanceOnCompletion)} on completion`}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-slate-700">
                        <CreditCard className="w-4 h-4" style={{ color: GREEN }} />
                        2. Complete your booking
                      </h4>
                      <div className="rounded-xl p-4 bg-slate-50">
                        {!detailsConfirmed ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-white border border-slate-200">
                              <MapPin className="w-4 h-4 shrink-0" style={{ color: GREEN }} />
                              <span className="font-semibold text-slate-900">{POSTCODE}</span>
                              <span className="text-[11px] whitespace-nowrap text-slate-500">— already on file</span>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-slate-600">Property address</label>
                              <input
                                type="text"
                                value={addressLine}
                                onChange={(e) => setAddressLine(e.target.value)}
                                placeholder="Start typing your address…"
                                className="w-full border border-slate-200 bg-white text-slate-900 rounded-lg p-3 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-slate-600">Email for receipt</label>
                              <input
                                type="email"
                                value={inlineEmail}
                                onChange={(e) => setInlineEmail(e.target.value)}
                                placeholder="your@email.com"
                                className="w-full border border-slate-200 bg-white text-slate-900 rounded-lg p-3 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => addressOk && emailOk && setDetailsConfirmed(true)}
                              disabled={!addressOk || !emailOk}
                              className={`w-full px-4 py-3 rounded-lg font-bold text-sm transition-all ${
                                addressOk && emailOk
                                  ? 'text-white hover:brightness-95'
                                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              }`}
                              style={addressOk && emailOk ? { backgroundColor: GREEN } : undefined}
                            >
                              Continue to payment
                            </button>
                          </div>
                        ) : (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              setPaid(true);
                            }}
                          >
                            {/* Mock card field (no real Stripe) */}
                            <div className="border border-slate-200 bg-white rounded-lg p-3 mb-4 flex items-center gap-2 text-slate-400 text-sm">
                              <CreditCard className="w-4 h-4" style={{ color: GREEN }} />
                              <span>Card number · MM / YY · CVC</span>
                              <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-300">demo</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mb-3 pt-3 border-t border-slate-200 text-sm text-slate-600">
                              <span>
                                Total{' '}
                                <span className="font-bold text-slate-900">{gbp(payFull ? payFullTotal : total)}</span>
                              </span>
                              <span className="text-[12px] text-right">
                                {payFull
                                  ? `Pay ${gbp(payFullTotal)} now`
                                  : `Pay ${gbp(depositAmount)} today · ${gbp(balanceOnCompletion)} on completion`}
                              </span>
                            </div>
                            <button
                              type="submit"
                              className="w-full h-14 rounded-2xl font-bold text-lg text-slate-900 transition-all hover:brightness-95"
                              style={{ backgroundColor: GREEN }}
                            >
                              <span className="flex items-center justify-center gap-2">
                                {payFull ? `Pay ${gbp(payFullTotal)} now` : `Pay ${gbp(depositAmount)} deposit`}
                                <ChevronRight className="w-5 h-5" />
                              </span>
                            </button>
                          </form>
                        )}
                        <p className="text-xs text-center mt-3 text-slate-400">
                          {payFull
                            ? 'Secure payment powered by Stripe'
                            : `${gbp(balanceOnCompletion)} remaining on completion · Secure payment by Stripe`}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────
function BreakdownSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-full border transition-colors ${
        on ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-amber-500' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      <span className="text-left leading-tight">
        <span className="block text-[12px] font-bold text-slate-800">Pricing breakdown</span>
        <span className="block text-[10px] text-slate-500">{on ? 'On · dev view' : 'Off · customer view'}</span>
      </span>
    </button>
  );
}

function VoiceSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-full border transition-colors ${
        on ? 'border-[#7DB00E]/40 bg-[#F2F8E6]' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <span
        className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: on ? GREEN : '#cbd5e1' }}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      <span className="text-left leading-tight">
        <span className="block text-[12px] font-bold text-slate-800">Voice</span>
        <span className="block text-[10px] text-slate-500">{on ? 'Personal · local' : 'Standard · platform'}</span>
      </span>
    </button>
  );
}

function PayModeCard({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl p-3 transition-colors active:scale-[0.99] border-2 ${
        active ? 'bg-[#7DB00E]/10 border-[#7DB00E]' : 'bg-slate-50 border-slate-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center"
          style={active ? { backgroundColor: GREEN, borderColor: GREEN } : { borderColor: '#94a3b8' }}
        >
          {active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </span>
        <span className="text-[13px] font-bold text-slate-900">{title}</span>
      </div>
      <p className="text-[10.5px] leading-snug mt-1 text-slate-500">{sub}</p>
    </button>
  );
}

function LaneButton({
  active,
  activeGreen,
  onClick,
  title,
  badge,
  trailing,
  sub,
}: {
  active: boolean;
  activeGreen?: boolean;
  onClick: () => void;
  title: string;
  badge?: string;
  trailing?: React.ReactNode;
  sub: string;
}) {
  // "I'm flexible" active = brand yellow; "I want a set date" active = brand green
  const activeClasses = active
    ? activeGreen
      ? 'bg-[#7DB00E]/10 border-[#7DB00E]'
      : 'bg-[#FFD43B]/20 border-[#FFD43B]'
    : 'bg-slate-50 border-slate-200';
  const dotStyle = active
    ? activeGreen
      ? { backgroundColor: GREEN, borderColor: GREEN }
      : { backgroundColor: '#FFD43B', borderColor: '#FFD43B' }
    : { borderColor: '#94a3b8' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl p-3 text-left transition-colors active:scale-[0.99] border-2 ${activeClasses}`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center" style={dotStyle}>
          {active && (
            <Check className="w-3 h-3" strokeWidth={3} style={{ color: activeGreen ? '#fff' : '#1B2A4A' }} />
          )}
        </span>
        <span className="text-[13px] font-bold text-slate-900">{title}</span>
        {badge && (
          <span className="ml-auto text-[10px] bg-[#FFD43B] text-[#1B2A4A] px-1.5 py-0.5 rounded-full font-bold">
            {badge}
          </span>
        )}
        {trailing}
      </div>
      <p className="text-[10.5px] leading-snug mt-1 text-slate-500">{sub}</p>
    </button>
  );
}

function SaveRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-[13px]">
      <span className="flex items-center gap-1.5 font-medium" style={{ color: GREEN }}>
        {icon}
        {label}
      </span>
      <span className="font-bold tabular-nums" style={{ color: GREEN }}>
        {value}
      </span>
    </div>
  );
}

function LegendDot({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {text}
    </span>
  );
}
