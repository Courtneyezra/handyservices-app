/**
 * Close a new-desk case file by hand (POST /api/comms-v2/case-files/:id/close), shown in the thread
 * view below the composer on any file not yet done: words (required on a held file, where they
 * release the hold), then a second tap to confirm. The file moves to Done under the session's name
 * and the customer's next message opens a new file. A refusal is shown as the desk worded it, with
 * the confirm kept open.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminAuthHeaders } from '@/lib/admin-auth';

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_DARK = cn(BTN, 'bg-slate-900 text-white hover:bg-slate-800');
const BTN_OUTLINE = cn(BTN, 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50');
const BTN_GHOST = cn(BTN, 'text-slate-500 hover:bg-slate-100 hover:text-slate-900');

export function CloseFileForm({ fileId, held, onClosed, layout = 'panel' }: { fileId: string; held: boolean; onClosed: () => void; layout?: 'panel' | 'sheet' }) {
    const [confirming, setConfirming] = useState(false);
    const [words, setWords] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const size = layout === 'sheet' ? 'h-11 px-3.5 text-sm' : 'h-10 px-3.5 text-[13px]';

    const close = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/comms-v2/case-files/${fileId}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
                body: JSON.stringify({ words }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Close failed (${res.status})`);
            setConfirming(false);
            onClosed();
        } catch (e: any) {
            setError(e?.message || 'Close failed');
        } finally {
            setBusy(false);
        }
    };

    if (!confirming) {
        return (
            <button type="button" data-testid="close-file" className={cn(BTN_OUTLINE, size, 'self-start')} onClick={() => setConfirming(true)}>
                Close file
            </button>
        );
    }
    return (
        <div data-testid="close-file-confirm" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[13px] font-semibold text-slate-900">Close this file as done?</p>
            <p className="text-xs leading-normal text-slate-500">The desk takes no more turns on it. The customer&apos;s next message opens a new file.{held ? ' The file is held: your words release the hold.' : ''}</p>
            <label className="text-[11px] font-semibold text-slate-500" htmlFor={`close-words-${fileId}`}>{held ? 'Your words, for the file (required to release the hold)' : 'Your words, for the file (optional)'}</label>
            <textarea
                id={`close-words-${fileId}`}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder="Why it is closed"
                rows={2}
                className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] leading-normal text-slate-900 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25"
            />
            {error && <p role="alert" data-testid="close-file-error" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-normal text-red-900">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="close-file-yes" className={cn(BTN_DARK, size)} disabled={busy} onClick={close}>
                    {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                    Close file
                </button>
                <button type="button" className={cn(BTN_GHOST, size)} disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
            </div>
        </div>
    );
}
