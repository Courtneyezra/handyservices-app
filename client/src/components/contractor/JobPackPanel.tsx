/**
 * P13c: the job pack inside My Week's job drawer (the tokenised schedule, dark theme). The same
 * P13 components the dashboard uses, on a light card so they read the same everywhere: the
 * "changed since you accepted" strip, per task the customer's words / photos / how / not
 * included / bring-buy, per job the delivery fields with the missing ones marked.
 * Pure rendering; the page passes what `GET /api/contractor-app/:token/jobs` carried.
 */
import { ClipboardList } from 'lucide-react';
import { JobPackTask, JobPackJob, ChangedSinceStrip, PackChip, type ContractorPackView } from './JobPackSection';

export function JobPackPanel({ pack, onPhoto }: { pack: ContractorPackView | null | undefined; onPhoto?: (url: string) => void }) {
    if (!pack) return null;
    const chip = { complete: pack.missing.length === 0, missing: pack.missing.length, label: pack.missing.length === 0 ? 'Pack complete' : `${pack.missing.length} missing` };
    return (
        <div className="mb-4" data-testid="my-week-job-pack">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <ClipboardList size={13} className="text-amber-300" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Job pack · {pack.tasks.length} task{pack.tasks.length === 1 ? '' : 's'}</span>
                </div>
                <PackChip pack={chip} />
            </div>
            <div className="space-y-3 rounded-2xl bg-white p-3 text-[#0E1116]">
                {pack.changes.length > 0 && <ChangedSinceStrip changes={pack.changes} />}
                {pack.tasks.length > 0 && (
                    <div className="-mt-3" data-testid="my-week-pack-tasks">
                        {pack.tasks.map((t) => <JobPackTask key={t.lineId} task={t} onPhoto={onPhoto} />)}
                    </div>
                )}
                <JobPackJob job={pack.job} missingLabels={pack.missingLabels} />
            </div>
        </div>
    );
}

export default JobPackPanel;
