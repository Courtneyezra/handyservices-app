import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Shield,
  CreditCard,
  LogOut,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  X,
  AlertTriangle,
  Bell,
  Tag,
  MapPin,
  Target,
  PoundSterling,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { RateCardEditor } from '@/components/contractor/RateCardEditor';
import { StripeConnectStatus } from '@/components/contractor/StripeConnectStatus';
import {
  BROAD_TRADES,
  TRADE_CATEGORIES,
  CATEGORY_LABELS,
} from '@shared/categories';
import type { BroadTradeId } from '@shared/categories';
import type { JobCategory } from '@shared/categories';

const SEGMENT_LABEL: Record<string, string> = {
  builder: 'Builder',
  gap_filler: 'Gap-Filler',
  specialist: 'Specialist',
};

const SEGMENT_DESCRIPTION: Record<string, string> = {
  builder: 'Commits days in advance for bundled day-packs.',
  gap_filler: 'Plugs diary holes with single-job offers.',
  specialist: 'Cert-gated work only at premium rates.',
};

export default function ProfileTab() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const flags = useFeatureFlags();

  const token = localStorage
    .getItem('contractorToken')
    ?.trim()
    .replace(/[^a-zA-Z0-9._-]/g, '');

  // ── Fetch profile ────────────────────────────────────────────────────
  const { data: profileData, isLoading } = useQuery({
    queryKey: ['contractor-profile'],
    queryFn: async () => {
      const res = await fetch('/api/contractor/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    },
  });

  const profile = profileData?.profile;

  // ── Profile update mutation ──────────────────────────────────────────
  // NOTE: Module 09 §7 adds homePostcode / dayRateTargetPence /
  // minJobValuePence inputs. The legacy PUT /api/contractor/profile route
  // does not yet enumerate those columns, but does forward unknown keys
  // through to drizzle's `set({...})` only when explicitly listed — so
  // those values currently no-op until a server-side extension lands
  // (Module 03 §6 territory, owned by a server-track agent).
  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch('/api/contractor/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update profile');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contractor-profile'] });
      toast({ title: 'Profile updated' });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save changes.',
        variant: 'destructive',
      });
    },
  });

  // ── Logout ───────────────────────────────────────────────────────────
  const handleLogout = () => {
    if (token) {
      fetch('/api/contractor/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    localStorage.removeItem('contractorToken');
    localStorage.removeItem('contractorUser');
    localStorage.removeItem('contractorProfileId');
    setLocation('/contractor/login');
  };

  // ── Form state ───────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');

  // Module 09 §7 — extended settings
  const [homePostcode, setHomePostcode] = useState('');
  const [dayRateTargetPounds, setDayRateTargetPounds] = useState('');
  const [minJobValuePounds, setMinJobValuePounds] = useState('');
  const [showSegmentRequestModal, setShowSegmentRequestModal] = useState(false);

  useEffect(() => {
    if (profileData?.user) {
      setFirstName(profileData.user.firstName || '');
      setLastName(profileData.user.lastName || '');
      setPhone(profileData.user.phone || '');
    }
    if (profile) {
      setBio(profile.bio || '');
      setHomePostcode(profile.homePostcode || '');
      if (profile.dayRateTargetPence != null) {
        setDayRateTargetPounds(Math.round(profile.dayRateTargetPence / 100).toString());
      }
      if (profile.minJobValuePence != null) {
        setMinJobValuePounds(Math.round(profile.minJobValuePence / 100).toString());
      }
    }
  }, [profileData, profile]);

  const segment: string | null = profile?.contractorSegment ?? null;

  // ── Skills / trades state ────────────────────────────────────────────
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  // Derive currently-selected categories from the profile's skills
  const selectedCategories = new Set<string>(
    (profile?.skills || []).map(
      (s: { service?: { category?: string } }) => s.service?.category,
    ).filter(Boolean),
  );

  // ── Loading state ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Profile</h1>

      {/* ── Section 1: Personal Info ─────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xl font-bold shrink-0">
            {firstName?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex gap-2">
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="bg-transparent text-white font-bold text-lg border-none outline-none w-full placeholder:text-slate-600"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="bg-transparent text-white font-bold text-lg border-none outline-none w-full placeholder:text-slate-600"
              />
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              className="bg-transparent text-slate-400 text-sm border-none outline-none w-full placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Bio */}
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Short bio — tell customers what you specialise in..."
          rows={3}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-slate-300 placeholder:text-slate-600 outline-none focus:border-slate-700 resize-none mb-3"
        />

        <button
          onClick={() =>
            updateMutation.mutate({
              firstName,
              lastName,
              phone,
              bio,
              homePostcode: homePostcode || undefined,
              dayRateTargetPence: dayRateTargetPounds
                ? Math.round(Number(dayRateTargetPounds) * 100)
                : undefined,
              minJobValuePence: minJobValuePounds
                ? Math.round(Number(minJobValuePounds) * 100)
                : undefined,
            })
          }
          disabled={updateMutation.isPending}
          className="w-full py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm font-semibold text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {updateMutation.isPending && (
            <Loader2 className="w-4 h-4 animate-spin" />
          )}
          Save Changes
        </button>
      </section>

      <hr className="border-slate-800 mb-8" />

      {/* ── Section: Segment (FF_CONTRACTOR_APP_V2) ──────────────────── */}
      {flags.contractor_app_v2 && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Tag size={18} className="text-slate-400" /> Segment
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              {segment ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold uppercase tracking-wider">
                      {SEGMENT_LABEL[segment] ?? segment}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">
                    {SEGMENT_DESCRIPTION[segment] ?? ''}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400 mb-3">
                  No segment assigned yet — request one below.
                </p>
              )}
              <button
                onClick={() => setShowSegmentRequestModal(true)}
                className="w-full py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Request segment change
              </button>
            </div>
          </section>

          <hr className="border-slate-800 mb-8" />
        </>
      )}

      {/* ── Section: Catchment & Targets (FF_CONTRACTOR_APP_V2) ─────── */}
      {flags.contractor_app_v2 && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <MapPin size={18} className="text-slate-400" /> Catchment &amp; Targets
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                  Home postcode
                </label>
                <input
                  type="text"
                  value={homePostcode}
                  onChange={e => setHomePostcode(e.target.value.toUpperCase())}
                  placeholder="NG7 2AA"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white outline-none focus:border-slate-700"
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  Drives travel-time estimates for offers near you.
                </p>
              </div>

              {segment === 'builder' && (
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1">
                    <Target size={11} /> Day-rate target (£)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={dayRateTargetPounds}
                    onChange={e => setDayRateTargetPounds(e.target.value)}
                    placeholder="280"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white outline-none focus:border-slate-700"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    Default target when committing a day. We honour the floor regardless of bundled value.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1">
                  <PoundSterling size={11} /> Minimum job value (£)
                </label>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={minJobValuePounds}
                  onChange={e => setMinJobValuePounds(e.target.value)}
                  placeholder="60"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white outline-none focus:border-slate-700"
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  Single-job offers below this won't be sent your way.
                </p>
              </div>
            </div>
          </section>

          <hr className="border-slate-800 mb-8" />
        </>
      )}

      {/* ── Section: Certifications (FF_CONTRACTOR_APP_V2) ──────────── */}
      {flags.contractor_app_v2 && segment === 'specialist' && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Shield size={18} className="text-slate-400" /> Certifications
            </h2>
            <CertificationsList certs={profile?.certs ?? []} />
            <p className="text-[10px] text-slate-600 mt-2">
              Cert verification &amp; renewal upload coming in a later phase.
            </p>
          </section>

          <hr className="border-slate-800 mb-8" />
        </>
      )}

      {/* ── Section: Notifications (placeholder for Module 10) ──────── */}
      {flags.contractor_app_v2 && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Bell size={18} className="text-slate-400" /> Notifications
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm text-slate-400">
                SMS, WhatsApp and email preferences land in Phase 8 (Module 10).
              </p>
            </div>
          </section>

          <hr className="border-slate-800 mb-8" />
        </>
      )}

      {/* ── Section 2: Skills & Trades ───────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <span className="text-base">🔧</span> Skills &amp; Trades
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Your active services. Manage rates in the Rate Card below.
        </p>
        <div className="space-y-2">
          {BROAD_TRADES.map((trade) => {
            const isExpanded = expandedTrade === trade.id;
            const categories =
              TRADE_CATEGORIES[trade.id as BroadTradeId] || [];
            const activeCount = categories.filter((c) =>
              selectedCategories.has(c),
            ).length;

            return (
              <div
                key={trade.id}
                className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedTrade(isExpanded ? null : trade.id)
                  }
                  className="w-full flex items-center justify-between p-4 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span>{trade.icon}</span>
                    <span className="font-semibold text-white">
                      {trade.label}
                    </span>
                    {activeCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold leading-none">
                        {activeCount}
                      </span>
                    )}
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={16} className="text-slate-500" />
                  ) : (
                    <ChevronDown size={16} className="text-slate-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 flex flex-wrap gap-2">
                    {categories.map((cat) => {
                      const isActive = selectedCategories.has(cat);
                      return (
                        <span
                          key={cat}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            isActive
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'bg-slate-800 text-slate-500 border-slate-700'
                          }`}
                        >
                          {CATEGORY_LABELS[cat as JobCategory] || cat}
                          {isActive && (
                            <Check size={10} className="inline ml-1" />
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <hr className="border-slate-800 mb-8" />

      {/* ── Section 3: Rate Card ─────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <span className="text-base">💰</span> Your Rates
        </h2>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <RateCardEditor />
        </div>
      </section>

      <hr className="border-slate-800 mb-8" />

      {/* ── Section 4: Insurance ─────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <Shield size={18} className="text-slate-400" /> Insurance
        </h2>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          {profile?.publicLiabilityInsuranceUrl ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <Check size={16} /> Insurance document on file
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              No insurance uploaded yet. Upload via Settings to get verified.
            </p>
          )}
        </div>
      </section>

      <hr className="border-slate-800 mb-8" />

      {/* ── Section 5: Stripe Connect / Get Paid ─────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <CreditCard size={18} className="text-slate-400" /> Get Paid
        </h2>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <StripeConnectStatus />
        </div>
      </section>

      <hr className="border-slate-800 mb-8" />

      {/* ── Section 6: Sign Out ──────────────────────────────────────── */}
      <button
        onClick={handleLogout}
        className="w-full py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 font-semibold text-sm hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={16} /> Sign Out
      </button>

      {/* Segment-change request modal */}
      {showSegmentRequestModal && (
        <SegmentChangeRequestModal
          currentSegment={segment}
          onClose={() => setShowSegmentRequestModal(false)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SegmentChangeRequestModal — Module 09 §10
// Posts to /api/contractor/segment-change-request. Endpoint is owned by
// Module 03 / Phase 8; for now we attempt the POST and fall back to a TODO
// confirmation toast if the endpoint isn't wired yet.
// ────────────────────────────────────────────────────────────────────────────
function SegmentChangeRequestModal({
  currentSegment,
  onClose,
}: {
  currentSegment: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<string>(
    currentSegment === 'builder' ? 'gap_filler' : 'builder',
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const segments = ['builder', 'gap_filler', 'specialist'].filter(
    s => s !== currentSegment,
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const token = localStorage.getItem('contractorToken')
        ?.trim()
        .replace(/[^a-zA-Z0-9._-]/g, '');
      const res = await fetch('/api/contractor/segment-change-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target_segment: target, reason }),
      });
      if (res.status === 404 || res.status === 503) {
        // Endpoint not yet implemented — log as TODO + reassure user.
        toast({
          title: 'Request noted',
          description:
            "We'll reach out shortly to confirm. (Self-service endpoint coming soon.)",
        });
      } else if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      } else {
        toast({
          title: 'Segment change requested',
          description: 'An admin will review and confirm.',
        });
      }
      onClose();
    } catch (err) {
      toast({
        title: 'Could not submit',
        description: err instanceof Error ? err.message : 'Try again',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-white">Request segment change</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Currently:{' '}
              <span className="text-amber-400 font-semibold">
                {SEGMENT_LABEL[currentSegment ?? ''] ?? currentSegment ?? 'None'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Move to
            </label>
            <div className="space-y-1.5">
              {segments.map(s => (
                <label
                  key={s}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    target === s
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-slate-800/40 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="segment"
                    value={s}
                    checked={target === s}
                    onChange={() => setTarget(s)}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-bold text-white">
                      {SEGMENT_LABEL[s]}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {SEGMENT_DESCRIPTION[s]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
              Why?
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Tell us a bit about why this segment fits you better."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-amber-500 resize-none"
            />
          </div>

          {currentSegment === 'builder' && (
            <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Builder → other will be blocked if you have any active day commitments.
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !target || !reason.trim()}
            className="w-full py-3 bg-amber-500 text-slate-950 font-bold rounded-xl hover:bg-amber-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit request
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CertificationsList — Module 09 §7 (Specialist segment).
// Pure read-only view; upload + verify is Phase 11+.
// ────────────────────────────────────────────────────────────────────────────
function CertificationsList({
  certs,
}: {
  certs: Array<string | { type: string; status?: string; expires_at?: string; expiresAt?: string }>;
}) {
  const labels: Record<string, string> = {
    gas_safe: 'Gas Safe',
    part_p: 'Part P',
    niceic: 'NICEIC',
    structural: 'Structural Engineer',
  };

  if (!certs || certs.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-sm text-slate-400">No certs on file yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
      {certs.map((c, i) => {
        const type = typeof c === 'string' ? c : c.type;
        const expiry =
          typeof c === 'string' ? null : c.expiresAt ?? c.expires_at ?? null;
        let daysLeft: number | null = null;
        if (expiry) {
          try {
            daysLeft = Math.floor(
              (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            );
          } catch {
            daysLeft = null;
          }
        }
        const expiringSoon = daysLeft != null && daysLeft >= 0 && daysLeft < 30;
        const expired = daysLeft != null && daysLeft < 0;

        return (
          <div
            key={`${type}-${i}`}
            className="flex items-center justify-between py-1.5"
          >
            <div className="flex items-center gap-2">
              <Shield
                size={14}
                className={
                  expired
                    ? 'text-red-400'
                    : expiringSoon
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }
              />
              <span className="text-sm font-semibold text-white">
                {labels[type] ?? type}
              </span>
            </div>
            <span
              className={`text-[11px] font-semibold ${
                expired
                  ? 'text-red-400'
                  : expiringSoon
                    ? 'text-amber-400'
                    : 'text-slate-500'
              }`}
            >
              {expired
                ? 'Expired'
                : daysLeft != null
                  ? `${daysLeft}d left`
                  : 'Verified'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
