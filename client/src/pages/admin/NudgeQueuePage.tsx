/**
 * /admin/nudges — the Recovery Agent's human gate.
 *
 * Proposed follow-ups appear as cards: the agent's draft (editable), its
 * reasoning, and the quote context. "Send via WhatsApp" opens wa.me with the
 * message pre-filled — the operator presses send INSIDE WhatsApp, with the
 * full chat history on screen (the Sukhy lesson: our ingest can miss replies,
 * so the human eyeballs the thread at the moment of decision). Marking sent
 * starts the recovery clock: deposit paid within 7 days = recovered.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MessageCircle, Undo2, X, Trophy } from 'lucide-react';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const LEVER_LABELS: Record<string, string> = {
  reminder: 'Reminder',
  split: 'Start smaller',
  reassure: 'Reassurance',
  expiry: 'Expiry heads-up',
  gift_unclaimed: 'Gift waiting',
};

interface NudgeRow {
  id: string;
  slug: string;
  phone: string | null;
  status: string;
  lever: string | null;
  message: string | null;
  reason: string | null;
  created_at: string;
  sent_at: string | null;
  customer_name: string;
  base_price: number | null;
  view_count: number | null;
  expires_at: string | null;
  recovered: boolean;
}

const pounds = (p: number | null | undefined) => `£${Math.round(Number(p || 0) / 100).toLocaleString()}`;

function waLink(phone: string | null, message: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const intl = digits.startsWith('0') ? `44${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export default function NudgeQueuePage() {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ nudges: NudgeRow[] }>({
    queryKey: ['nudge-queue'],
    queryFn: async () => {
      const res = await fetch('/api/admin/nudges', { headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const act = async (id: string, action: 'sent' | 'dismissed' | 'unsend', message?: string) => {
    setBusy(id);
    try {
      await fetch(`/api/admin/nudges/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ action, ...(message ? { message } : {}) }),
      });
      qc.invalidateQueries({ queryKey: ['nudge-queue'] });
    } finally {
      setBusy(null);
    }
  };

  const proposed = (data?.nudges ?? []).filter((n) => n.status === 'proposed');
  const sent = (data?.nudges ?? []).filter((n) => n.status === 'sent');
  const recoveredValue = sent.filter((n) => n.recovered).reduce((s, n) => s + (n.base_price || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-handy-navy flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-handy-yellow" />
          Follow-up queue
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The recovery agent's drafts. Edit if you like, then send — WhatsApp opens with the
          message pre-filled and <strong>you press send</strong>.
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          Before sending, glance at the chat history WhatsApp shows you — some customer replies
          don't reach our system yet. If they've already replied, dismiss the nudge and answer
          them instead.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading queue…
        </div>
      )}
      {!!error && <p className="text-sm text-red-500 py-8">Couldn't load the queue.</p>}

      {data && proposed.length === 0 && (
        <p className="text-sm text-muted-foreground py-6">
          Nothing waiting. Run the agent to refresh the queue: <code>npx tsx scripts/agent-recovery.ts</code>
        </p>
      )}

      {proposed.map((n) => {
        const message = edits[n.id] ?? n.message ?? '';
        const link = waLink(n.phone, message);
        return (
          <Card key={n.id} className="border-handy-grid">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 flex-wrap">
                {n.customer_name}
                <span className="text-handy-navy tabular-nums">{pounds(n.base_price)}</span>
                <Badge variant="outline" className="text-[10px]">{LEVER_LABELS[n.lever || ''] ?? n.lever}</Badge>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {n.view_count ?? 0} views ·{' '}
                  <a href={`/quote/${n.slug}`} target="_blank" rel="noreferrer" className="underline font-mono">{n.slug}</a>
                </span>
              </CardTitle>
              {n.reason && (
                <p className="text-xs text-muted-foreground italic mt-1">Agent: “{n.reason}”</p>
              )}
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <textarea
                value={message}
                onChange={(e) => setEdits((prev) => ({ ...prev, [n.id]: e.target.value }))}
                rows={4}
                className="w-full text-sm rounded-lg border border-handy-grid p-2.5 focus:border-handy-yellow outline-none leading-relaxed"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!link || busy === n.id}
                  className="bg-green-600 hover:bg-green-700 h-9 text-xs font-semibold"
                  onClick={() => {
                    if (!link) return;
                    window.open(link, '_blank');
                    act(n.id, 'sent', message);
                  }}
                >
                  <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                  Send via WhatsApp
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === n.id}
                  className="h-9 text-xs"
                  onClick={() => act(n.id, 'dismissed')}
                >
                  <X className="w-3.5 h-3.5 mr-1" /> Dismiss
                </Button>
                {!link && (
                  <span className="text-[11px] text-red-500 self-center">phone looks invalid — check before contacting</span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {sent.length > 0 && (
        <Card className="border-handy-grid">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              Sent — recovery clock running
              {recoveredValue > 0 && (
                <Badge className="bg-[#7DB00E] text-white text-[10px]">
                  <Trophy className="w-3 h-3 mr-1" /> {pounds(recoveredValue)} recovered
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {sent.map((n) => (
              <div key={n.id} className="flex items-center justify-between text-xs border-b border-handy-grid/50 py-1.5 gap-2">
                <span className="min-w-0 truncate">
                  <strong>{n.customer_name}</strong> · {pounds(n.base_price)} ·{' '}
                  <span className="text-muted-foreground">sent {n.sent_at ? new Date(n.sent_at).toLocaleDateString('en-GB') : ''}</span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {n.recovered ? (
                    <Badge className="bg-[#7DB00E] text-white text-[10px]">recovered ✓</Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act(n.id, 'unsend')}
                      className="text-muted-foreground hover:text-handy-navy inline-flex items-center gap-1"
                      title="Didn't actually send it? Put it back in the queue"
                    >
                      <Undo2 className="w-3 h-3" /> didn't send
                    </button>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
