import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Users,
  Search,
  Loader2,
  FileText,
  Wrench,
  Receipt,
  Inbox,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Jobber-style "Clients" list. Read-only view over the spine tables, served by
// GET /api/clients (server/client-aggregation.ts). There is no clients table —
// each row is a contact-key grouping of leads/quotes/jobs/invoices.
// ---------------------------------------------------------------------------

interface ClientRow {
  clientKey: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  counts: { leads: number; quotes: number; jobs: number; invoices: number };
  latestActivityAt: string | null;
}

interface ClientsResponse {
  clients: ClientRow[];
  total: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CountPill({ icon: Icon, value, label }: { icon: any; value: number; label: string }) {
  const active = value > 0;
  return (
    <span
      title={`${value} ${label}`}
      className={
        active
          ? 'inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground'
          : 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/40'
      }
    >
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

export default function ClientsPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery<ClientsResponse>({
    queryKey: ['admin-clients'],
    queryFn: async () => {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('Failed to fetch clients');
      return res.json();
    },
  });

  const clients = data?.clients ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? clients.filter(
        (c) =>
          (c.displayName?.toLowerCase().includes(term) ?? false) ||
          (c.phone?.toLowerCase().includes(term) ?? false) ||
          (c.email?.toLowerCase().includes(term) ?? false) ||
          c.clientKey.toLowerCase().includes(term),
      )
    : clients;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Clients</h1>
          {data && (
            <Badge variant="secondary" className="ml-1">
              {data.total}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Every customer, stitched across leads, quotes, jobs and invoices.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search name, phone or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading clients…
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            Failed to load clients. {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p>{term ? 'No clients match your search.' : 'No clients yet.'}</p>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {!isLoading && !error && filtered.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Engagement</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.clientKey} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/clients/${encodeURIComponent(c.clientKey)}`}
                        className="block hover:text-primary"
                      >
                        {c.displayName || (
                          <span className="text-muted-foreground italic">Unnamed</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div>{c.phone || '—'}</div>
                      <div className="truncate max-w-[200px]">{c.email || ''}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <CountPill icon={Users} value={c.counts.leads} label="leads" />
                        <CountPill icon={FileText} value={c.counts.quotes} label="quotes" />
                        <CountPill icon={Wrench} value={c.counts.jobs} label="jobs" />
                        <CountPill icon={Receipt} value={c.counts.invoices} label="invoices" />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(c.latestActivityAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/clients/${encodeURIComponent(c.clientKey)}`}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
