/**
 * ConfirmSlotPage — customer self-service slot picker for a flexible booking.
 *
 * The customer paid for a flexible job ("we pick the weekday within 7 days") and
 * received a tokenised link to this PUBLIC (no-login) page. We show a few
 * dispatch-approved dates:
 *   - our RECOMMENDED date is free (keeps their flexible-booking discount), and
 *   - any OTHER date costs a premium (the forfeited discount → Stripe top-up).
 * They pick one → we book it. Recommended pick confirms instantly; a premium pick
 * redirects to Stripe Checkout and is finalised server-side by webhook. If none of
 * the dates work they decline and the dispatcher sends a fresh set.
 *
 * Data contract (backend endpoints, all PUBLIC):
 *   GET  /api/slot-offer/:token            → { quoteId, customerName, jobDescription, postcode, address, categories, offer } | 404 { error }
 *   POST /api/slot-offer/:token/pick       { date, slot } → { confirmed:true } | { checkoutUrl } | 400 { error }
 *   POST /api/slot-offer/:token/decline    { reason? } → { ok:true }
 */

import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  MapPin,
  Sparkles,
  ShieldCheck,
  Loader2,
  CalendarX,
  Phone,
  Sun,
  Sunset,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { SlotOffer, SlotCandidate, OfferSlot } from '@shared/slot-offer';
import handyServicesLogo from '../assets/handy-logo-transparent.png';

// ==========================================
// Types — GET /api/slot-offer/:token response
// ==========================================

interface SlotOfferResponse {
  quoteId: string;
  customerName: string;
  jobDescription: string | null;
  postcode: string | null;
  address: string | null;
  categories: string[];
  offer: SlotOffer;
}

// ==========================================
// Helpers
// ==========================================

/** Prettify a raw category slug (e.g. "tv_mounting" → "TV Mounting"). Defensive:
 *  `categories` is typed as plain string[] in the contract, so we title-case and
 *  upper-case the few all-caps acronyms rather than relying on a typed lookup. */
