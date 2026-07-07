import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
  MapPin,
  Pencil,
  KeyRound,
  Archive,
  GitMerge,
  CheckCircle2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Per-client engagement timeline. Reads GET /api/clients/:clientKey
// (server/client-aggregation.ts) and lays out the spine chain a customer has
// travelled: leads -> quotes -> jobs -> invoices -> payouts.
// ---------------------------------------------------------------------------

interface ClientEngagement {
  clientKey: string;
  // First-class service_clients record (id + editable fields) when one exists.
  client: any | null;
  clientId: string | null;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  counts: { leads: number; quotes: number; jobs: number; invoices: number; payouts: number; properties?: number };
  properties?: any[];
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

// Property edit dialog. Edits the safe, human-owned fields only — nickname,
// notes, accessNotes, and display address/postcode. The server leaves the
// derived dedupe_key untouched so history keeps resolving to this property.
function PropertyEditDialog({
  property,
  onClose,
  onSaved,
}: {
  property: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nickname: property?.nickname ?? '',
    address: property?.address ?? '',
    postcode: property?.postcode ?? '',
    notes: property?.notes ?? '',
    accessNotes: property?.accessNotes ?? '',
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to save property');
      return res.json();
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={!!property} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit property</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-nickname">Nickname</Label>
            <Input id="p-nickname" value={form.nickname} onChange={set('nickname')} placeholder="e.g. Mrs Smith's BTL — Flat 2B" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="p-address">Address</Label>
              <Input id="p-address" value={form.address} onChange={set('address')} placeholder="Display address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-postcode">Postcode</Label>
              <Input id="p-postcode" value={form.postcode} onChange={set('postcode')} maxLength={10} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-access" className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-amber-600" />
              Access notes
            </Label>
            <Textarea
              id="p-access"
              value={form.accessNotes}
              onChange={set('accessNotes')}
              rows={2}
              placeholder="Key safe code, parking, gate code, dog in garden… (shown on every job sheet at this address)"
            />
            <p className="text-xs text-muted-foreground">Carried onto every future job sheet at this property.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-notes">Notes</Label>
            <Textarea id="p-notes" value={form.notes} onChange={set('notes')} rows={2} placeholder="General property notes" />
          </div>
          {save.isError && (
            <p className="text-sm text-destructive">{(save.error as Error).message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Client edit dialog. Edits the safe, human-owned fields only — display name,
// primary phone/email, billing address, notes. The server folds new phone/email
// into the contact arrays and leaves the derived dedupe_key untouched so history
// keeps resolving to this client.
function ClientEditDialog({
  client,
  onClose,
  onSaved,
}: {
  client: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    displayName: client?.display_name ?? client?.displayName ?? '',
    primaryPhone: client?.primary_phone ?? client?.primaryPhone ?? '',
    primaryEmail: client?.primary_email ?? client?.primaryEmail ?? '',
    billingAddress: client?.billing_address ?? client?.billingAddress ?? '',
    notes: client?.notes ?? '',
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to save client');
      return res.json();
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={form.displayName} onChange={set('displayName')} placeholder="Client name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.primaryPhone} onChange={set('primaryPhone')} placeholder="07…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" value={form.primaryEmail} onChange={set('primaryEmail')} placeholder="name@example.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-billing">Billing address</Label>
            <Textarea id="c-billing" value={form.billingAddress} onChange={set('billingAddress')} rows={2} placeholder="Where invoices are addressed" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Notes</Label>
            <Textarea id="c-notes" value={form.notes} onChange={set('notes')} rows={2} placeholder="Internal notes about this client" />
          </div>
          {save.isError && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Client merge dialog. Folds a DUPLICATE client (entered by its phone/email)
// INTO this one — the duplicate's leads/quotes/jobs/invoices/properties get
// repointed here and the duplicate row is deleted. This survives; the URL stays
// valid. Used to clean up the old raw-digits phone-key splits.
function ClientMergeDialog({
  client,
  onClose,
  onMerged,
}: {
  client: any;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [contact, setContact] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const merge = useMutation({
    mutationFn: async () => {
      const raw = contact.trim();
      if (!raw) throw new Error('Enter the duplicate client’s phone or email');
      // Build the duplicate's clientKey the same way the aggregation does.
      const digits = raw.replace(/\D/g, '');
      const key = digits.length >= 7 ? `phone:${digits}` : `email:${raw.toLowerCase()}`;
      // Resolve the duplicate to a real client id via the aggregation detail.
      const lookup = await fetch(`/api/clients/${encodeURIComponent(key)}`);
      if (!lookup.ok) throw new Error('No client found for that contact');
      const dup = await lookup.json();
      const dupId: string | null = dup?.clientId ?? dup?.client?.id ?? null;
      if (!dupId) throw new Error('That contact has no client record to merge');
      if (dupId === client.id) throw new Error('That is this same client');
      // Fold the duplicate INTO this client (this one survives).
      const res = await fetch(`/api/clients/${dupId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Merge failed');
      return res.json();
    },
    onSuccess: (r) => {
      const rp = r?.repointed ?? {};
      setInfo(`Merged. Moved ${rp.leads ?? 0} leads, ${rp.quotes ?? 0} quotes, ${rp.jobs ?? 0} jobs, ${rp.invoices ?? 0} invoices, ${rp.properties ?? 0} properties.`);
      onMerged();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into this client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Enter the duplicate client’s phone or email. Their entire history moves here and the duplicate record is deleted. This client survives.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="m-contact">Duplicate’s phone or email</Label>
            <Input id="m-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="07… or name@example.com" />
          </div>
          {merge.isError && <p className="text-sm text-destructive">{(merge.error as Error).message}</p>}
          {info && <p className="text-sm text-green-700">{info}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merge.isPending}>{info ? 'Close' : 'Cancel'}</Button>
          {!info && (
            <Button onClick={() => merge.mutate()} disabled={merge.isPending}>
              {merge.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Merge
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientDetailPage() {
  const [, params] = useRoute('/admin/clients/:clientKey');
  const clientKey = params?.clientKey ? decodeURIComponent(params.clientKey) : '';
  const queryClient = useQueryClient();
  const [editingProperty, setEditingProperty] = useState<any | null>(null);
  const [editingClient, setEditingClient] = useState(false);
  const [mergingClient, setMergingClient] = useState(false);

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-client', clientKey] });

  const client = data?.client ?? null;
  const isArchived = !!(client?.archived_at ?? client?.archivedAt);

  const archive = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${client.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !isArchived }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to update client');
      return res.json();
    },
    onSuccess: invalidate,
  });

  // Admin marks a job complete for work done outside the contractor field-app
  // flow. Same server spine as the contractor "complete" action, so it rolls up
  // to the quote (job-hub "Job complete" + Pay balance), fires the balance
  // invoice, and notifies the customer.
  const completeJob = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/admin/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken') || ''}`,
        },
        body: JSON.stringify({ completionType: 'full' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to complete job');
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err) => window.alert((err as Error).message || 'Failed to complete job'),
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    {data.displayName || <span className="italic text-muted-foreground">Unnamed client</span>}
                    {isArchived && <Badge variant="outline" className="bg-muted text-muted-foreground">Archived</Badge>}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
                    {(client?.billing_address ?? client?.billingAddress) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {client.billing_address ?? client.billingAddress}
                      </span>
                    )}
                  </div>
                  {client?.notes && <p className="text-xs text-muted-foreground mt-1">{client.notes}</p>}
                </div>
              </div>

              {/* Client actions — only when a first-class client record exists. */}
              {client?.id && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setEditingClient(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setMergingClient(true)}>
                    <GitMerge className="h-3.5 w-3.5 mr-1" />
                    Merge
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => archive.mutate()} disabled={archive.isPending}>
                    {archive.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1" />}
                    {isArchived ? 'Unarchive' : 'Archive'}
                  </Button>
                </div>
              )}
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

          {/* Properties — WHERE the work happened. One client can own several
              (landlords / property managers); each property groups its own work. */}
          <Section icon={MapPin} title="Properties" count={data.properties?.length ?? 0}>
            <div className="space-y-2">
              {(data.properties ?? []).map((p) => (
                <div key={p.id} className="flex items-start justify-between border-b border-border py-2 last:border-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {p.nickname || p.address || p.postcode || 'Property'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.address && p.nickname ? `${p.address} · ` : ''}
                      {p.postcode ? `${p.postcode} · ` : ''}
                      {p.counts?.quotes ?? 0} quotes · {p.counts?.jobs ?? 0} jobs · {p.counts?.invoices ?? 0} invoices
                    </p>
                    {p.accessNotes && (
                      <p className="text-xs text-amber-700 flex items-start gap-1 mt-1">
                        <KeyRound className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="truncate">{p.accessNotes}</span>
                      </p>
                    )}
                    {p.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.notes}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 px-2"
                    onClick={() => setEditingProperty(p)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </Section>

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
              {data.jobs.map((j) => {
                const isDone = !!j.completedAt || j.dayOfStatus === 'completed' || j.status === 'completed';
                const completing = completeJob.isPending && completeJob.variables === j.id;
                return (
                  <div key={j.id} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{j.description || 'Job'}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.scheduledDate ? `scheduled ${fmtDate(j.scheduledDate)}` : fmtDate(j.createdAt)}
                        {j.scheduledSlot ? ` · ${j.scheduledSlot}` : ''}
                        {j.completedAt ? ` · completed ${fmtDate(j.completedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isDone && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={completing}
                          onClick={() => {
                            if (window.confirm('Mark this job complete? This generates the balance invoice and notifies the customer their job is done.')) {
                              completeJob.mutate(j.id);
                            }
                          }}
                        >
                          {completing
                            ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                          Mark complete
                        </Button>
                      )}
                      <StatusBadge value={j.dayOfStatus || j.status} />
                    </div>
                  </div>
                );
              })}
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

      {editingProperty && (
        <PropertyEditDialog
          key={editingProperty.id}
          property={editingProperty}
          onClose={() => setEditingProperty(null)}
          onSaved={invalidate}
        />
      )}

      {editingClient && client?.id && (
        <ClientEditDialog
          key={client.id}
          client={client}
          onClose={() => setEditingClient(false)}
          onSaved={invalidate}
        />
      )}

      {mergingClient && client?.id && (
        <ClientMergeDialog
          key={client.id}
          client={client}
          onClose={() => setMergingClient(false)}
          onMerged={invalidate}
        />
      )}
    </div>
  );
}
