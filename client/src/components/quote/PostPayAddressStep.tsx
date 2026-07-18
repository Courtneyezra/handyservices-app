import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, MapPin, Star } from 'lucide-react';

/**
 * PostPayAddressStep — Model A's post-payment address capture.
 *
 * The customer pays a deposit first (one-tap Apple/Google Pay), THEN lands
 * here to tell us exactly where the job is. We already know their postcode
 * from the quote, so it's pre-filled and editable; the rest of the fields
 * pin down the door Craig knocks on. On reopen the saved address collapses to
 * a compact summary with a "Change" escape hatch — mirrors PostPayDayPicker.
 */
export interface PostPayAddressStepProps {
  quoteId: string;
  /** Postcode already known from the quote — pre-fills the field, editable. */
  initialPostcode?: string;
  /** Optional line 1 hint (e.g. parsed from the lead) to pre-fill. */
  initialLine1?: string;
  /** Already-saved address — renders the summary state instead of the form. */
  initialSaved?: { line1: string; line2?: string; city: string; postcode: string; accessNotes?: string };
  /** Fired after a successful save with the composed address. */
  onSaved: (addr: { line1: string; line2?: string; city: string; postcode: string; accessNotes?: string }) => void;
}

type SavedAddress = { line1: string; line2?: string; city: string; postcode: string; accessNotes?: string };

