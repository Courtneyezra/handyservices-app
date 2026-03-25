import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Shield, CreditCard, LogOut, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { RateCardEditor } from '@/components/contractor/RateCardEditor';
import { StripeConnectStatus } from '@/components/contractor/StripeConnectStatus';
import {
  BROAD_TRADES,
  TRADE_CATEGORIES,
  CATEGORY_LABELS,
} from '@shared/categories';
import type { BroadTradeId } from '@shared/categories';
import type { JobCategory } from '@shared/categories';

export default function ProfileTab() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  useEffect(() => {
    if (profileData?.user) {
      setFirstName(profileData.user.firstName || '');
      setLastName(profileData.user.lastName || '');
      setPhone(profileData.user.phone || '');
    }
    if (profile) {
      setBio(profile.bio || '');
    }
  }, [profileData, profile]);

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
            updateMutation.mutate({ firstName, lastName, phone, bio })
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
    </div>
  );
}
