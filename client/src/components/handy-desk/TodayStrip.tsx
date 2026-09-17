/**
 * Handy Desk's Today strip (B6; design export "Handy Desk.dc.html", under the header): who is on
 * today, what each is booked on and who is on site, from GET /api/comms-v2/diary/today. The label
 * opens the diary. A job held on the desk is amber. Read-only; no pool (captain's answer Q9).
 *
 * It renders nothing until the read answers, and nothing on a failed read, so the desk never waits
 * on it.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { adminAuthHeaders } from '@/lib/admin-auth';
import { cn } from '@/lib/utils';
import { DIARY_PATH, TODAY_QUERY, shortDate, todayPills, type DiaryToday, type TodayPill } from '@/lib/diary';

const TONE: Record<TodayPill['tone'], string> = {
    held: 'border-amber-400 bg-amber-400 text-slate-900',
    on_site: 'border-slate-200 bg-slate-200 text-slate-900',
    plain: 'border-slate-700 text-slate-300',
    open: 'border-dashed border-slate-700 text-slate-400',
};

export function TodayStrip() {
    const { data } = useQuery<DiaryToday>({
        queryKey: ['comms-v2-diary-today'],
        queryFn: async () => {
            const res = await fetch(TODAY_QUERY, { headers: adminAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load today (${res.status})`);
            return res.json();
        },
        refetchInterval: 60_000,
        retry: false,
    });
    if (!data) return null;

    return (
        <div data-testid="today-strip" className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-slate-800 bg-[#111c33] px-4 py-2 sm:px-6">
            <Link href={DIARY_PATH} data-testid="today-strip-link" className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.1em] text-amber-400 hover:text-amber-300">
                Today · {shortDate(data.date)} · open diary ›
            </Link>
            {data.contractors.length === 0 ? (
                <span className="text-xs text-slate-400">Nobody is on today.</span>
            ) : (
                data.contractors.map((c) => (
                    <div key={c.contractorId} data-testid={`today-strip-${c.contractorId}`} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-white">{c.name.split(/\s+/)[0]}</span>
                        {todayPills(c).map((p) => (
                            <span key={p.key} data-tone={p.tone} className={cn('whitespace-nowrap rounded-full border px-2.5 py-0.5 font-medium', TONE[p.tone])}>{p.label}</span>
                        ))}
                    </div>
                ))
            )}
        </div>
    );
}
