import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Wand2,
  Search,
  FlaskConical,
  Eye,
  Link2,
  Filter,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ParsedJobResult } from '@shared/contextual-pricing-types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface QuoteRecord {
  id: string;
  shortSlug: string;
  customerName: string;
  segment: string | null;
  layoutTier: string | null;
  contextualHeadline: string | null;
  basePrice: number | null;
  finalPricePence: number | null;
  pricingLineItems: any[] | null;
  valueBullets: string[] | null;
  requiresHumanReview: boolean | null;
  reviewReason: string | null;
  createdAt: string;
  viewedAt: string | null;
  bookedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPence(pence: number | null | undefined): string {
  if (pence == null) return '--';
  return `\u00A3${(pence / 100).toFixed(0)}`;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '--';
  // basePrice could be pounds or pence depending on API — handle both
  if (price > 500) return `\u00A3${(price / 100).toFixed(0)}`;
  return `\u00A3${price.toFixed(0)}`;
}

const TIER_COLORS: Record<string, string> = {
  quick: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
  standard: 'border-green-500/40 text-green-400 bg-green-500/10',
  complex: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
};

const SEGMENT_COLORS: Record<string, string> = {
  CONTEXTUAL: 'border-amber-500/40 text-amber-400',
  BUSY_PRO: 'border-cyan-500/40 text-cyan-400',
  LANDLORD: 'border-indigo-500/40 text-indigo-400',
  PROP_MGR: 'border-pink-500/40 text-pink-400',
  ELDERLY: 'border-orange-500/40 text-orange-400',
  FIRST_TIMER: 'border-teal-500/40 text-teal-400',
};

