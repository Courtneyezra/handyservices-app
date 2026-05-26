import { useQuery } from '@tanstack/react-query';
import { Zap, Calendar, Home, Clock, Timer, Coins, AlertTriangle } from 'lucide-react';
import { useQuoteAvailability, countAvailableDatesThisWeek } from '@/hooks/useAvailability';

interface ScarcityBannerProps {
  segment: string;
  postcode?: string | null;
  urgency?: 'standard' | 'priority' | 'emergency';
  /** When set, the banner ties its "N slots left this week" to THIS quote's real
   *  availability (same source as the date picker) instead of segment-level numbers. */
  quoteId?: string | null;
}

interface ScarcityData {
  segment: string;
  totalSlotsThisWeek: number;
  morningSlots: number;
  afternoonSlots: number;
  nextAvailableDate: string | null;
  expressSlots?: number;
  afterHoursSlots?: number;
  standardSlots?: number;
  isBusySeason?: boolean;
  focusMetric: string;
}

const SEGMENT_BANNER_CONFIG: Record<string, {
  icon: typeof Zap;
  getText: (data: ScarcityData, area: string) => string;
  getCount: (data: ScarcityData) => number;
}> = {
  BUSY_PRO: {
    icon: Zap,
    getText: (data, area) => `${data.expressSlots ?? data.totalSlotsThisWeek} express slots left this week in ${area}`,
    getCount: (data) => data.expressSlots ?? data.totalSlotsThisWeek,
  },
  PROP_MGR: {
    icon: Calendar,
    getText: (data, _area) => `${data.morningSlots} morning slots left \u2014 portfolio priority`,
    getCount: (data) => data.morningSlots,
  },
  LANDLORD: {
    icon: Home,
    getText: (data, area) => `${data.totalSlotsThisWeek} coordinated slots left in ${area}`,
    getCount: (data) => data.totalSlotsThisWeek,
  },
  SMALL_BIZ: {
    icon: Clock,
    getText: (data, _area) => `${data.afterHoursSlots ?? data.totalSlotsThisWeek} after-hours slots left this month`,
    getCount: (data) => data.afterHoursSlots ?? data.totalSlotsThisWeek,
  },
  DIY_DEFERRER: {
    icon: Timer,
    getText: (data, _area) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const nextMonth = monthNames[new Date().getMonth() + 1] || 'Jan';
      return data.isBusySeason
        ? `Spring rush \u2014 ${data.totalSlotsThisWeek} slots left before ${nextMonth}`
        : `${data.totalSlotsThisWeek} slots left this week`;
    },
    getCount: (data) => data.totalSlotsThisWeek,
  },
  BUDGET: {
    icon: Coins,
    getText: (data, _area) => `${data.standardSlots ?? data.totalSlotsThisWeek} standard-rate slots left (express +\u00A380)`,
    getCount: (data) => data.standardSlots ?? data.totalSlotsThisWeek,
  },
};

function getUrgencyClasses(count: number): string {
  if (count <= 1) return 'bg-red-600 text-white';
  if (count <= 3) return 'bg-amber-500 text-white';
  return 'bg-slate-800 text-slate-100';
}

const URGENCY_BANNER_CONFIG: Record<
  'standard' | 'priority' | 'emergency',
  { icon: typeof Zap; text: string; urgencyClasses: string; pulse: boolean }
> = {
  standard: {
    icon: Calendar,
    text: 'Limited slots this week \u2014 book now to secure your date',
    urgencyClasses: 'bg-slate-800 text-slate-100',
    pulse: false,
  },
  priority: {
    icon: Zap,
    text: 'Priority booking \u2014 only 2 slots left this week',
    urgencyClasses: 'bg-amber-500 text-white',
    pulse: true,
  },
  emergency: {
    icon: AlertTriangle,
    text: 'Emergency service \u2014 same-day availability',
    urgencyClasses: 'bg-red-600 text-white',
    pulse: true,
  },
};

export function ScarcityBanner({ segment, postcode, urgency, quoteId }: ScarcityBannerProps) {
  // Contextual mode: urgency-based messaging (no API call needed)
  if (urgency) {
    const config = URGENCY_BANNER_CONFIG[urgency];
    const Icon = config.icon;
    return (
      <div className={`w-full py-2.5 px-4 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide ${config.urgencyClasses}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{config.text}</span>
        {config.pulse && (
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
        )}
      </div>
    );
  }

  // Segment-based mode: fetch scarcity data from API
  return <SegmentScarcityBanner segment={segment} postcode={postcode} quoteId={quoteId} />;
}

function SegmentScarcityBanner({ segment, postcode, quoteId }: { segment: string; postcode?: string | null; quoteId?: string | null }) {
  // Tie the banner to THIS quote's real availability when we have a quote id and the
  // segment has no bespoke metric (CONTEXTUAL / unknown). Reuses the same query key as
  // the date picker (slot 'am'), so it shares the cache and shows the SAME number — the
  // banner and the picker can never disagree.
  const useQuoteData = !!quoteId && (segment === 'CONTEXTUAL' || !SEGMENT_BANNER_CONFIG[segment]);

  const { data: quoteAvail } = useQuoteAvailability({
    quoteId: quoteId || undefined,
    slot: 'am',
    enabled: useQuoteData,
  });

  const { data, isLoading } = useQuery<ScarcityData>({
    queryKey: ['scarcity', segment],
    queryFn: async () => {
      const res = await fetch(`/api/availability/scarcity?segment=${segment}`);
      if (!res.ok) throw new Error('Failed to fetch scarcity');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // Cache 5 min
    retry: 1,
    enabled: !useQuoteData,
  });

  const area = postcode?.split(' ')[0] || 'your area';

  // Quote-availability-driven banner — honest, tied to the real dates shown in the picker.
  if (useQuoteData) {
    const count = countAvailableDatesThisWeek(quoteAvail);
    if (count == null) return null; // still loading
    const label = count <= 0
      ? `Limited availability this week in ${area}`
      : `${count} slot${count === 1 ? '' : 's'} left this week in ${area}`;
    return (
      <div className={`w-full py-2 px-4 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide ${getUrgencyClasses(count <= 0 ? 1 : count)}`}>
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{label}</span>
        {count <= 3 && (
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
        )}
      </div>
    );
  }

  if (isLoading || !data) return null;

  const config = SEGMENT_BANNER_CONFIG[segment];
  if (!config) {
    // Fallback for unknown segments (no quoteId tie available)
    const count = data.totalSlotsThisWeek;
    const Icon = AlertTriangle;
    return (
      <div className={`w-full py-2 px-4 flex items-center justify-center gap-2 text-xs font-medium ${getUrgencyClasses(count)}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{count} slots left this week in {area}</span>
      </div>
    );
  }

  const count = config.getCount(data);
  const text = config.getText(data, area);
  const Icon = config.icon;
  const urgencyClasses = getUrgencyClasses(count);

  return (
    <div className={`w-full py-2.5 px-4 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide ${urgencyClasses}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{text}</span>
      {count <= 3 && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
      )}
    </div>
  );
}
