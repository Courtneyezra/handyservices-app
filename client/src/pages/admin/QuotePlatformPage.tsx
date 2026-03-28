import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  Image,
  Type,
  MessageSquare,
  BarChart3,
  Plus,
  Edit2,
  Trash2,
  Upload,
  Star,
  Eye,
  TrendingUp,
  Filter,
  Users,
  CheckCircle,
  CreditCard,
  Send,
  Award,
  ArrowRight,
} from 'lucide-react';

// ─── Auth helper ────────────────────────────────────────────────────────────
function auth(): Record<string, string> {
  const t = localStorage.getItem('adminToken');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ─── Constants ───────────────────────────────────────────────────────────────
const ARCHETYPES = ['homeowner', 'landlord', 'property_manager', 'professional', 'elderly', 'family'] as const;
const GENDER_CUES = ['male', 'female', 'neutral', 'couple'] as const;
const JOB_TYPES = ['plumbing', 'carpentry', 'painting', 'electrical', 'general', 'property'] as const;
const SECTIONS = ['social_proof', 'guarantee', 'hassle_comparison', 'hero_sub'] as const;
const CUSTOMER_TYPES = ['landlords', 'homeowners', 'professionals', 'property_managers', 'businesses'] as const;
const TEST_SOURCES = ['google', 'manual'] as const;
const RATING_OPTIONS = [1, 2, 3, 4, 5] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface QPImage {
  id: number;
  url: string;
  alt?: string;
  archetypes: string[];
  gender_cues: string[];
  job_types: string[];
  is_active: boolean;
  conversion_rate?: number;
}

interface QPHeadline {
  id: number;
  section: string;
  text: string;
  customer_type: string;
  is_active: boolean;
  view_count: number;
  conversion_rate: number;
}

interface QPTestimonial {
  id: number;
  author: string;
  text: string;
  rating: number;
  archetype: string;
  location?: string;
  is_active: boolean;
  source: string;
}

interface QPAnalytics {
  reset_at: string | null;
  funnel: { sent: number; viewed: number; booked: number; paid: number };
  tiers: Array<{ tier: string; count: number; viewed: number; booked: number; conversion: number }>;
  headline_performance?: Array<{ headline: string | null; total: number; viewed: number; booked: number; conversion: number }>;
  image_performance?: Array<{ id: number; url: string; alt: string | null; archetypes: string[]; view_count: number; booking_count: number; conversion_rate: number }>;
  context_quality?: { buckets: Record<string, number>; conversions: Record<string, number> };
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function Ld() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
    </div>
  );
}

function EmptyState({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="text-center py-16 text-slate-500">
      <Plus className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm mb-3">No {label} yet.</p>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
        <Plus className="w-4 h-4" /> Add first
      </Button>
    </div>
  );
}

function TagToggle({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: readonly string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-400">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o}
            type="button"
            variant={selected.includes(o) ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() =>
              onChange(
                selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
              )
            }
          >
            {o.replace('_', ' ')}
          </Button>
        ))}
      </div>
    </div>
  );
}

function StarRating({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${s <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`}
        />
      ))}
    </span>
  );
}

function TagBadge({ value, color = 'purple' }: { value: string; color?: string }) {
  const colors: Record<string, string> = {
    purple: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    blue: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
    green: 'border-green-500/40 text-green-400 bg-green-500/10',
    amber: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
  };
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colors[color] ?? colors.purple}`}>
      {value.replace('_', ' ')}
    </Badge>
  );
}