function prettifyCategory(raw: string): string {
  const words = raw.split(/[_\s-]+/).filter(Boolean);
  return words
    .map((w) => {
      if (w.toLowerCase() === 'tv') return 'TV';
      if (w.toLowerCase() === 'diy') return 'DIY';
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** "2026-06-23" → "Tue 23 Jun" (timezone-safe: parse as local date, no UTC shift). */
function formatNiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** AM → "Morning (8am–1pm)", PM → "Afternoon (1–6pm)". */
function slotWindowLabel(slot: OfferSlot): string {
  return slot === 'am' ? 'Morning (8am–1pm)' : 'Afternoon (1–6pm)';
}

/** Short slot word for the success line. */
function slotShortLabel(slot: OfferSlot): string {
  return slot === 'am' ? 'morning' : 'afternoon';
}

const formatPounds = (pence: number) => `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;

/** A picked candidate is identified by its date+slot pair. */
const candidateKey = (c: { date: string; slot: OfferSlot }) => `${c.date}__${c.slot}`;

// ==========================================
// Brand header (navy bar — matches BookingConfirmedPage)
// ==========================================

function BrandHeader() {
  return (
    <header className="bg-handy-navy sticky top-0 z-50">
      <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center gap-3">
        <img src={handyServicesLogo} alt="Handy Services" className="h-7 w-auto shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-sm leading-tight">Handy Services</div>
          <div className="text-[11px] leading-tight">
            <span className="text-handy-yellow">{'★★★★★'}</span>{' '}
            <span className="text-white/75">4.9 from 300+ reviews</span>
          </div>
        </div>
        <a
          href="tel:07449501762"
          className="text-white text-sm font-semibold hover:text-handy-yellow flex items-center gap-1.5 shrink-0"
        >
          <Phone className="w-4 h-4" />
          <span className="hidden xs:inline">07449 501 762</span>
          <span className="xs:hidden">Call</span>
        </a>
      </div>
    </header>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-handy-bg font-sans">
      <BrandHeader />
      <main className="max-w-lg mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

// ==========================================
// Candidate card
// ==========================================

function SlotCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: SlotCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const isRecommended = candidate.premiumPence === 0;
  const SlotIcon = candidate.slot === 'am' ? Sun : Sunset;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full text-left rounded-2xl border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-handy-navy focus-visible:ring-offset-2',
        selected
          ? 'border-handy-navy shadow-lg'
          : 'border-handy-grid hover:border-handy-navy/40',
        isRecommended ? 'bg-handy-cream' : 'bg-white',
      ].join(' ')}
    >
      {/* Recommended ribbon */}
      {isRecommended && (
        <div className="flex items-center gap-1.5 bg-handy-navy text-white text-[11px] font-bold uppercase tracking-wide px-4 py-1.5 rounded-t-[14px]">
          <Sparkles className="w-3.5 h-3.5 text-handy-yellow" />
          Recommended {'·'} included
        </div>
      )}

      <div className="p-4 flex items-start gap-3">
        {/* Radio dot */}
        <div
          className={[
            'mt-1 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center',
            selected ? 'border-handy-navy bg-handy-navy' : 'border-handy-grid bg-white',
          ].join(' ')}
        >
          {selected && <div className="h-2 w-2 rounded-full bg-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-handy-navy font-bold text-lg leading-tight">
            <SlotIcon className="w-5 h-5 text-handy-yellow shrink-0" />
            <span>{formatNiceDate(candidate.date)}</span>
          </div>
          <div className="mt-0.5 text-sm text-handy-muted flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {slotWindowLabel(candidate.slot)}
          </div>

          {isRecommended ? (
            <div className="mt-2 text-sm font-semibold text-emerald-700">
              Keeps your discount
            </div>
          ) : (
            candidate.note && (
              <div className="mt-2 inline-block bg-handy-yellow/20 text-handy-navy text-xs font-semibold px-2 py-0.5 rounded-full capitalize">
                {candidate.note}
              </div>
            )
          )}
        </div>

        {/* Price */}
        <div className="text-right shrink-0">
          {isRecommended ? (
            <>
              <div className="text-emerald-700 font-extrabold text-base leading-tight">No extra cost</div>
              <div className="text-[11px] text-handy-muted">Included</div>
            </>
          ) : (
            <>
              <div className="text-handy-navy font-extrabold text-lg leading-tight">
                +{formatPounds(candidate.premiumPence)}
              </div>
              <div className="text-[11px] text-handy-muted">one-off</div>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ==========================================
// Confirmed state
// ==========================================

function ConfirmedState({
  picked,
  customerName,
  processing,
}: {
  picked: { date: string; slot: OfferSlot } | null;
  customerName: string;
  processing?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center pt-6"
    >
      <div className="mx-auto mb-5 h-20 w-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
        <CheckCircle2 className="h-12 w-12 text-white" strokeWidth={2.5} />
      </div>
      <h1 className="text-2xl font-extrabold text-handy-navy">
        {processing ? 'Payment received' : "You're booked in!"}
      </h1>
      {picked ? (
        <p className="mt-3 text-handy-muted text-base">
          We'll see you{' '}
          <span className="font-bold text-handy-navy">
            {formatNiceDate(picked.date)} {slotShortLabel(picked.slot)}
          </span>
          .
        </p>
      ) : (
        <p className="mt-3 text-handy-muted text-base">Your booking is confirmed.</p>
      )}

      <div className="mt-6 bg-handy-navy rounded-2xl px-5 py-5 text-left">
        <p className="text-white font-bold text-sm mb-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-handy-yellow" />
          What happens next
        </p>
        <ul className="space-y-2 text-white/80 text-sm">
          <li className="flex gap-2">
            <span className="text-handy-yellow font-bold">1.</span>
            We'll text {customerName?.split(' ')[0] || 'you'} a reminder the day before with your
            contractor's name.
          </li>
          <li className="flex gap-2">
            <span className="text-handy-yellow font-bold">2.</span>
            Your handyman arrives in the slot above {'—'} fully insured, fixed price.
          </li>
        </ul>
      </div>

      <p className="mt-6 text-sm text-handy-muted">
        Need to change something? Call us on{' '}
        <a href="tel:07449501762" className="font-semibold text-handy-navy underline">
          07449 501 762
        </a>
        .
      </p>
    </motion.div>
  );
}

// ==========================================
// Main page
// ==========================================

export default function ConfirmSlotPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ?paid=1 = Stripe success return for a premium pick. Finalised by the backstop effect
  // below (retrieves the Checkout Session + assigns) — the webhook is only a secondary path.
  const paidReturn = useMemo(
    () => new URLSearchParams(window.location.search).get('paid') === '1',
    [],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declined, setDeclined] = useState(false);

  const queryKey = ['slot-offer', token];

  const { data, isLoading, error } = useQuery<SlotOfferResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/slot-offer/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'This link has expired or was already used.');
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
    // If the customer just returned from Stripe, poll briefly so the webhook-driven
    // "confirmed" status can surface without a manual refresh.
    refetchInterval: paidReturn ? 4000 : false,
  });

  const candidates = data?.offer.candidates ?? [];
  const sortedCandidates = useMemo(
    () => [...candidates].sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    [candidates],
  );
  const selectedCandidate = sortedCandidates.find((c) => candidateKey(c) === selectedKey) || null;

  // ---- Webhook-INDEPENDENT finalisation of a premium pick ----
  // On the Stripe success return (?paid=1), actively ask the server to retrieve the Checkout
  // Session and assign the contractor, instead of waiting for the webhook to arrive. Safe to
  // call repeatedly (idempotent server-side); the 4s refetch loop re-runs this until the
  // offer flips to 'confirmed', so confirmation never depends on webhook delivery/config.
  useEffect(() => {
    if (!paidReturn || !token) return;
    const status = data?.offer.status;
    if (!status || status === 'confirmed') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/slot-offer/${token}/finalize`, { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && body.confirmed) {
          queryClient.invalidateQueries({ queryKey: ['slot-offer', token] });
        }
      } catch {
        /* transient — the refetch tick will retry */
      }
    })();
    return () => { cancelled = true; };
  }, [paidReturn, token, data?.offer.status, queryClient]);

  // ---- Pick (confirm or pay) ----
  const pickMutation = useMutation({
    mutationFn: async (candidate: SlotCandidate) => {
      const res = await fetch(`/api/slot-offer/${token}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: candidate.date, slot: candidate.slot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'That slot was just taken — please pick another.');
      }
      return body as { confirmed?: true; checkoutUrl?: string };
    },
    onSuccess: (body) => {
      if (body.checkoutUrl) {
        // Premium pick → off to Stripe Checkout. On return (?paid=1) the finalise backstop
        // effect assigns the contractor (webhook is only a secondary path).
        window.location.href = body.checkoutUrl;
        return;
      }
      if (body.confirmed) {
        // Free (recommended) pick → instantly booked. Refresh to render confirmed state.
        queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (err: Error) => {
      toast({
        title: 'Slot unavailable',
        description: err.message,
        variant: 'destructive',
      });
      setSelectedKey(null);
      // Pull a fresh offer in case the candidate set changed.
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // ---- Decline all ----
  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/slot-offer/${token}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not submit. Please try again.');
      }
      return res.json();
    },
    onSuccess: () => {
      setDeclined(true);
    },
    onError: (err: Error) => {
      toast({ title: 'Something went wrong', description: err.message, variant: 'destructive' });
    },
  });

  // Redirecting to Stripe — keep a spinner up so the button doesn't look idle.
  const redirecting = pickMutation.isSuccess && !!pickMutation.data?.checkoutUrl;

  // ---------- Loading ----------
  if (isLoading) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-handy-navy" />
          <p className="mt-4 text-handy-muted text-sm">Loading your dates{'…'}</p>
        </div>
      </PageShell>
    );
  }

  // ---------- 404 / error ----------
  if (error || !data) {
    return (
      <PageShell>
        <div className="text-center py-20">
          <div className="mx-auto mb-5 h-16 w-16 rounded-full bg-handy-grid/40 flex items-center justify-center">
            <CalendarX className="h-8 w-8 text-handy-muted" />
          </div>
          <h1 className="text-xl font-extrabold text-handy-navy">Link no longer active</h1>
          <p className="mt-2 text-handy-muted text-sm max-w-xs mx-auto">
            {error instanceof Error
              ? error.message
              : 'This link has expired or was already used.'}
          </p>
          <p className="mt-5 text-sm text-handy-muted">
            Need a hand? Call us on{' '}
            <a href="tel:07449501762" className="font-semibold text-handy-navy underline">
              07449 501 762
            </a>
            .
          </p>
        </div>
      </PageShell>
    );
  }

  const { offer, customerName, jobDescription, postcode, address, categories } = data;

  // ---------- Already confirmed (revisited link) OR Stripe success return ----------
  if (offer.status === 'confirmed' || (paidReturn && offer.status !== 'declined_all')) {
    const pickedSlot = offer.picked
      ? { date: offer.picked.date, slot: offer.picked.slot }
      : selectedCandidate
        ? { date: selectedCandidate.date, slot: selectedCandidate.slot }
        : null;
    // Stripe-return but webhook hasn't flipped status yet → "Payment received / processing".
    const processing = paidReturn && offer.status !== 'confirmed';
    return (
      <PageShell>
        <ConfirmedState picked={pickedSlot} customerName={customerName} processing={processing} />
      </PageShell>
    );
  }

  // ---------- Declined (just submitted) ----------
  if (declined || offer.status === 'declined_all') {
    return (
      <PageShell>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-20"
        >
          <div className="mx-auto mb-5 h-16 w-16 rounded-full bg-handy-yellow/20 flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-handy-yellow" />
          </div>
          <h1 className="text-xl font-extrabold text-handy-navy">Thanks {'—'} leave it with us</h1>
          <p className="mt-2 text-handy-muted text-sm max-w-xs mx-auto">
            We'll text you a few new options shortly. No need to do anything.
          </p>
          <p className="mt-5 text-sm text-handy-muted">
            In a hurry? Call us on{' '}
            <a href="tel:07449501762" className="font-semibold text-handy-navy underline">
              07449 501 762
            </a>
            .
          </p>
        </motion.div>
      </PageShell>
    );
  }

  // ---------- Active offer (status: 'sent') — pick a slot ----------
  const firstName = customerName?.split(' ')[0] || 'there';
  const prettyCategories = (categories || []).map(prettifyCategory).filter(Boolean);
  const jobFirstLine = (jobDescription || '').split('\n')[0].trim();
  const locationLine = address || postcode || null;

  return (
    <PageShell>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-handy-navy leading-tight">
          Hi {firstName} {'—'} let's lock in your visit
        </h1>
        <p className="mt-2 text-handy-muted text-sm">
          You're paid up and flexible. Pick the day that suits you best and we'll book your
          handyman in.
        </p>
      </motion.div>

      {/* Job summary card */}
      <Card className="mt-4 border-handy-grid bg-white p-4">
        {prettyCategories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {prettyCategories.map((c) => (
              <span
                key={c}
                className="bg-handy-navy/10 text-handy-navy text-xs font-semibold px-2 py-0.5 rounded-full"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {jobFirstLine && (
          <p className="text-handy-navy font-medium text-sm leading-snug">{jobFirstLine}</p>
        )}
        {locationLine && (
          <p className="mt-1.5 text-handy-muted text-xs flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {locationLine}
          </p>
        )}
      </Card>

      {/* Candidate cards (recommended first) */}
      <div className="mt-6 space-y-3">
        {sortedCandidates.map((candidate) => (
          <SlotCard
            key={candidateKey(candidate)}
            candidate={candidate}
            selected={candidateKey(candidate) === selectedKey}
            onSelect={() => setSelectedKey(candidateKey(candidate))}
          />
        ))}
      </div>

      {/* Discount-forfeit explainer */}
      <p className="mt-3 text-xs text-handy-muted leading-relaxed">
        A different day than our pick means giving up the flexible-booking discount, so it carries a
        small one-off charge. Our recommended day stays free.
      </p>

      {/* Confirm button */}
      <div className="mt-5 sticky bottom-4 z-10">
        <Button
          className="w-full h-14 text-base font-bold bg-handy-navy hover:bg-handy-navy/90 text-white shadow-xl disabled:opacity-60"
          disabled={!selectedCandidate || pickMutation.isPending || redirecting}
          onClick={() => selectedCandidate && pickMutation.mutate(selectedCandidate)}
        >
          {pickMutation.isPending || redirecting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              {redirecting ? 'Taking you to payment…' : 'Booking…'}
            </>
          ) : selectedCandidate && selectedCandidate.premiumPence > 0 ? (
            <>Confirm {'·'} pay {formatPounds(selectedCandidate.premiumPence)}</>
          ) : (
            'Confirm this slot'
          )}
        </Button>
      </div>

      {/* Decline */}
      <div className="mt-6 text-center pb-4">
        {!showDecline ? (
          <button
            type="button"
            onClick={() => setShowDecline(true)}
            className="text-sm text-handy-muted underline underline-offset-2 hover:text-handy-navy"
          >
            None of these dates work for me
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="text-left bg-white border border-handy-grid rounded-xl p-4"
          >
            <p className="text-sm font-semibold text-handy-navy">
              No problem {'—'} we'll send fresh dates.
            </p>
            <p className="text-xs text-handy-muted mt-1 mb-2">
              Anything we should know? (optional)
            </p>
            <Textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. I'm away next week, or mornings only"
              className="resize-none text-sm"
              rows={3}
            />
            <div className="flex gap-2 mt-3">
              <Button
                variant="outline"
                className="flex-1 border-handy-grid"
                onClick={() => setShowDecline(false)}
                disabled={declineMutation.isPending}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-handy-navy hover:bg-handy-navy/90 text-white"
                onClick={() => declineMutation.mutate()}
                disabled={declineMutation.isPending}
              >
                {declineMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Send me new dates'
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </PageShell>
  );
}
