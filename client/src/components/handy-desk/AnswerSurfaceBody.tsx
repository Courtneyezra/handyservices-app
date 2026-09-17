/**
 * Handy Desk - the seam where an answer's typed surface renders (T3 fills it: thread, diary, map,
 * quote, ledger, floor, then "What goes out when you confirm" and the confirm footer).
 *
 * Until T3 lands this renders only what Ben needs to act safely on an answer: the answer's note and
 * any drafts the run held, as they stand. A held draft is sent from its card in the queue
 * (send-held-draft), so nothing here sends.
 */
import type { OpsAnswer } from '@shared/ops-types';

const CHANNEL_LABEL: Record<string, string> = { wa: 'WhatsApp', sms: 'SMS', email: 'Email' };

export function AnswerSurfaceBody({ answer }: { answer: OpsAnswer }) {
    const outgoing = answer.outgoing ?? [];
    if (outgoing.length === 0 && !answer.note) return null;
    return (
        <div data-testid="handy-desk-surface" data-surface={answer.surface.type} className="space-y-3">
            {outgoing.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Held for you to send</p>
                    <ul className="mt-2 space-y-2">
                        {outgoing.map((o, i) => (
                            <li key={i} className="rounded-[14px] bg-slate-100 px-4 py-3">
                                <p className="text-xs font-semibold text-slate-500">{CHANNEL_LABEL[o.channel] ?? o.channel} · {o.to}</p>
                                <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-800">{o.text}</p>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">Send it from its card in the queue.</p>
                </div>
            )}
            {answer.note && <p data-testid="handy-desk-note" className="text-xs text-slate-500">{answer.note}</p>}
        </div>
    );
}