// ─── Tab 1: Image Library ─────────────────────────────────────────────────────
function ImageLibraryTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filterArchetype, setFilterArchetype] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterJob, setFilterJob] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<QPImage | null>(null);
  const [formArchetypes, setFormArchetypes] = useState<string[]>([]);
  const [formGenders, setFormGenders] = useState<string[]>([]);
  const [formJobs, setFormJobs] = useState<string[]>([]);
  const [formAlt, setFormAlt] = useState('');

  const { data: images = [], isLoading } = useQuery<QPImage[]>({
    queryKey: ['/api/quote-platform/images'],
    queryFn: async () => {
      const r = await fetch('/api/quote-platform/images', { headers: auth() });
      if (!r.ok) return [];
      return r.json();
    },
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const r = await fetch(`/api/quote-platform/images/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ is_active }),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/quote-platform/images'] }),
    onError: () => toast({ title: 'Error toggling image', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Partial<QPImage> & { id: number }) => {
      const { id, ...rest } = body;
      const r = await fetch(`/api/quote-platform/images/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(rest),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Image updated' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/images'] });
      setEditOpen(false);
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch('/api/quote-platform/images', {
        method: 'POST',
        headers: auth(),
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      toast({ title: 'Image uploaded' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/images'] });
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  function openEdit(img: QPImage) {
    setEditItem(img);
    setFormArchetypes(img.archetypes ?? []);
    setFormGenders(img.gender_cues ?? []);
    setFormJobs(img.job_types ?? []);
    setFormAlt(img.alt ?? '');
    setEditOpen(true);
  }

  const filtered = images.filter((img) => {
    if (filterArchetype && !img.archetypes?.includes(filterArchetype)) return false;
    if (filterGender && !img.gender_cues?.includes(filterGender)) return false;
    if (filterJob && !img.job_types?.includes(filterJob)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1"
            value={filterArchetype}
            onChange={(e) => setFilterArchetype(e.target.value)}
          >
            <option value="">All archetypes</option>
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
          </select>
          <select
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1"
            value={filterGender}
            onChange={(e) => setFilterGender(e.target.value)}
          >
            <option value="">All genders</option>
            {GENDER_CUES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1"
            value={filterJob}
            onChange={(e) => setFilterJob(e.target.value)}
          >
            <option value="">All job types</option>
            {JOB_TYPES.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          {(filterArchetype || filterGender || filterJob) && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setFilterArchetype(''); setFilterGender(''); setFilterJob(''); }}>
              Clear
            </Button>
          )}
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <Button
            size="sm"
            className="gap-1.5"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload Image
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Ld />
      ) : filtered.length === 0 ? (
        <EmptyState label="images" onAdd={() => fileRef.current?.click()} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((img) => (
            <Card key={img.id} className="bg-slate-800/60 border-slate-700/50 overflow-hidden">
              <div className="relative aspect-square bg-slate-900">
                <img
                  src={img.url}
                  alt={img.alt ?? 'Quote image'}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="%23334155"/></svg>'; }}
                />
                {!img.is_active && (
                  <div className="absolute inset-0 bg-slate-900/70 flex items-center justify-center">
                    <span className="text-xs text-slate-400">Inactive</span>
                  </div>
                )}
              </div>
              <CardContent className="p-2 space-y-2">
                {img.alt && <p className="text-[10px] text-slate-400 truncate">{img.alt}</p>}
                <div className="flex flex-wrap gap-0.5">
                  {img.archetypes?.map((a) => <TagBadge key={a} value={a} color="purple" />)}
                  {img.gender_cues?.map((g) => <TagBadge key={g} value={g} color="blue" />)}
                  {img.job_types?.map((j) => <TagBadge key={j} value={j} color="green" />)}
                </div>
                {img.conversion_rate !== undefined && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <TrendingUp className="w-3 h-3" />
                    {img.conversion_rate.toFixed(1)}% conv.
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Switch
                    checked={img.is_active}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: img.id, is_active: v })}
                    className="scale-75 origin-left"
                  />
                  <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => openEdit(img)}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Edit Image Tags</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-slate-400">Alt text</Label>
              <Input
                value={formAlt}
                onChange={(e) => setFormAlt(e.target.value)}
                className="mt-1 bg-slate-800 border-slate-700 text-slate-200 text-sm"
                placeholder="Describe the image..."
              />
            </div>
            <TagToggle label="Archetypes" selected={formArchetypes} options={ARCHETYPES} onChange={setFormArchetypes} />
            <TagToggle label="Gender cues" selected={formGenders} options={GENDER_CUES} onChange={setFormGenders} />
            <TagToggle label="Job types" selected={formJobs} options={JOB_TYPES} onChange={setFormJobs} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="border-slate-700">Cancel</Button>
            <Button
              disabled={updateMutation.isPending}
              onClick={() => {
                if (!editItem) return;
                updateMutation.mutate({
                  id: editItem.id,
                  alt: formAlt,
                  archetypes: formArchetypes,
                  gender_cues: formGenders,
                  job_types: formJobs,
                });
              }}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 2: Headline Variants ─────────────────────────────────────────────────
function HeadlineVariantsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<QPHeadline | null>(null);
  const [formSection, setFormSection] = useState<string>(SECTIONS[0]);
  const [formText, setFormText] = useState('');
  const [formCustomerType, setFormCustomerType] = useState<string>(CUSTOMER_TYPES[0]);

  const { data: headlines = [], isLoading } = useQuery<QPHeadline[]>({
    queryKey: ['/api/quote-platform/headlines'],
    queryFn: async () => {
      const r = await fetch('/api/quote-platform/headlines', { headers: auth() });
      if (!r.ok) return [];
      return r.json();
    },
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (body: { section: string; text: string; customer_type: string }) => {
      const r = await fetch('/api/quote-platform/headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Headline created' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/headlines'] });
      setDialogOpen(false);
    },
    onError: () => toast({ title: 'Create failed', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Partial<QPHeadline> & { id: number }) => {
      const { id, ...rest } = body;
      const r = await fetch(`/api/quote-platform/headlines/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(rest),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Headline updated' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/headlines'] });
      setDialogOpen(false);
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/quote-platform/headlines/${id}`, {
        method: 'DELETE',
        headers: auth(),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Headline deleted' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/headlines'] });
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  });

  function openAdd() {
    setEditItem(null);
    setFormSection(SECTIONS[0]);
    setFormText('');
    setFormCustomerType(CUSTOMER_TYPES[0]);
    setDialogOpen(true);
  }

  function openEdit(h: QPHeadline) {
    setEditItem(h);
    setFormSection(h.section);
    setFormText(h.text);
    setFormCustomerType(h.customer_type);
    setDialogOpen(true);
  }

  function handleSave() {
    if (!formText.trim()) return;
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, section: formSection, text: formText, customer_type: formCustomerType });
    } else {
      createMutation.mutate({ section: formSection, text: formText, customer_type: formCustomerType });
    }
  }

  const sectionColors: Record<string, string> = {
    social_proof: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
    guarantee: 'border-green-500/40 text-green-400 bg-green-500/10',
    hassle_comparison: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    hero_sub: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
  };

  // Group by section
  const grouped = SECTIONS.reduce<Record<string, QPHeadline[]>>((acc, s) => {
    acc[s] = headlines.filter((h) => h.section === s);
    return acc;
  }, {} as Record<string, QPHeadline[]>);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add Headline
        </Button>
      </div>

      {isLoading ? (
        <Ld />
      ) : headlines.length === 0 ? (
        <EmptyState label="headline variants" onAdd={openAdd} />
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={`text-xs ${sectionColors[section] ?? ''}`}>
                  {section.replace('_', ' ')}
                </Badge>
                <span className="text-xs text-slate-500">{grouped[section]?.length ?? 0} variants</span>
              </div>
              <div className="rounded-lg border border-slate-700/50 divide-y divide-slate-700/50 overflow-hidden">
                {grouped[section]?.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-slate-500 italic">No variants — add one above</div>
                ) : (
                  grouped[section].map((h) => (
                    <div key={h.id} className="flex items-start gap-3 px-4 py-3 bg-slate-800/40 hover:bg-slate-800/70 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 leading-snug">{h.text}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <TagBadge value={h.customer_type} color="amber" />
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Eye className="w-3 h-3" />{h.view_count}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <TrendingUp className="w-3 h-3" />{h.conversion_rate?.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          checked={h.is_active}
                          onCheckedChange={(v) => updateMutation.mutate({ id: h.id, is_active: v })}
                          className="scale-75"
                        />
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEdit(h)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-red-400 hover:text-red-300" onClick={() => deleteMutation.mutate(h.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-100">{editItem ? 'Edit Headline' : 'Add Headline Variant'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-slate-400">Section</Label>
              <select
                className="mt-1 w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2"
                value={formSection}
                onChange={(e) => setFormSection(e.target.value)}
              >
                {SECTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Headline text</Label>
              <Textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                className="mt-1 bg-slate-800 border-slate-700 text-slate-200 text-sm min-h-[80px]"
                placeholder="Enter headline text..."
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Customer type</Label>
              <select
                className="mt-1 w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2"
                value={formCustomerType}
                onChange={(e) => setFormCustomerType(e.target.value)}
              >
                {CUSTOMER_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-700">Cancel</Button>
            <Button
              disabled={!formText.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : editItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 3: Testimonials ───────────────────────────────────────────────────────
function TestimonialsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterArchetype, setFilterArchetype] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<QPTestimonial | null>(null);
  const [formAuthor, setFormAuthor] = useState('');
  const [formText, setFormText] = useState('');
  const [formRating, setFormRating] = useState(5);
  const [formArchetype, setFormArchetype] = useState(ARCHETYPES[0]);
  const [formLocation, setFormLocation] = useState('');
  const [formSource, setFormSource] = useState<string>(TEST_SOURCES[0]);

  const { data: testimonials = [], isLoading } = useQuery<QPTestimonial[]>({
    queryKey: ['/api/quote-platform/testimonials'],
    queryFn: async () => {
      const r = await fetch('/api/quote-platform/testimonials', { headers: auth() });
      if (!r.ok) return [];
      return r.json();
    },
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (body: Omit<QPTestimonial, 'id' | 'is_active'>) => {
      const r = await fetch('/api/quote-platform/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Testimonial created' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/testimonials'] });
      setDialogOpen(false);
    },
    onError: () => toast({ title: 'Create failed', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Partial<QPTestimonial> & { id: number }) => {
      const { id, ...rest } = body;
      const r = await fetch(`/api/quote-platform/testimonials/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(rest),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Testimonial updated' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/testimonials'] });
      setDialogOpen(false);
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/quote-platform/testimonials/${id}`, {
        method: 'DELETE',
        headers: auth(),
      });
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Testimonial deleted' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/testimonials'] });
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  });

  function openAdd() {
    setEditItem(null);
    setFormAuthor(''); setFormText(''); setFormRating(5);
    setFormArchetype(ARCHETYPES[0]); setFormLocation(''); setFormSource(TEST_SOURCES[0]);
    setDialogOpen(true);
  }

  function openEdit(t: QPTestimonial) {
    setEditItem(t);
    setFormAuthor(t.author); setFormText(t.text); setFormRating(t.rating);
    setFormArchetype(t.archetype as typeof ARCHETYPES[number]); setFormLocation(t.location ?? ''); setFormSource(t.source);
    setDialogOpen(true);
  }

  function handleSave() {
    if (!formAuthor.trim() || !formText.trim()) return;
    const body = { author: formAuthor, text: formText, rating: formRating, archetype: formArchetype, location: formLocation, source: formSource };
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, ...body });
    } else {
      createMutation.mutate(body);
    }
  }

  const filtered = testimonials.filter((t) => !filterArchetype || t.archetype === filterArchetype);

  const sourceColor = (s: string) => s === 'google' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' : 'border-slate-600 text-slate-400 bg-slate-700/30';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1"
            value={filterArchetype}
            onChange={(e) => setFilterArchetype(e.target.value)}
          >
            <option value="">All archetypes</option>
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
          </select>
          {filterArchetype && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setFilterArchetype('')}>Clear</Button>
          )}
        </div>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add Testimonial
        </Button>
      </div>

      {isLoading ? (
        <Ld />
      ) : filtered.length === 0 ? (
        <EmptyState label="testimonials" onAdd={openAdd} />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card key={t.id} className="bg-slate-800/40 border-slate-700/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-slate-200">{t.author}</span>
                      {t.location && <span className="text-xs text-slate-500">{t.location}</span>}
                      <StarRating value={t.rating} />
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${sourceColor(t.source)}`}>{t.source}</Badge>
                      <TagBadge value={t.archetype} color="purple" />
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">"{t.text}"</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={t.is_active}
                      onCheckedChange={(v) => updateMutation.mutate({ id: t.id, is_active: v })}
                      className="scale-75"
                    />
                    <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEdit(t)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-red-400 hover:text-red-300" onClick={() => deleteMutation.mutate(t.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-100">{editItem ? 'Edit Testimonial' : 'Add Testimonial'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400">Author name</Label>
                <Input value={formAuthor} onChange={(e) => setFormAuthor(e.target.value)} className="mt-1 bg-slate-800 border-slate-700 text-slate-200 text-sm" placeholder="Jane S." />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Location</Label>
                <Input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} className="mt-1 bg-slate-800 border-slate-700 text-slate-200 text-sm" placeholder="London, UK" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Testimonial text</Label>
              <Textarea value={formText} onChange={(e) => setFormText(e.target.value)} className="mt-1 bg-slate-800 border-slate-700 text-slate-200 text-sm min-h-[80px]" placeholder="Customer quote..." />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-slate-400">Rating</Label>
                <select className="mt-1 w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5" value={formRating} onChange={(e) => setFormRating(Number(e.target.value))}>
                  {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r} star{r !== 1 ? 's' : ''}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Archetype</Label>
                <select className="mt-1 w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5" value={formArchetype} onChange={(e) => setFormArchetype(e.target.value)}>
                  {ARCHETYPES.map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Source</Label>
                <select className="mt-1 w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5" value={formSource} onChange={(e) => setFormSource(e.target.value)}>
                  {TEST_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-700">Cancel</Button>
            <Button
              disabled={!formAuthor.trim() || !formText.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : editItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 4: Analytics ─────────────────────────────────────────────────────────
function AnalyticsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [resetting, setResetting] = useState(false);

  const { data: analytics, isLoading } = useQuery<QPAnalytics>({
    queryKey: ['/api/quote-platform/analytics'],
    queryFn: async () => {
      const r = await fetch('/api/quote-platform/analytics', { headers: auth() });
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
  });

  async function handleReset() {
    if (!confirm('Reset analytics to zero? This stamps a new start date — only quotes created AFTER this moment will appear in the funnel. Image/headline counters also reset.')) return;
    setResetting(true);
    try {
      const r = await fetch('/api/quote-platform/analytics/reset', { method: 'POST', headers: auth() });
      if (!r.ok) throw new Error('Reset failed');
      toast({ title: 'Analytics reset', description: 'Clean slate from now. Only new quotes will count.' });
      qc.invalidateQueries({ queryKey: ['/api/quote-platform/analytics'] });
    } catch {
      toast({ title: 'Reset failed', variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  }

  function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  const funnel = analytics?.funnel ?? { sent: 0, viewed: 0, booked: 0, paid: 0 };
  const tiers = analytics?.tiers ?? [];
  const headlines = analytics?.headline_performance ?? [];
  const images = analytics?.image_performance ?? [];
  const ctx = analytics?.context_quality;

  const funnelSteps = [
    { label: 'Sent', value: funnel.sent, icon: Send, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
    { label: 'Viewed', value: funnel.viewed, icon: Eye, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
    { label: 'Booked', value: funnel.booked, icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
    { label: 'Paid', value: funnel.paid, icon: CreditCard, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  ];

  return (
    <div className="space-y-6">
      {/* Header row with reset button */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Contextual quotes only (segment = CONTEXTUAL)</p>
          {analytics?.reset_at && (
            <p className="text-xs text-slate-500 mt-0.5">
              Tracking from: {new Date(analytics.reset_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={resetting}
          className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
        >
          {resetting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
          Reset Analytics
        </Button>
      </div>

      {isLoading ? <Ld /> : (
        <>
          {/* Funnel */}
          <Card className="bg-slate-800/40 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Conversion Funnel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-stretch gap-0">
                {funnelSteps.map((step, i) => {
                  const Icon = step.icon;
                  const prevVal = i > 0 ? funnelSteps[i - 1].value : step.value;
                  const rate = i === 0 ? 100 : pct(step.value, prevVal);
                  return (
                    <div key={step.label} className="flex items-center flex-1 min-w-0">
                      <div className={`flex-1 rounded-lg border p-4 text-center ${step.bg}`}>
                        <Icon className={`w-5 h-5 mx-auto mb-1 ${step.color}`} />
                        <div className="text-2xl font-bold text-slate-100">{step.value.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{step.label}</div>
                        {i > 0 && (
                          <div className={`text-xs font-medium mt-1 ${rate >= 50 ? 'text-green-400' : rate >= 25 ? 'text-amber-400' : 'text-red-400'}`}>
                            {rate}% step
                          </div>
                        )}
                      </div>
                      {i < funnelSteps.length - 1 && <ArrowRight className="w-4 h-4 text-slate-600 mx-1 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Layout tier + VA context quality side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Layout Tiers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tiers.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">No tier data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {tiers.map((tier) => (
                      <div key={tier.tier} className="flex items-center justify-between py-1.5 border-b border-slate-700/40 last:border-0">
                        <span className="text-sm font-medium text-slate-200 capitalize">{tier.tier ?? '—'}</span>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>{tier.count} sent</span>
                          <span>{tier.viewed} viewed</span>
                          <Badge variant="outline" className={`text-[10px] ${tier.conversion >= 10 ? 'border-green-500/40 text-green-400 bg-green-500/10' : tier.conversion >= 5 ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-red-500/40 text-red-400 bg-red-500/10'}`}>
                            {tier.conversion}%
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Filter className="w-4 h-4" /> VA Context Quality
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!ctx ? (
                  <p className="text-xs text-slate-500 py-4 text-center">No context data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {(['none', 'short', 'rich'] as const).map((bucket) => {
                      const total = ctx.buckets[bucket] ?? 0;
                      const conv = ctx.conversions[bucket] ?? 0;
                      return (
                        <div key={bucket} className="flex items-center justify-between py-1.5 border-b border-slate-700/40 last:border-0">
                          <div>
                            <span className="text-sm font-medium text-slate-200 capitalize">{bucket}</span>
                            <span className="text-xs text-slate-500 ml-2">{bucket === 'none' ? 'No context' : bucket === 'short' ? '<100 chars' : '≥100 chars'}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-400">
                            <span>{total} quotes</span>
                            <Badge variant="outline" className={`text-[10px] ${pct(conv, total) >= 10 ? 'border-green-500/40 text-green-400 bg-green-500/10' : 'border-slate-500/40 text-slate-400'}`}>
                              {pct(conv, total)}% booked
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Headline performance */}
          <Card className="bg-slate-800/40 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" /> AI Headline Performance (top 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {headlines.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No headline data yet — quotes need to be generated with the new contextual engine.</p>
              ) : (
                <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-700/30 text-xs text-slate-400">
                        <th className="px-4 py-2 text-left">Headline</th>
                        <th className="px-4 py-2 text-right">Sent</th>
                        <th className="px-4 py-2 text-right">Viewed</th>
                        <th className="px-4 py-2 text-right">Booked</th>
                        <th className="px-4 py-2 text-right">Conv%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {headlines.map((h, i) => (
                        <tr key={i} className="hover:bg-slate-700/20">
                          <td className="px-4 py-2.5 text-slate-200 italic text-xs max-w-[200px] truncate">"{h.headline ?? '—'}"</td>
                          <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{h.total}</td>
                          <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{h.viewed}</td>
                          <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{h.booked}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Badge variant="outline" className={`text-[10px] ${h.conversion >= 10 ? 'border-green-500/40 text-green-400 bg-green-500/10' : h.conversion >= 5 ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-slate-500/40 text-slate-400'}`}>
                              {h.conversion}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Image performance */}
          <Card className="bg-slate-800/40 border-slate-700/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Image className="w-4 h-4 text-purple-400" /> Image Performance (by view/booking counts)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {images.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No image tracking data yet.</p>
              ) : (
                <div className="space-y-3">
                  {images.map((img) => (
                    <div key={img.id} className="flex items-center gap-3 py-2 border-b border-slate-700/40 last:border-0">
                      <div className="w-14 h-10 rounded overflow-hidden bg-slate-900 flex-shrink-0">
                        <img src={img.url} alt={img.alt ?? ''} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-300 truncate">{img.alt ?? 'No alt text'}</p>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {img.archetypes?.slice(0, 3).map((a) => <TagBadge key={a} value={a} color="blue" />)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                        <span>{img.view_count} views</span>
                        <span>{img.booking_count} bookings</span>
                        <Badge variant="outline" className={`text-[10px] ${img.conversion_rate >= 10 ? 'border-green-500/40 text-green-400 bg-green-500/10' : img.conversion_rate > 0 ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-slate-500/40 text-slate-400'}`}>
                          {img.conversion_rate}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function QuotePlatformPage() {
  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">
          Quote Platform
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage images, headlines, testimonials and analytics for contextual quotes
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="images" className="space-y-4">
        <TabsList className="bg-slate-800/60 border border-slate-700/50 h-auto flex-wrap gap-1 p-1">
          <TabsTrigger value="images" className="gap-1.5 text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <Image className="w-3.5 h-3.5" /> Image Library
          </TabsTrigger>
          <TabsTrigger value="headlines" className="gap-1.5 text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <Type className="w-3.5 h-3.5" /> Headline Variants
          </TabsTrigger>
          <TabsTrigger value="testimonials" className="gap-1.5 text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <MessageSquare className="w-3.5 h-3.5" /> Testimonials
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5 text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <BarChart3 className="w-3.5 h-3.5" /> Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="images" className="mt-0">
          <ImageLibraryTab />
        </TabsContent>

        <TabsContent value="headlines" className="mt-0">
          <HeadlineVariantsTab />
        </TabsContent>

        <TabsContent value="testimonials" className="mt-0">
          <TestimonialsTab />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
