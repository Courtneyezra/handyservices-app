import { useRoute, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Loader2,
  User,
  FileText,
  Wrench,
  Receipt,
  Banknote,
  Phone,
  Mail,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Per-client engagement timeline. Reads GET /api/clients/:clientKey
// (server/client-aggregation.ts) and lays out the spine chain a customer has
// travelled: leads -> quotes -> jobs -> invoices -> payouts.
// ---------------------------------------------------------------------------

interface ClientEngagement {
  clientKey: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  counts: { leads: number; quotes: number; jobs: number; invoices: number; payouts: number };
  leads: any[];
  quotes: any[];
  jobs: any[];
  invoices: any[];
  payouts: any[];
}

function money(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(Number(pence))) return '—';
  return `£${(Number(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_TONE: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  paid: 'bg-green-100 text-green-800 border-green-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  scheduled: 'bg-amber-100 text-amber-800 border-amber-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  draft: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  void: 'bg-red-100 text-red-800 border-red-200',
};

function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = STATUS_TONE[value] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <Badge variant="outline" className={tone}>
      {value.replace(/_/g, ' ')}
    </Badge>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: any;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
          <Badge variant="secondary">{count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground italic">None</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export default function ClientDetailPage() {
  const [, params] = useRoute('/admin/clients/:clientKey');
  const clientKey = params?.clientKey ? decodeURIComponent(params.clientKey) : '';

  const { data, isLoading, error } = useQuery<ClientEngagement>({
    queryKey: ['admin-client', clientKey],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientKey)}`);
      if (res.status === 404) throw new Error('No engagement found for this client.');
      if (!res.ok) throw new Error('Failed to fetch client engagement');
      return res.json();
    },
    enabled: !!clientKey,
  });

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-6">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Clients
      </Link>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading client…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">
                  {data.displayName || <span className="italic text-muted-foreground">Unnamed client</span>}
                </h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {data.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" />
                      {data.phone}
                    </span>
                  )}
                  {data.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      {data.email}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Counts strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Leads', value: data.counts.leads, icon: User },
              { label: 'Quotes', value: data.counts.quotes, icon: FileText },
              { label: 'Jobs', value: data.counts.jobs, icon: Wrench },
              { label: 'Invoices', value: data.counts.invoices, icon: Receipt },
              { label: 'Payouts', value: data.counts.payouts, icon: Banknote },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="py-4 flex flex-col items-center gap-1">
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{s.value}</span>
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Leads */}
          <Section icon={User} title="Leads" count={data.counts.leads}>
            <div className="space-y-2">
              {data.leads.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.jobDescription || l.jobSummary || 'Lead'}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(l.createdAt)}</p>
                  </div>
                  <StatusBadge value={l.stage || l.status} />
                </div>
              ))}
            </div>
          </Section>

          {/* Quotes */}
          <Section icon={FileText} title="Quotes" count={data.counts.quotes}>
            <div className="space-y-2">
              {data.quotes.map((q) => (
                <div key={q.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{q.jobDescription || 'Quote'}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(q.createdAt)} · {money(q.basePrice)}
                      {q.depositPaidAt ? ` · deposit paid ${fmtDate(q.depositPaidAt)}` : ''}
                    </p>
                  </div>
                  <StatusBadge value={q.completedAt ? 'completed' : q.depositPaidAt ? 'paid' : 'pending'} />
                </div>
              ))}
            </div>
          </Section>

          {/* Jobs */}
          <Section icon={Wrench} title="Jobs" count={data.counts.jobs}>
            <div className="space-y-2">
              {data.jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{j.description || 'Job'}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.scheduledDate ? `scheduled ${fmtDate(j.scheduledDate)}` : fmtDate(j.createdAt)}
                      {j.scheduledSlot ? ` · ${j.scheduledSlot}` : ''}
                      {j.completedAt ? ` · completed ${fmtDate(j.completedAt)}` : ''}
                    </p>
                  </div>
                  <StatusBadge value={j.dayOfStatus || j.status} />
                </div>
              ))}
            </div>
          </Section>

          {/* Invoices */}
          <Section icon={Receipt} title="Invoices" count={data.counts.invoices}>
            <div className="space-y-2">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      total {money(inv.totalAmount)} · deposit {money(inv.depositPaid)} · balance {money(inv.balanceDue)}
                    </p>
                  </div>
                  <StatusBadge value={inv.status} />
                </div>
              ))}
            </div>
          </Section>

          {/* Payouts */}
          <Section icon={Banknote} title="Payouts" count={data.counts.payouts}>
            <div className="space-y-2">
              {data.payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      net {money(p.netPayoutPence)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      gross {money(p.grossAmountPence)} · fee {money(p.platformFeePence)} · {fmtDate(p.createdAt)}
                    </p>
                  </div>
                  <StatusBadge value={p.status} />
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