export function PostPayAddressStep({
  quoteId,
  initialPostcode,
  initialLine1,
  initialSaved,
  onSaved,
}: PostPayAddressStepProps) {
  const [line1, setLine1] = useState(initialSaved?.line1 ?? initialLine1 ?? '');
  const [line2, setLine2] = useState(initialSaved?.line2 ?? '');
  const [city, setCity] = useState(initialSaved?.city ?? '');
  const [postcode, setPostcode] = useState(initialSaved?.postcode ?? initialPostcode ?? '');
  const [accessNotes, setAccessNotes] = useState(initialSaved?.accessNotes ?? '');

  const [savedAddr, setSavedAddr] = useState<SavedAddress | null>(initialSaved ?? null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The page hydrates the quote from a localStorage cache and refreshes it
  // async — a saved address can arrive AFTER mount. Adopt it unless the
  // customer is mid-edit or has already saved this session.
  useEffect(() => {
    if (initialSaved && !editing && !savedAddr) {
      setSavedAddr(initialSaved);
      setLine1(initialSaved.line1);
      setLine2(initialSaved.line2 ?? '');
      setCity(initialSaved.city);
      setPostcode(initialSaved.postcode);
      setAccessNotes(initialSaved.accessNotes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialSaved?.line1,
    initialSaved?.line2,
    initialSaved?.city,
    initialSaved?.postcode,
    initialSaved?.accessNotes,
  ]);

  const trimmedLine1 = line1.trim();
  const trimmedLine2 = line2.trim();
  const trimmedCity = city.trim();
  const trimmedPostcode = postcode.trim();
  const trimmedNotes = accessNotes.trim();
  const canSubmit = trimmedLine1.length > 0 && trimmedCity.length > 0;

  const submit = async () => {
    if (saving || !canSubmit) return;
    setSaving(true);
    setSaveError(null);

    const addr: SavedAddress = {
      line1: trimmedLine1,
      city: trimmedCity,
      postcode: trimmedPostcode,
    };
    if (trimmedLine2) addr.line2 = trimmedLine2;
    if (trimmedNotes) addr.accessNotes = trimmedNotes;

    try {
      const res = await fetch(`/api/public/quote/${quoteId}/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addr),
      });
      if (!res.ok) throw new Error('save failed');
      setSavedAddr(addr);
      setEditing(false);
      onSaved(addr);
    } catch {
      setSaveError("Couldn't save just now — please try again, or reply to our text and we'll sort it.");
    } finally {
      setSaving(false);
    }
  };

  const showSummary = savedAddr && !editing;

  const summaryLines = savedAddr
    ? [savedAddr.line1, savedAddr.line2, savedAddr.city, savedAddr.postcode].filter(
        (l): l is string => Boolean(l && l.trim()),
      )
    : [];

  const inputBase =
    'w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white placeholder-slate-500 text-base ' +
    'focus:outline-none focus:border-[#7DB00E] focus:ring-1 focus:ring-[#7DB00E] transition-colors';
  const labelBase = 'block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-1.5';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-[#1D2D3D] rounded-3xl overflow-hidden shadow-2xl"
    >
      <div className="px-5 py-6 sm:px-8 sm:py-7">
        {/* Craig letterhead — the person turning up at this address */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E] shrink-0">
            <img src="/assets/avatars/craig-avatar-1.webp" alt="Craig, your assigned handyman" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 text-left">
            <div className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold">Your assigned handyman</div>
            <div className="text-white font-bold leading-tight">
              Craig <span className="text-[#7DB00E] text-sm font-normal">from HandyServices</span>
            </div>
            <p className="flex items-center gap-1 text-[11px] text-slate-300 mt-0.5">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
              <span><b className="text-white">4.9</b> · 214 jobs</span>
            </p>
          </div>
        </div>

        {showSummary ? (
          /* ── Saved state — reopens read as "sorted", with a change escape hatch ── */
          <div className="text-left">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#7DB00E]">
                <Check className="w-4 h-4 text-white" />
              </span>
              <h3 className="text-white font-bold text-lg">Address saved</h3>
            </div>
            <div className="flex items-start gap-2 mb-3">
              <MapPin className="w-4 h-4 text-[#7DB00E] mt-0.5 shrink-0" />
              <address className="not-italic text-slate-200 text-sm leading-relaxed">
                {summaryLines.map((l, i) => (
                  <span key={i} className="block">{l}</span>
                ))}
              </address>
            </div>
            {savedAddr?.accessNotes && (
              <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 mb-1">
                <div className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold mb-0.5">Access notes</div>
                <p className="text-slate-200 text-sm leading-relaxed">{savedAddr.accessNotes}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 text-[#7DB00E] text-sm font-semibold underline underline-offset-2"
            >
              Change
            </button>
          </div>
        ) : (
          /* ── Collection state — the address form ── */
          <div className="text-left">
            <h3 className="text-white font-bold text-xl leading-tight mb-1">
              Where's the job?
            </h3>
            <p className="text-slate-400 text-xs leading-snug mb-4">
              So Craig knows exactly where to come.
            </p>

            <div className="space-y-3.5">
              <div>
                <label htmlFor="pps-line1" className={labelBase}>Address line 1</label>
                <input
                  id="pps-line1"
                  type="text"
                  value={line1}
                  onChange={e => setLine1(e.target.value)}
                  autoComplete="address-line1"
                  placeholder="e.g. 14 Mapperley Road"
                  className={inputBase}
                />
              </div>

              <div>
                <label htmlFor="pps-line2" className={labelBase}>
                  Address line 2 <span className="text-slate-500 normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="pps-line2"
                  type="text"
                  value={line2}
                  onChange={e => setLine2(e.target.value)}
                  autoComplete="address-line2"
                  placeholder="Flat, building, etc."
                  className={inputBase}
                />
              </div>

              <div>
                <label htmlFor="pps-city" className={labelBase}>Town / City</label>
                <input
                  id="pps-city"
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  autoComplete="address-level2"
                  placeholder="Nottingham"
                  className={inputBase}
                />
              </div>

              <div>
                <label htmlFor="pps-postcode" className={labelBase}>Postcode</label>
                <input
                  id="pps-postcode"
                  type="text"
                  value={postcode}
                  onChange={e => setPostcode(e.target.value)}
                  autoComplete="postal-code"
                  placeholder="NG3 5AA"
                  className={`${inputBase} uppercase`}
                />
              </div>

              <div>
                <label htmlFor="pps-notes" className={labelBase}>
                  Access notes <span className="text-slate-500 normal-case font-normal">(optional)</span>
                </label>
                <textarea
                  id="pps-notes"
                  value={accessNotes}
                  onChange={e => setAccessNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. key safe code, side gate, parking, buzzer"
                  className={`${inputBase} resize-none`}
                />
              </div>
            </div>

            {saveError && (
              <p className="text-amber-400 text-sm mt-3">{saveError}</p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || saving}
              className={`w-full rounded-xl py-3.5 mt-4 font-bold text-base transition-all ${
                canSubmit
                  ? 'bg-[#FFE500] text-handy-navy shadow-lg shadow-[#FFE500]/20 hover:bg-[#f5dc00]'
                  : 'bg-white/10 text-slate-500 cursor-not-allowed'
              }`}
            >
              {saving ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
              ) : (
                'Save address'
              )}
            </button>
            <p className="text-slate-400 text-xs text-center mt-2.5">
              We only share this with Craig for your job — and text your confirmed day at least 2 days ahead.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