// Pre-filled test scenarios
const TEST_SCENARIOS = [
  {
    label: 'Emergency Plumbing',
    name: 'Test - Emergency',
    description: 'Burst pipe under kitchen sink, water leaking everywhere. Need someone ASAP today.',
  },
  {
    label: '3 Mixed Jobs',
    name: 'Test - Mixed Batch',
    description: 'Fix leaking kitchen tap, hang 3 floating shelves in living room, assemble IKEA MALM wardrobe in bedroom.',
  },
  {
    label: '5 Job Complex',
    name: 'Test - Complex',
    description: 'Replace bathroom extractor fan, fit new door handle on 3 internal doors, mount 55" TV on brick wall in lounge, fix squeaky floorboard on landing, install cat flap in back door.',
  },
  {
    label: 'Budget Flat Pack',
    name: 'Test - Flat Pack',
    description: 'Assemble 1 IKEA Billy bookcase. Customer has all parts and tools. Standard timing, no rush.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function QuoteTestLab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Filter state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<string>('all');

  // ── Quick Generate state ──
  const [genName, setGenName] = useState('');
  const [genDescription, setGenDescription] = useState('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // ── Signal state ──
  const [sigUrgency, setSigUrgency] = useState<'standard' | 'priority' | 'emergency'>('standard');
  const [sigMaterials, setSigMaterials] = useState<'customer_supplied' | 'we_supply' | 'labor_only'>('labor_only');
  const [sigScheduling, setSigScheduling] = useState<'standard' | 'after_hours' | 'weekend'>('standard');
  const [sigReturning, setSigReturning] = useState(false);
  const [sigPrevJobs, setSigPrevJobs] = useState(0);

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Fetch all quotes
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: quotes = [], isLoading } = useQuery<QuoteRecord[]>({
    queryKey: ['/api/personalized-quotes'],
    queryFn: async () => {
      const res = await fetch('/api/personalized-quotes', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch quotes');
      return res.json();
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Parse job description
  // ═══════════════════════════════════════════════════════════════════════════

  const parseJobMutation = useMutation({
    mutationFn: async (description: string): Promise<ParsedJobResult> => {
      const res = await fetch('/api/pricing/parse-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse');
      }
      return res.json();
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Create contextual quote
  // ═══════════════════════════════════════════════════════════════════════════

  const createQuoteMutation = useMutation({
    mutationFn: async ({ name, description, parsedLines, signals }: {
      name: string;
      description: string;
      parsedLines: ParsedJobResult['lines'];
      signals: {
        urgency: string;
        materialsSupply: string;
        timeOfService: string;
        isReturningCustomer: boolean;
        previousJobCount: number;
        previousAvgPricePence: number;
      };
    }) => {
      const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
      const res = await fetch('/api/pricing/create-contextual-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          customerName: name,
          phone: '07700900000', // test phone
          jobDescription: description,
          lines: parsedLines.map((line) => ({
            id: line.id,
            description: line.description,
            category: line.category,
            estimatedMinutes: line.timeEstimateMinutes,
          })),
          signals,
          createdBy: adminUser?.id != null ? String(adminUser.id) : undefined,
          createdByName: adminUser?.name || adminUser?.email || 'Test Lab',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create quote' }));
        throw new Error(err.error || err.message || 'Failed to create quote');
      }
      return res.json();
    },
    onSuccess: (result) => {
      toast({ title: 'Quote Created', description: `Slug: ${result.shortSlug}` });
      queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
      setGenName('');
      setGenDescription('');
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleParseAndGenerate = async () => {
    if (!genName.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    if (!genDescription.trim()) {
      toast({ title: 'Description required', variant: 'destructive' });
      return;
    }

    try {
      const parsed = await parseJobMutation.mutateAsync(genDescription.trim());
      if (!parsed.lines || parsed.lines.length === 0) {
        toast({ title: 'No line items parsed', description: 'AI could not extract jobs from description.', variant: 'destructive' });
        return;
      }
      await createQuoteMutation.mutateAsync({
        name: genName.trim(),
        description: genDescription.trim(),
        parsedLines: parsed.lines,
        signals: {
          urgency: sigUrgency,
          materialsSupply: sigMaterials,
          timeOfService: sigScheduling,
          isReturningCustomer: sigReturning,
          previousJobCount: sigReturning ? sigPrevJobs : 0,
          previousAvgPricePence: 0,
        },
      });
    } catch {
      // errors handled by mutation callbacks
    }
  };

  const handleScenario = (scenario: typeof TEST_SCENARIOS[0]) => {
    setGenName(scenario.name);
    setGenDescription(scenario.description);
  };

  const handleCopyLink = (slug: string) => {
    const url = `${window.location.origin}/quote/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    toast({ title: 'Link copied!' });
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleViewQuote = (slug: string) => {
    window.open(`/quote/${slug}`, '_blank');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Filtered quotes
  // ═══════════════════════════════════════════════════════════════════════════

  const uniqueSegments = Array.from(new Set(quotes.map((q) => q.segment).filter(Boolean))) as string[];

  const filteredQuotes = quotes.filter((q) => {
    const matchesSearch =
      !searchQuery ||
      q.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.shortSlug?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.contextualHeadline?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSegment = segmentFilter === 'all' || q.segment === segmentFilter;

    return matchesSearch && matchesSegment;
  });

  // Sort newest first
  const sortedQuotes = [...filteredQuotes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const isGenerating = parseJobMutation.isPending || createQuoteMutation.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* ─── Header ─── */}
      <div>
        <div className="flex items-center gap-2.5">
          <FlaskConical className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Quote Test Lab</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Visual QA for contextual quotes before going live
        </p>
      </div>

      {/* ─── Quick Generate Section ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-amber-400" />
            Quick Generate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Scenario Buttons */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Pre-filled Scenarios</Label>
            <div className="flex flex-wrap gap-2">
              {TEST_SCENARIOS.map((scenario) => (
                <Button
                  key={scenario.label}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handleScenario(scenario)}
                >
                  {scenario.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Form fields */}
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
            <div>
              <Label htmlFor="gen-name" className="text-xs text-muted-foreground">
                Customer Name
              </Label>
              <Input
                id="gen-name"
                placeholder="Test - Jane Doe"
                value={genName}
                onChange={(e) => setGenName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="gen-desc" className="text-xs text-muted-foreground">
                Job Description
              </Label>
              <Textarea
                id="gen-desc"
                placeholder="Describe the work needed..."
                value={genDescription}
                onChange={(e) => setGenDescription(e.target.value)}
                className="mt-1 min-h-[60px]"
                rows={2}
              />
            </div>
          </div>

          {/* Context Signals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Urgency</Label>
              <div className="flex gap-1">
                {(['standard', 'priority', 'emergency'] as const).map((v) => (
                  <Button
                    key={v}
                    variant={sigUrgency === v ? 'default' : 'outline'}
                    size="sm"
                    className={`text-xs h-7 flex-1 ${sigUrgency === v ? (v === 'emergency' ? 'bg-red-600 hover:bg-red-700' : v === 'priority' ? 'bg-amber-600 hover:bg-amber-700' : '') : ''}`}
                    onClick={() => setSigUrgency(v)}
                  >
                    {v === 'standard' ? 'Std' : v === 'priority' ? 'Priority' : 'Emergency'}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Materials</Label>
              <div className="flex gap-1">
                {([['labor_only', 'Labour'], ['we_supply', 'We Supply'], ['customer_supplied', 'Customer']] as const).map(([v, label]) => (
                  <Button
                    key={v}
                    variant={sigMaterials === v ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 flex-1"
                    onClick={() => setSigMaterials(v)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Scheduling</Label>
              <div className="flex gap-1">
                {([['standard', 'Weekday'], ['after_hours', 'Evening'], ['weekend', 'Weekend']] as const).map(([v, label]) => (
                  <Button
                    key={v}
                    variant={sigScheduling === v ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs h-7 flex-1"
                    onClick={() => setSigScheduling(v)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Returning Customer</Label>
              <div className="flex gap-1 items-center">
                <Button
                  variant={sigReturning ? 'default' : 'outline'}
                  size="sm"
                  className={`text-xs h-7 flex-1 ${sigReturning ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setSigReturning(!sigReturning)}
                >
                  {sigReturning ? 'Yes' : 'No'}
                </Button>
                {sigReturning && (
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={sigPrevJobs}
                    onChange={(e) => setSigPrevJobs(parseInt(e.target.value) || 0)}
                    className="w-16 h-7 text-xs"
                    placeholder="Jobs"
                  />
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleParseAndGenerate}
            disabled={isGenerating || !genName.trim() || !genDescription.trim()}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {parseJobMutation.isPending ? 'Parsing...' : 'Creating Quote...'}
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Parse & Generate
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Filter Bar ─── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, slug, headline..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={segmentFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setSegmentFilter('all')}
            >
              All ({quotes.length})
            </Button>
            {uniqueSegments.map((seg) => (
              <Button
                key={seg}
                variant={segmentFilter === seg ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-7"
                onClick={() => setSegmentFilter(seg)}
              >
                {seg} ({quotes.filter((q) => q.segment === seg).length})
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Quote Count ─── */}
      <div className="text-sm text-muted-foreground">
        Showing {sortedQuotes.length} of {quotes.length} quotes
      </div>

      {/* ─── Quote Cards Grid ─── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedQuotes.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No quotes found. Generate one above to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedQuotes.map((quote) => {
            const lineItems = Array.isArray(quote.pricingLineItems) ? quote.pricingLineItems : [];
            const categories = Array.from(new Set(lineItems.map((li: any) => li.category).filter(Boolean)));
            const price = quote.finalPricePence ?? quote.basePrice;
            const tierClass = TIER_COLORS[quote.layoutTier || ''] || 'border-gray-500/40 text-gray-400';
            const segClass = SEGMENT_COLORS[quote.segment || ''] || 'border-gray-500/40 text-gray-400';

            return (
              <Card
                key={quote.id}
                className="border-border hover:border-muted-foreground/30 transition-colors"
              >
                <CardContent className="pt-5 pb-4 space-y-3">
                  {/* Top row: name + badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground truncate text-sm">
                        {quote.customerName || 'Unknown'}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(quote.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {quote.layoutTier && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tierClass}`}>
                          {quote.layoutTier}
                        </Badge>
                      )}
                      {quote.segment && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${segClass}`}>
                          {quote.segment}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Headline */}
                  {quote.contextualHeadline && (
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-2 italic">
                      "{quote.contextualHeadline}"
                    </p>
                  )}

                  {/* Price + line items info */}
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-amber-400">
                      {quote.finalPricePence
                        ? formatPence(quote.finalPricePence)
                        : quote.basePrice
                        ? formatPrice(quote.basePrice)
                        : '--'}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {lineItems.length > 0 && (
                        <span>{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</span>
                      )}
                      {categories.length > 0 && (
                        <span className="text-muted-foreground/60">{categories.length} cat{categories.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>

                  {/* Human review flag */}
                  {quote.requiresHumanReview && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Badge variant="outline" className="border-red-500/40 text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0 gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Needs Review
                      </Badge>
                      {quote.reviewReason && (
                        <span className="text-muted-foreground/70 truncate">{quote.reviewReason}</span>
                      )}
                    </div>
                  )}

                  {/* Slug */}
                  <div className="text-[11px] text-muted-foreground/50 font-mono truncate">
                    /quote/{quote.shortSlug}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-8 gap-1.5"
                      onClick={() => handleViewQuote(quote.shortSlug)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Quote
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-8 gap-1.5"
                      onClick={() => handleCopyLink(quote.shortSlug)}
                    >
                      {copiedSlug === quote.shortSlug ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      Copy Link
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
