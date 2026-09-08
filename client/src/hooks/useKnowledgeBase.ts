/**
 * useKnowledgeBase (build plan v2, item 3.4) — the one query behind /admin/knowledge and the
 * sidebar's "waiting for you" badge.
 *
 * Data: GET /api/spine/kb (server/spine/routes.ts), which returns EVERY entry including the
 * unreviewed drafts and the open questions, because this is the page where Ben reviews them.
 * Nothing customer-facing reads this: a reply path reads the reviewed-only accessor on the server.
 */
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { adminAuthHeaders } from './usePriceQueue';

export const KB_KEY = ['spine-knowledge-base'] as const;
export const KB_URL = '/api/spine/kb';

export type KbKind = 'answer' | 'question';
export type KbStatus = 'unreviewed' | 'reviewed' | 'retired';

export interface KbEntry {
    id: string;
    kind: KbKind;
    topic: string;
    approvedWords: string;
    bannedWords: string[];
    status: KbStatus;
    reviewedBy: string | null;
    reviewedAt: string | null;
    benNote: string | null;
    sourceNote: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}
export interface KbCounts { unreviewed: number; reviewed: number; retired: number; questions: number }
export interface KbPayload { entries: KbEntry[]; counts: KbCounts }

export async function fetchKnowledgeBase(): Promise<KbPayload> {
    const res = await fetch(KB_URL, { headers: adminAuthHeaders() });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH');
    if (!res.ok) throw new Error(`knowledge base ${res.status}`);
    return res.json();
}

export function useKnowledgeBase(opts: { enabled?: boolean } = {}) {
    return useQuery<KbPayload>({
        queryKey: KB_KEY,
        queryFn: fetchKnowledgeBase,
        enabled: opts.enabled ?? true,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: false,
    });
}

export function invalidateKnowledgeBase(qc: QueryClient): Promise<void> {
    return qc.invalidateQueries({ queryKey: KB_KEY });
}

async function send(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<KbEntry> {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) throw new Error((json?.errors ?? []).join(' ') || `knowledge base ${res.status}`);
    return json.entry as KbEntry;
}

export interface KbDraftInput {
    id?: string;
    kind?: KbKind;
    topic: string;
    approvedWords?: string;
    bannedWords?: string[];
    benNote?: string | null;
    sourceNote?: string | null;
}

/** Every write the page can make, each invalidating the one query so the list moves together. */
export function useKnowledgeBaseWrites() {
    const qc = useQueryClient();
    const after = { onSuccess: () => { void invalidateKnowledgeBase(qc); } };
    return {
        create: useMutation({ mutationFn: (d: KbDraftInput) => send(KB_URL, 'POST', d), ...after }),
        edit: useMutation({ mutationFn: ({ id, draft }: { id: string; draft: KbDraftInput }) => send(`${KB_URL}/${encodeURIComponent(id)}`, 'PATCH', draft), ...after }),
        review: useMutation({ mutationFn: (id: string) => send(`${KB_URL}/${encodeURIComponent(id)}/review`, 'POST'), ...after }),
        retire: useMutation({ mutationFn: (id: string) => send(`${KB_URL}/${encodeURIComponent(id)}/retire`, 'POST'), ...after }),
        unreview: useMutation({ mutationFn: (id: string) => send(`${KB_URL}/${encodeURIComponent(id)}/unreview`, 'POST'), ...after }),
    };
}

// ---------------------------------------------------------------- pure (exported for tests)

/**
 * The order Ben should meet them in: the questions only he can answer, then the drafts waiting,
 * then what is already live, then what is retired. Within a group, oldest touched first, because
 * that is the one that has been waiting longest.
 */
export function reviewOrder(entries: readonly KbEntry[]): KbEntry[] {
    const rank = (e: KbEntry): number => {
        if (e.status === 'retired') return 3;
        if (e.kind === 'question') return 0;
        if (e.status === 'unreviewed') return 1;
        return 2;
    };
    return [...entries].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        return (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
    });
}

/** "today" · "3 days ago" · "on 14 Aug 2026": when this was last reviewed, in Ben's language. */
export function reviewedLabel(entry: Pick<KbEntry, 'status' | 'reviewedAt'>, now: Date = new Date()): string {
    if (entry.status !== 'reviewed') return 'Not reviewed yet';
    if (!entry.reviewedAt) return 'Reviewed';
    const at = new Date(entry.reviewedAt);
    if (Number.isNaN(at.getTime())) return 'Reviewed';
    const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
    if (days <= 0) return 'You reviewed this today';
    if (days === 1) return 'You reviewed this yesterday';
    if (days < 30) return `You reviewed this ${days} days ago`;
    return `You reviewed this on ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** Can this entry be reviewed as it stands? The page says why not, rather than failing on the tap. */
export function whyNotReviewable(entry: Pick<KbEntry, 'kind' | 'approvedWords'>): string | null {
    if (entry.kind === 'question') return 'This is a question for you, not an answer. Write what you would say, switch it to an answer, then review it.';
    if (!entry.approvedWords.trim()) return 'There is nothing to approve yet. Write the words you would send.';
    return null;
}
