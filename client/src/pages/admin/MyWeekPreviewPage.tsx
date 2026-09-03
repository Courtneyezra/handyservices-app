/**
 * P13c: the owner's read-only preview of a contractor's My Week, at
 * /admin/my-week-preview/:contractorId (admin session, no contractor login).
 *
 * The admin endpoint returns that contractor's app token; the very same MyWeekPage mounts with it
 * in `readOnly` mode, so what the owner sees is what the contractor sees, job pack included, and
 * nothing posts: every mutation on the page refuses while read-only. The frame is phone-width,
 * like the app.
 */
import { useQuery } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { Eye, ArrowLeft, Loader2, ExternalLink } from 'lucide-react';
import MyWeekPage from '@/pages/contractor/MyWeekPage';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface PreviewPayload { contractorId: string; name: string; token: string; url: string }

export default function MyWeekPreviewPage() {
    const [, params] = useRoute('/admin/my-week-preview/:contractorId');
    const contractorId = params?.contractorId ?? '';
    const { data, isLoading, isError, error } = useQuery<PreviewPayload>({
        queryKey: ['my-week-preview', contractorId],
        queryFn: async () => {
            const res = await fetch(`/api/admin/my-week-preview/${contractorId}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
            return res.json();
        },
        enabled: !!contractorId,
        retry: false,
    });

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="my-week-preview">
            <div className="sticky top-0 z-[60] border-b border-amber-500/40 bg-amber-500/15 backdrop-blur" data-testid="my-week-preview-banner">
                <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-2 text-[12px] text-amber-200">
                    <Link href="/admin/dispatch" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-amber-100 hover:bg-amber-500/20" aria-label="Back to admin"><ArrowLeft size={13} /> Admin</Link>
                    <Eye size={13} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">Preview</span>{data ? ` · ${data.name}'s My Week` : ''} · read-only, nothing sends from here
                    </span>
                    {data && <a href={data.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-100" aria-label="Open the live link">live <ExternalLink size={12} /></a>}
                </div>
            </div>
            {isLoading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400" data-testid="my-week-preview-loading"><Loader2 className="h-4 w-4 animate-spin" /> Opening the preview…</div>}
            {isError && <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-red-400" data-testid="my-week-preview-error">{(error as Error)?.message ?? 'Could not open the preview'}</div>}
            {data && <MyWeekPage token={data.token} readOnly />}
        </div>
    );
}
