// Contractor "materials run-list" (a.k.a. basket): every material across the
// contractor's booked jobs, consolidated — dedup by supplier SKU, quantities
// summed, each row deep-linking to its product page, with the inc-VAT card spend
// totalled. A true one-click Screwfix basket isn't possible (their cart is a
// session BFF with no shareable URL), so this is the reliable "buy once for the
// run" list. Toggle between the whole upcoming window and a single day.
import { useMemo, useState } from 'react';
import { useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShoppingBasket, Loader2 } from 'lucide-react';

interface RunItem {
  name: string;
  imageUrl?: string;
  supplierUrl?: string;
  supplier?: string;
  supplierItemNumber?: string;
  unitPriceIncVatPence?: number;
  unitPricePence?: number;
  qty: number;
  jobCount: number;
  lineCostPence: number;
}
interface RunPayload {
  date: string | null;
  window: 'day' | 'upcoming';
  jobCount: number;
  itemCount: number;
  totalIncVatPence: number;
  items: RunItem[];
}

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default function ContractorMaterialsRunPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [dayOnly, setDayOnly] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const { data, isLoading, isError } = useQuery<RunPayload>({
    queryKey: ['materials-run', token, dayOnly ? today : 'upcoming'],
    queryFn: async () => {
      const qs = dayOnly ? `?date=${today}` : '';
      const res = await fetch(`/api/contractor-app/${token}/materials-run${qs}`);
      if (!res.ok) throw new Error('Failed to load run-list');
      return res.json();
    },
    enabled: !!token,
  });

  const items = data?.items ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      <div className="max-w-md mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBasket className="w-5 h-5 text-emerald-400" />
          <h1 className="text-xl font-bold">Materials run</h1>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Everything to buy for your {dayOnly ? 'day' : 'upcoming jobs'} — one list, on the Handy card.
        </p>

        {/* Window toggle */}
        <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5 mb-4">
          {([['upcoming', 'All upcoming'], ['day', 'Today']] as const).map(([k, label]) => {
            const active = (k === 'day') === dayOnly;
            return (
              <button
                key={k}
                onClick={() => setDayOnly(k === 'day')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  active ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Building your list…
          </div>
        )}
        {isError && (
          <p className="text-sm text-red-400 py-10 text-center">Couldn't load your run-list. Pull to refresh.</p>
        )}

        {data && !isLoading && (
          <>
            {/* Summary */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mb-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-400">Spend for {data.jobCount} job{data.jobCount === 1 ? '' : 's'}</span>
                <span className="text-2xl font-bold text-emerald-400 tabular-nums">{gbp(data.totalIncVatPence)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {data.itemCount} item{data.itemCount === 1 ? '' : 's'} · inc VAT · spend on the Handy card
              </p>
            </div>

            {/* Empty state */}
            {items.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-12">
                <ShoppingBasket className="w-8 h-8 mx-auto mb-3 text-slate-700" />
                No materials on your {dayOnly ? 'jobs today' : 'upcoming jobs'} yet.
              </div>
            )}

            {/* Items */}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div
                  key={`${it.supplierItemNumber ?? it.name}-${i}`}
                  className="flex items-center gap-3 rounded-xl bg-slate-900 border border-slate-800 p-2.5"
                >
                  {it.imageUrl ? (
                    <img src={it.imageUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-contain bg-white shrink-0" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-slate-800 shrink-0 flex items-center justify-center text-lg">🧱</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug line-clamp-2">{it.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                      {gbp((it.unitPriceIncVatPence ?? it.unitPricePence ?? 0))} each
                      {it.jobCount > 1 ? ` · ${it.jobCount} jobs` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm font-bold tabular-nums">
                      ×{it.qty}
                    </span>
                    {it.supplierUrl && (
                      <a
                        href={it.supplierUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300"
                      >
                        Buy <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {items.length > 0 && (
              <p className="text-[11px] text-slate-600 text-center mt-6 px-4">
                Tap “Buy” to open each item on Screwfix. (Screwfix has no shared-basket link, so it's one tap per item — everything's totalled above.)
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
