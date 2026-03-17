import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  Shield,
  Zap,
  Camera,
  ClipboardList,
  Heart,
  Star,
  Sparkles,
  UserCheck,
  Lock,
  Plus,
  Edit2,
  Trash2,
  TrendingUp,
  TrendingDown,
  Image,
  MessageSquare,
  Award,
  BarChart3,
  Eye,
  ShoppingCart,
  ArrowRight,
  Upload,
  AlertTriangle,
  Library,
  Megaphone,
  ArrowLeftRight,
  BookOpen,
} from 'lucide-react';
import type {
  ContentClaim,
  ContentImage,
  ContentGuarantee,
  ContentTestimonial,
  ContentHassleItem,
  ContentBookingRule,
} from '@shared/schema';

const JOB_CATEGORIES = ['mounting', 'carpentry', 'plaster', 'painting', 'plumbing', 'electrical_minor'] as const;
const CLAIM_CATEGORIES = ['value', 'trust', 'convenience', 'quality', 'guarantee'] as const;
const CAT_CLR: Record<string, string> = { value: 'border-blue-500/40 text-blue-400 bg-blue-500/10', trust: 'border-green-500/40 text-green-400 bg-green-500/10', convenience: 'border-purple-500/40 text-purple-400 bg-purple-500/10', speed: 'border-amber-500/40 text-amber-400 bg-amber-500/10', guarantee: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10', quality: 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10' };
const IMG_PL = ['hero', 'guarantee', 'social_proof', 'gallery'] as const;
const TEST_SRC = ['google', 'manual', 'trustpilot'] as const;
type CTab = 'claims' | 'images' | 'guarantees' | 'testimonials' | 'hassle-items' | 'booking-rules';
const G_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { Shield, Zap, Camera, ClipboardList, Heart, Star, Sparkles, UserCheck, Lock };

interface CTS { total: number; active: number; totalViews: number; totalBookings: number; conversionRate: number; }
interface CS { claims: CTS; images: CTS; guarantees: CTS; testimonials: CTS; hassleItems: CTS; bookingRules: { total: number; active: number }; }

function auth(): Record<string, string> { const t = localStorage.getItem('adminToken'); return t ? { Authorization: `Bearer ${t}` } : {}; }
function cr(v: number, b: number) { return v > 0 ? Math.round((b / v) * 10000) / 100 : 0; }
function rc(r: number) { return r > 5 ? 'text-green-400' : r >= 2 ? 'text-amber-400' : 'text-red-400'; }
function rb(r: number) { return r > 5 ? 'border-green-500/40 text-green-400 bg-green-500/10' : r >= 2 ? 'border-amber-500/40 text-amber-400 bg-amber-500/10' : 'border-red-500/40 text-red-400 bg-red-500/10'; }
function pj(s: string): any { if (!s.trim()) return null; try { return JSON.parse(s); } catch { return null; } }

const cAnim = { hidden: { opacity: 0, y: 20 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.3, ease: 'easeOut' as const } }) };

function JCS({ selected, onChange }: { selected: string[]; onChange: (c: string[]) => void }) {
  return (<div className="flex flex-wrap gap-1.5">{JOB_CATEGORIES.map((c) => <Button key={c} type="button" variant={selected.includes(c) ? 'default' : 'outline'} size="sm" className="text-xs h-7" onClick={() => onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c])}>{c.replace('_', ' ')}</Button>)}</div>);
}

function Met({ u, v, b }: { u: number; v: number; b: number }) {
  const r = cr(v, b);
  return (<div className="flex items-center gap-4 text-xs text-slate-400"><span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" />{u}</span><span className="flex items-center gap-1"><Eye className="w-3 h-3" />{v}</span><span className="flex items-center gap-1"><ShoppingCart className="w-3 h-3" />{b}</span><Badge variant="outline" className={`text-[10px] px-1.5 py-0 ml-auto ${rb(r)}`}>{r.toFixed(1)}%</Badge></div>);
}

function CP({ c }: { c: string[] | null | undefined }) {
  if (!c?.length) return null;
  return (<div className="flex flex-wrap gap-1">{c.map((x) => <Badge key={x} variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/40 text-purple-400 bg-purple-500/10">{x.replace('_', ' ')}</Badge>)}</div>);
}

function ST({ s }: { s: any }) {
  if (!s || typeof s !== 'object' || !Object.keys(s).length) return null;
  return (<div className="flex flex-wrap gap-1">{Object.entries(s as Record<string, any>).map(([k, v]) => <Badge key={k} variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-500">{k}: {String(v)}</Badge>)}</div>);
}

function Ld() { return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>; }

function Emp({ t, onAdd }: { t: string; onAdd: () => void }) {
  return (<div className="text-center py-16 text-slate-500"><Library className="w-10 h-10 mx-auto mb-3 opacity-40" /><p className="text-sm">No {t.replace('-', ' ')} found.</p><Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={onAdd}><Plus className="w-4 h-4" />Add first</Button></div>);
}

export default function ContentLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<CTab>('claims');
  const [pvOpen, setPvOpen] = useState(false);
  const [dOpen, setDOpen] = useState(false);
  const [ed, setEd] = useState<any>(null);
  const [dType, setDType] = useState<CTab>('claims');
  const [fT, setFT] = useState(''); const [fC, setFC] = useState(''); const [fJ, setFJ] = useState<string[]>([]); const [fS, setFS] = useState('');
  const [fU, setFU] = useState(''); const [fA, setFA] = useState(''); const [fP, setFP] = useState('');
  const [fTi, setFTi] = useState(''); const [fDe, setFDe] = useState(''); const [fIt, setFIt] = useState(''); const [fBa, setFBa] = useState('');
  const [fAu, setFAu] = useState(''); const [fLo, setFLo] = useState(''); const [fRa, setFRa] = useState(5); const [fSr, setFSr] = useState('');
  const [fWo, setFWo] = useState(''); const [fWi, setFWi] = useState('');
  const [fNa, setFNa] = useState(''); const [fCo, setFCo] = useState(''); const [fMo, setFMo] = useState(''); const [fPr, setFPr] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fq = (p: string) => async () => { const r = await fetch(p, { headers: auth() }); if (!r.ok) throw new Error('Failed'); return r.json(); };
  const { data: stats } = useQuery<CS>({ queryKey: ['/api/content/stats'], queryFn: fq('/api/content/stats') });
  const { data: claims = [], isLoading: clL } = useQuery<ContentClaim[]>({ queryKey: ['/api/content/claims'], queryFn: fq('/api/content/claims') });
  const { data: images = [], isLoading: imL } = useQuery<ContentImage[]>({ queryKey: ['/api/content/images'], queryFn: fq('/api/content/images') });
  const { data: guarantees = [], isLoading: guL } = useQuery<ContentGuarantee[]>({ queryKey: ['/api/content/guarantees'], queryFn: fq('/api/content/guarantees') });
  const { data: testimonials = [], isLoading: teL } = useQuery<ContentTestimonial[]>({ queryKey: ['/api/content/testimonials'], queryFn: fq('/api/content/testimonials') });
  const { data: hassleItems = [], isLoading: haL } = useQuery<ContentHassleItem[]>({ queryKey: ['/api/content/hassle-items'], queryFn: fq('/api/content/hassle-items') });
  const { data: bookingRules = [], isLoading: brL } = useQuery<ContentBookingRule[]>({ queryKey: ['/api/content/booking-rules'], queryFn: fq('/api/content/booking-rules') });

  const inv = (t: string) => { qc.invalidateQueries({ queryKey: [`/api/content/${t}`] }); qc.invalidateQueries({ queryKey: ['/api/content/stats'] }); };
  const cM = useMutation({ mutationFn: async ({ type, body }: { type: CTab; body: any }) => { const r = await fetch(`/api/content/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) }); if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Failed' })); throw new Error(e.error || 'Failed'); } return r.json(); }, onSuccess: (_, v) => { toast({ title: 'Created' }); inv(v.type); setDOpen(false); }, onError: (e: Error) => { toast({ title: 'Error', description: e.message, variant: 'destructive' }); } });
  const uM = useMutation({ mutationFn: async ({ type, id, body }: { type: CTab; id: number; body: any }) => { const r = await fetch(`/api/content/${type}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body) }); if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Failed' })); throw new Error(e.error || 'Failed'); } return r.json(); }, onSuccess: (_, v) => { toast({ title: 'Updated' }); inv(v.type); setDOpen(false); }, onError: (e: Error) => { toast({ title: 'Error', description: e.message, variant: 'destructive' }); } });
  const dM = useMutation({ mutationFn: async ({ type, id }: { type: CTab; id: number }) => { const r = await fetch(`/api/content/${type}/${id}`, { method: 'DELETE', headers: auth() }); if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Failed' })); throw new Error(e.error || 'Failed'); } return r.json(); }, onSuccess: (_, v) => { toast({ title: 'Deactivated' }); inv(v.type); }, onError: (e: Error) => { toast({ title: 'Error', description: e.message, variant: 'destructive' }); } });
  const tM = useMutation({ mutationFn: async ({ type, id, isActive }: { type: CTab; id: number; isActive: boolean }) => { const r = await fetch(`/api/content/${type}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ isActive }) }); if (!r.ok) throw new Error('Failed'); return r.json(); }, onSuccess: (_, v) => inv(v.type) });

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch('/api/content/images/upload', { method: 'POST', headers: auth(), body: fd });
      if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Upload failed' })); throw new Error(e.error); }
      const data = await r.json();
      setFU(data.url);
      toast({ title: 'Uploaded to S3', description: data.url });
      return data.url as string;
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
      return null;
    } finally { setUploading(false); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith('image/')) return;
    uploadImage(file).then((url) => {
      if (url) cM.mutate({ type: 'images', body: { url, alt: file.name.replace(/\.[^.]+$/, ''), placement: null, jobCategories: null } });
    });
  }

  const allC = useMemo(() => [
    ...claims.map((c) => ({ id: c.id, label: c.text, rate: cr(c.viewCount, c.bookingCount), views: c.viewCount, usage: c.usageCount, type: 'Claim' as const, tab: 'claims' as CTab })),
    ...testimonials.map((t) => ({ id: t.id, label: t.text, rate: cr(t.viewCount, t.bookingCount), views: t.viewCount, usage: t.usageCount, type: 'Testimonial' as const, tab: 'testimonials' as CTab })),
    ...guarantees.map((g) => ({ id: g.id, label: g.title, rate: cr(g.viewCount, g.bookingCount), views: g.viewCount, usage: g.usageCount, type: 'Guarantee' as const, tab: 'guarantees' as CTab })),
    ...hassleItems.map((h) => ({ id: h.id, label: `${h.withoutUs} -> ${h.withUs}`, rate: cr(h.viewCount, h.bookingCount), views: h.viewCount, usage: h.usageCount, type: 'Hassle' as const, tab: 'hassle-items' as CTab })),
  ], [claims, testimonials, guarantees, hassleItems]);

  const topP = useMemo(() => [...allC].filter((c) => c.views > 0 && c.rate > 0).sort((a, b) => b.rate - a.rate).slice(0, 4), [allC]);
  const lowP = useMemo(() => [...allC].filter((c) => c.views >= 10 && c.rate < 2).sort((a, b) => a.rate - b.rate).slice(0, 4), [allC]);
  const hl = useMemo(() => ({ active: allC.filter((c) => c.usage > 0).length, unused: allC.filter((c) => c.usage === 0).length, under: allC.filter((c) => c.views >= 10 && c.rate < 2).length }), [allC]);

  function rst() { setFT(''); setFC(''); setFJ([]); setFS(''); setFU(''); setFA(''); setFP(''); setFTi(''); setFDe(''); setFIt(''); setFBa(''); setFAu(''); setFLo(''); setFRa(5); setFSr(''); setFWo(''); setFWi(''); setFNa(''); setFCo(''); setFMo(''); setFPr(0); setEd(null); }
  function oA(t: CTab) { rst(); setDType(t); setDOpen(true); }
  function oE(t: CTab, item: any) {
    rst(); setDType(t); setEd(item); setFJ(item.jobCategories || []); setFS(item.signals ? JSON.stringify(item.signals, null, 2) : '');
    if (t === 'claims') { setFT(item.text || ''); setFC(item.category || ''); }
    if (t === 'images') { setFU(item.url || ''); setFA(item.alt || ''); setFP(item.placement || ''); }
    if (t === 'guarantees') { setFTi(item.title || ''); setFDe(item.description || ''); setFIt(item.items ? JSON.stringify(item.items, null, 2) : ''); setFBa(item.badges ? JSON.stringify(item.badges, null, 2) : ''); }
    if (t === 'testimonials') { setFT(item.text || ''); setFAu(item.author || ''); setFLo(item.location || ''); setFRa(item.rating ?? 5); setFSr(item.source || ''); }
    if (t === 'hassle-items') { setFWo(item.withoutUs || ''); setFWi(item.withUs || ''); }
    if (t === 'booking-rules') { setFNa(item.name || ''); setFCo(item.conditions ? JSON.stringify(item.conditions, null, 2) : ''); setFMo(Array.isArray(item.bookingModes) ? item.bookingModes.join(', ') : ''); setFPr(item.priority ?? 0); }
    setDOpen(true);
  }
  function sub() {
    const sg = pj(fS); const jc = fJ.length ? fJ : null; let body: any = {};
    if (dType === 'claims') body = { text: fT, category: fC || null, jobCategories: jc, signals: sg };
    if (dType === 'images') body = { url: fU, alt: fA || null, placement: fP || null, jobCategories: jc };
    if (dType === 'guarantees') body = { title: fTi, description: fDe || null, items: pj(fIt), badges: pj(fBa), jobCategories: jc, signals: sg };
    if (dType === 'testimonials') body = { text: fT, author: fAu, location: fLo || null, rating: fRa, jobCategories: jc, source: fSr || null };
    if (dType === 'hassle-items') body = { withoutUs: fWo, withUs: fWi, jobCategories: jc, signals: sg };
    if (dType === 'booking-rules') body = { name: fNa, conditions: pj(fCo), bookingModes: fMo.split(',').map((s) => s.trim()).filter(Boolean), priority: fPr };
    ed ? uM.mutate({ type: dType, id: ed.id, body }) : cM.mutate({ type: dType, body });
  }
  const busy = cM.isPending || uM.isPending;

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5"><Library className="w-6 h-6 text-amber-400" /><h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Content Library</h1></div>
          <p className="text-slate-400 text-sm mt-1">Conversion optimization platform -- track, test, and improve every piece of content</p>
        </div>
        <Button variant="outline" onClick={() => setPvOpen(true)} className="gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"><Eye className="w-4 h-4" />Preview Quote</Button>
      </div>

      {/* SECTION 1: Dashboard */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
          <BarChart3 className="w-4 h-4 text-amber-400 shrink-0" /><span className="text-sm text-slate-300">Content Health:</span>
          <span className="text-sm text-green-400">{hl.active} active</span><span className="text-slate-600">|</span>
          <span className="text-sm text-slate-400">{hl.unused} unused</span><span className="text-slate-600">|</span>
          <span className={`text-sm ${hl.under > 0 ? 'text-red-400' : 'text-slate-400'}`}>{hl.under} underperforming (&lt;2%)</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-green-400" /><h2 className="text-sm font-semibold text-white">Top Performers</h2></div>
            {!topP.length ? <Card className="bg-slate-900 border-slate-800"><CardContent className="py-8 text-center text-slate-500 text-sm">No conversion data yet</CardContent></Card> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{topP.map((it, i) => (
                <motion.div key={`t-${it.type}-${it.id}`} custom={i} initial="hidden" animate="visible" variants={cAnim}>
                  <Card className="bg-slate-900 border-slate-800 hover:border-green-500/30 transition-colors"><CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm text-slate-200 line-clamp-2 flex-1">{it.label}</p><span className="text-xl font-bold text-green-400 shrink-0">{it.rate.toFixed(1)}%</span></div>
                    <div className="flex items-center justify-between"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">{it.type}</Badge><span className="text-[11px] text-slate-500">{it.usage} uses</span></div>
                  </CardContent></Card>
                </motion.div>
              ))}</div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3"><TrendingDown className="w-4 h-4 text-red-400" /><h2 className="text-sm font-semibold text-white">Underperformers</h2><span className="text-[11px] text-slate-500">(10+ views, &lt;2%)</span></div>
            {!lowP.length ? <Card className="bg-slate-900 border-slate-800"><CardContent className="py-8 text-center text-slate-500 text-sm">No underperforming content</CardContent></Card> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{lowP.map((it, i) => (
                <motion.div key={`l-${it.type}-${it.id}`} custom={i} initial="hidden" animate="visible" variants={cAnim}>
                  <Card className="bg-slate-900 border-slate-800 hover:border-red-500/30 transition-colors"><CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm text-slate-200 line-clamp-2 flex-1">{it.label}</p><span className="text-xl font-bold text-red-400 shrink-0">{it.rate.toFixed(1)}%</span></div>
                    <div className="flex items-center justify-between"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">{it.type}</Badge>
                    <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => { setTab(it.tab); toast({ title: 'Navigate to swap' }); }}><ArrowLeftRight className="w-3 h-3" />Swap</Button></div>
                  </CardContent></Card>
                </motion.div>
              ))}</div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as CTab)}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="claims" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><Megaphone className="w-3.5 h-3.5" />Claims{stats && <span className="text-slate-500 ml-1">({stats.claims.total})</span>}</TabsTrigger>
            <TabsTrigger value="images" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><Image className="w-3.5 h-3.5" />Images{stats && <span className="text-slate-500 ml-1">({stats.images.total})</span>}</TabsTrigger>
            <TabsTrigger value="guarantees" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><Shield className="w-3.5 h-3.5" />Guarantees{stats && <span className="text-slate-500 ml-1">({stats.guarantees.total})</span>}</TabsTrigger>
            <TabsTrigger value="testimonials" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><MessageSquare className="w-3.5 h-3.5" />Testimonials{stats && <span className="text-slate-500 ml-1">({stats.testimonials.total})</span>}</TabsTrigger>
            <TabsTrigger value="hassle-items" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><ArrowLeftRight className="w-3.5 h-3.5" />Hassle{stats && <span className="text-slate-500 ml-1">({stats.hassleItems.total})</span>}</TabsTrigger>
            <TabsTrigger value="booking-rules" className="gap-1.5 text-xs data-[state=active]:bg-slate-800"><BookOpen className="w-3.5 h-3.5" />Rules{stats && <span className="text-slate-500 ml-1">({stats.bookingRules.total})</span>}</TabsTrigger>
          </TabsList>
          <Button onClick={() => oA(tab)} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" size="sm"><Plus className="w-4 h-4" />Add New</Button>
        </div>

        <TabsContent value="claims">
          {clL ? <Ld /> : !claims.length ? <Emp t="claims" onAdd={() => oA('claims')} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"><AnimatePresence>{claims.map((c, i) => (
              <motion.div key={c.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                <Card className={`bg-slate-900 border-slate-800 hover:border-slate-700 transition-all ${!c.isActive ? 'opacity-40' : ''}`}><CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-100 leading-snug flex-1">"{c.text}"</p><Switch checked={c.isActive} onCheckedChange={(v) => tM.mutate({ type: 'claims', id: c.id, isActive: v })} className="data-[state=checked]:bg-green-600" /></div>
                  <div className="flex flex-wrap gap-1.5">{c.category && <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CAT_CLR[c.category] || 'border-slate-600 text-slate-400'}`}>{c.category}</Badge>}<CP c={c.jobCategories} /></div>
                  <ST s={c.signals} /><Met u={c.usageCount} v={c.viewCount} b={c.bookingCount} />
                  <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1 text-xs h-8 gap-1.5 border-slate-700" onClick={() => oE('claims', c)}><Edit2 className="w-3.5 h-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-8 text-red-400 border-red-500/30 hover:bg-red-500/5" onClick={() => dM.mutate({ type: 'claims', id: c.id })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                </CardContent></Card>
              </motion.div>
            ))}</AnimatePresence></div>
          )}
        </TabsContent>

        <TabsContent value="images">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { uploadImage(f).then((url) => { if (url) cM.mutate({ type: 'images', body: { url, alt: f.name.replace(/\.[^.]+$/, ''), placement: null, jobCategories: null } }); }); } e.target.value = ''; }} />
          <div
            className={`border-2 border-dashed rounded-lg p-8 mb-6 text-center transition-colors cursor-pointer ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-slate-700 hover:border-amber-500/40'}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {uploading ? (<><Loader2 className="w-8 h-8 text-amber-400 mx-auto mb-2 animate-spin" /><p className="text-sm text-amber-400">Uploading to S3...</p></>) : (<><Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" /><p className="text-sm text-slate-400">Drag & drop images or <span className="text-amber-400 underline">click to browse</span></p><p className="text-xs text-slate-600 mt-1">JPG, PNG, WebP, SVG (max 5MB) -- uploads to Amazon S3</p></>)}
          </div>
          {imL ? <Ld /> : !images.length ? <Emp t="images" onAdd={() => oA('images')} /> : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4"><AnimatePresence>{images.map((img, i) => (
              <motion.div key={img.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                <Card className={`bg-slate-900 border-slate-800 hover:border-slate-700 group ${!img.isActive ? 'opacity-40' : ''}`}><CardContent className="p-0">
                  <div className="relative aspect-video bg-slate-800 rounded-t-lg overflow-hidden">
                    <img src={img.url} alt={img.alt || ''} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><div className="text-center"><div className="flex items-center gap-3 text-xs text-slate-300"><span><Eye className="w-3 h-3 inline" /> {img.viewCount}</span><span><ShoppingCart className="w-3 h-3 inline" /> {img.bookingCount}</span></div><p className={`text-lg font-bold ${rc(cr(img.viewCount, img.bookingCount))}`}>{cr(img.viewCount, img.bookingCount).toFixed(1)}%</p></div></div>
                    {img.placement && <Badge className="absolute top-2 left-2 text-[10px] px-1.5 py-0 bg-slate-900/80 text-green-400 border-green-500/40">{img.placement.replace('_', ' ')}</Badge>}
                    <div className="absolute top-2 right-2"><Switch checked={img.isActive} onCheckedChange={(v) => tM.mutate({ type: 'images', id: img.id, isActive: v })} className="data-[state=checked]:bg-green-600 scale-75" /></div>
                  </div>
                  <div className="p-3 space-y-2">{img.alt && <p className="text-xs text-slate-400 truncate">{img.alt}</p>}<CP c={img.jobCategories} /><div className="flex gap-2"><Button variant="outline" size="sm" className="flex-1 text-xs h-7 gap-1 border-slate-700" onClick={() => oE('images', img)}><Edit2 className="w-3 h-3" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-7 text-red-400 border-red-500/30" onClick={() => dM.mutate({ type: 'images', id: img.id })}><Trash2 className="w-3 h-3" /></Button></div></div>
                </CardContent></Card>
              </motion.div>
            ))}</AnimatePresence></div>
          )}
        </TabsContent>

        <TabsContent value="guarantees">
          {guL ? <Ld /> : !guarantees.length ? <Emp t="guarantees" onAdd={() => oA('guarantees')} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5"><AnimatePresence>{guarantees.map((g, i) => {
              const its = Array.isArray(g.items) ? (g.items as any[]) : []; const bds = Array.isArray(g.badges) ? (g.badges as any[]) : [];
              return (
                <motion.div key={g.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                  <Card className={`bg-slate-900 border-slate-800 hover:border-emerald-500/20 transition-all ${!g.isActive ? 'opacity-40' : ''}`}><CardContent className="pt-5 pb-4 space-y-4">
                    <div className="flex items-start justify-between gap-3"><div className="flex-1"><h3 className="text-lg font-bold text-white">{g.title}</h3>{g.description && <p className="text-sm text-slate-400 mt-1">{g.description}</p>}</div><Switch checked={g.isActive} onCheckedChange={(v) => tM.mutate({ type: 'guarantees', id: g.id, isActive: v })} className="data-[state=checked]:bg-green-600" /></div>
                    {its.length > 0 && <div className="space-y-2 bg-slate-950/50 rounded-lg p-3 border border-slate-800">{its.map((it: any, idx: number) => { const Ic = G_ICONS[it.icon] || Shield; return (<div key={idx} className="flex items-start gap-3"><div className="mt-0.5 p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20"><Ic className="w-4 h-4 text-emerald-400" /></div><div><p className="text-sm font-medium text-slate-200">{it.title}</p><p className="text-xs text-slate-400">{it.text}</p></div></div>); })}</div>}
                    {bds.length > 0 && <div className="flex flex-wrap gap-1.5">{bds.map((b: any, idx: number) => <Badge key={idx} variant="outline" className="text-[10px] px-2 py-0.5 border-amber-500/40 text-amber-400 bg-amber-500/10">{b.label}{b.value ? `: ${b.value}` : ''}</Badge>)}</div>}
                    <CP c={g.jobCategories} /><ST s={g.signals} /><Met u={g.usageCount} v={g.viewCount} b={g.bookingCount} />
                    <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1 text-xs h-8 gap-1.5 border-slate-700" onClick={() => oE('guarantees', g)}><Edit2 className="w-3.5 h-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-8 text-red-400 border-red-500/30" onClick={() => dM.mutate({ type: 'guarantees', id: g.id })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                  </CardContent></Card>
                </motion.div>
              );
            })}</AnimatePresence></div>
          )}
        </TabsContent>

        <TabsContent value="testimonials">
          {teL ? <Ld /> : !testimonials.length ? <Emp t="testimonials" onAdd={() => oA('testimonials')} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"><AnimatePresence>{testimonials.map((t, i) => (
              <motion.div key={t.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                <Card className={`bg-slate-900 border-slate-800 hover:border-amber-500/20 transition-all ${!t.isActive ? 'opacity-40' : ''}`}><CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-center justify-between"><div className="flex gap-0.5">{Array.from({ length: 5 }).map((_, idx) => <Star key={idx} className={`w-4 h-4 ${idx < t.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-700'}`} />)}</div><Switch checked={t.isActive} onCheckedChange={(v) => tM.mutate({ type: 'testimonials', id: t.id, isActive: v })} className="data-[state=checked]:bg-green-600" /></div>
                  <p className="text-sm italic text-slate-200 leading-relaxed">"{t.text}"</p>
                  <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-400">{t.author?.charAt(0)?.toUpperCase() || '?'}</div><div><p className="text-sm font-medium text-slate-200">{t.author}</p>{t.location && <p className="text-xs text-slate-500">{t.location}</p>}</div>{t.source && <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-green-500/40 text-green-400 bg-green-500/10">{t.source}</Badge>}</div>
                  <CP c={t.jobCategories} /><Met u={t.usageCount} v={t.viewCount} b={t.bookingCount} />
                  <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1 text-xs h-8 gap-1.5 border-slate-700" onClick={() => oE('testimonials', t)}><Edit2 className="w-3.5 h-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-8 text-red-400 border-red-500/30" onClick={() => dM.mutate({ type: 'testimonials', id: t.id })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                </CardContent></Card>
              </motion.div>
            ))}</AnimatePresence></div>
          )}
        </TabsContent>

        <TabsContent value="hassle-items">
          {haL ? <Ld /> : !hassleItems.length ? <Emp t="hassle-items" onAdd={() => oA('hassle-items')} /> : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><AnimatePresence>{hassleItems.map((h, i) => (
              <motion.div key={h.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                <Card className={`bg-slate-900 border-slate-800 hover:border-slate-700 transition-all ${!h.isActive ? 'opacity-40' : ''}`}><CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 flex items-stretch gap-3">
                      <div className="flex-1 bg-red-500/5 border border-red-500/20 rounded-lg p-3"><p className="text-[10px] uppercase text-red-400 font-bold mb-1.5 tracking-wider">Without Us</p><p className="text-sm text-red-200 leading-snug">{h.withoutUs}</p></div>
                      <div className="flex items-center"><div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center"><ArrowRight className="w-4 h-4 text-green-400" /></div></div>
                      <div className="flex-1 bg-green-500/5 border border-green-500/20 rounded-lg p-3"><p className="text-[10px] uppercase text-green-400 font-bold mb-1.5 tracking-wider">With Us</p><p className="text-sm text-green-200 leading-snug">{h.withUs}</p></div>
                    </div>
                    <Switch checked={h.isActive} onCheckedChange={(v) => tM.mutate({ type: 'hassle-items', id: h.id, isActive: v })} className="data-[state=checked]:bg-green-600 shrink-0" />
                  </div>
                  <CP c={h.jobCategories} /><ST s={h.signals} /><Met u={h.usageCount} v={h.viewCount} b={h.bookingCount} />
                  <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1 text-xs h-8 gap-1.5 border-slate-700" onClick={() => oE('hassle-items', h)}><Edit2 className="w-3.5 h-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-8 text-red-400 border-red-500/30" onClick={() => dM.mutate({ type: 'hassle-items', id: h.id })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                </CardContent></Card>
              </motion.div>
            ))}</AnimatePresence></div>
          )}
        </TabsContent>

        <TabsContent value="booking-rules">
          {brL ? <Ld /> : !bookingRules.length ? <Emp t="booking-rules" onAdd={() => oA('booking-rules')} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"><AnimatePresence>{bookingRules.map((rule, i) => {
              const cn = rule.conditions as Record<string, any> | null;
              return (
                <motion.div key={rule.id} custom={i} initial="hidden" animate="visible" variants={cAnim} layout>
                  <Card className={`bg-slate-900 border-slate-800 hover:border-slate-700 transition-all ${!rule.isActive ? 'opacity-40' : ''}`}><CardContent className="pt-5 pb-4 space-y-4">
                    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{rule.name}</h3><Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">Priority: {rule.priority}</Badge></div><Switch checked={rule.isActive} onCheckedChange={(v) => tM.mutate({ type: 'booking-rules', id: rule.id, isActive: v })} className="data-[state=checked]:bg-green-600" /></div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">{cn && Object.keys(cn).length > 0 ? <div className="flex flex-wrap gap-1">{Object.entries(cn).map(([k, v]) => <Badge key={k} variant="outline" className="text-[10px] px-1.5 py-0 border-cyan-500/40 text-cyan-400 bg-cyan-500/10">{k}: {String(v)}</Badge>)}</div> : <span className="text-xs text-slate-600">No conditions</span>}</div>
                      <ArrowRight className="w-4 h-4 text-slate-600 shrink-0" />
                      <div className="flex-1"><div className="flex flex-wrap gap-1">{rule.bookingModes.map((m) => <Badge key={m} variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400 bg-amber-500/10">{m.replace('_', ' ')}</Badge>)}</div></div>
                    </div>
                    <div className="flex gap-2 pt-1"><Button variant="outline" size="sm" className="flex-1 text-xs h-8 gap-1.5 border-slate-700" onClick={() => oE('booking-rules', rule)}><Edit2 className="w-3.5 h-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-xs h-8 text-red-400 border-red-500/30" onClick={() => dM.mutate({ type: 'booking-rules', id: rule.id })}><Trash2 className="w-3.5 h-3.5" /></Button></div>
                  </CardContent></Card>
                </motion.div>
              );
            })}</AnimatePresence></div>
          )}
        </TabsContent>
      </Tabs>

      {/* SECTION 3: Preview Modal */}
      <Dialog open={pvOpen} onOpenChange={setPvOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800">
          <DialogHeader><DialogTitle className="text-white flex items-center gap-2"><Eye className="w-5 h-5 text-amber-400" />Live Quote Preview</DialogTitle></DialogHeader>
          <div className="space-y-6 py-4">
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-6 border border-slate-700">
              <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-2">V6 Handyman</p>
              <h2 className="text-2xl font-bold text-white mb-1">Your Home. Sorted.</h2>
              <p className="text-sm text-slate-400">Professional handyman service in Nottingham</p>
              <div className="mt-4 flex gap-2"><Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">2M Insured</Badge><Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">4.9 Google</Badge><Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">127 Reviews</Badge></div>
            </div>
            <div className="bg-slate-900 rounded-xl p-5 border border-slate-800">
              <h3 className="text-sm font-semibold text-white mb-3">Why Choose Us</h3>
              <div className="space-y-2">{claims.filter((c) => c.isActive).slice(0, 4).map((c) => <div key={c.id} className="flex items-start gap-2"><Sparkles className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" /><p className="text-sm text-slate-300">{c.text}</p></div>)}{!claims.filter((c) => c.isActive).length && <p className="text-sm text-slate-500 italic">No active claims</p>}</div>
            </div>
            {guarantees.filter((g) => g.isActive).length > 0 && (() => { const g = guarantees.filter((x) => x.isActive)[0]; const gi = Array.isArray(g.items) ? (g.items as any[]) : []; return (
              <div className="bg-slate-900 rounded-xl p-5 border border-emerald-500/20"><h3 className="text-base font-bold text-white mb-1">{g.title}</h3>{g.description && <p className="text-sm text-slate-400 mb-3">{g.description}</p>}<div className="space-y-2">{gi.map((it: any, idx: number) => { const Ic = G_ICONS[it.icon] || Shield; return <div key={idx} className="flex items-start gap-2.5"><Ic className="w-4 h-4 text-emerald-400 mt-0.5" /><div><span className="text-sm font-medium text-slate-200">{it.title}</span> <span className="text-sm text-slate-400">{it.text}</span></div></div>; })}</div></div>
            ); })()}
            {testimonials.filter((t) => t.isActive).length > 0 && (() => { const t = testimonials.filter((x) => x.isActive)[0]; return (
              <div className="bg-slate-900 rounded-xl p-5 border border-slate-800"><div className="flex gap-0.5 mb-2">{Array.from({ length: 5 }).map((_, idx) => <Star key={idx} className={`w-4 h-4 ${idx < t.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-700'}`} />)}</div><p className="text-sm italic text-slate-300 mb-2">"{t.text}"</p><p className="text-xs text-slate-500">-- {t.author}{t.location ? `, ${t.location}` : ''}</p></div>
            ); })()}
            {hassleItems.filter((h) => h.isActive).length > 0 && (
              <div className="bg-slate-900 rounded-xl p-5 border border-slate-800"><h3 className="text-sm font-semibold text-white mb-3">The Easy Way vs The Hard Way</h3><div className="space-y-3">{hassleItems.filter((h) => h.isActive).slice(0, 3).map((h) => <div key={h.id} className="flex items-center gap-3"><div className="flex-1 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2"><p className="text-xs text-red-300">{h.withoutUs}</p></div><ArrowRight className="w-4 h-4 text-green-400 shrink-0" /><div className="flex-1 bg-green-500/5 border border-green-500/20 rounded-md px-3 py-2"><p className="text-xs text-green-300">{h.withUs}</p></div></div>)}</div></div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={dOpen} onOpenChange={setDOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-slate-950 border-slate-800">
          <DialogHeader><DialogTitle className="text-white">{ed ? 'Edit' : 'Add'} {dType.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {dType === 'claims' && (<>
              <div><Label className="text-xs text-slate-400">Claim Text *</Label><Textarea value={fT} onChange={(e) => setFT(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" rows={2} placeholder="e.g. Same-day response" /></div>
              <div><Label className="text-xs text-slate-400">Category</Label><div className="flex flex-wrap gap-1.5 mt-1">{CLAIM_CATEGORIES.map((c) => <Button key={c} type="button" variant={fC === c ? 'default' : 'outline'} size="sm" className="text-xs h-7" onClick={() => setFC(fC === c ? '' : c)}>{c}</Button>)}</div></div>
              <div><Label className="text-xs text-slate-400">Job Categories</Label><div className="mt-1"><JCS selected={fJ} onChange={setFJ} /></div></div>
              <div><Label className="text-xs text-slate-400">Signals (JSON)</Label><Textarea value={fS} onChange={(e) => setFS(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={3} /></div>
            </>)}
            {dType === 'images' && (<>
              <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-slate-700 hover:border-amber-500/40'}`}
                onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) uploadImage(f); }; inp.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) uploadImage(f); }}
              >
                {uploading ? (<div className="py-2"><Loader2 className="w-6 h-6 animate-spin text-amber-400 mx-auto" /><p className="text-xs text-amber-400 mt-1">Uploading...</p></div>)
                : fU ? (<div className="space-y-2"><img src={fU} alt="Preview" className="max-h-32 mx-auto rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /><p className="text-xs text-slate-500 truncate">{fU}</p><p className="text-[10px] text-slate-600">Drop new image to replace</p></div>)
                : (<div className="py-4"><Upload className="w-6 h-6 text-slate-500 mx-auto mb-1" /><p className="text-xs text-slate-400">Drop image or <span className="text-amber-400 underline">browse</span></p><p className="text-[10px] text-slate-600">Uploads to S3</p></div>)}
              </div>
              <div><Label className="text-xs text-slate-400">Image URL (or paste S3 URL)</Label><Input value={fU} onChange={(e) => setFU(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div>
              <div><Label className="text-xs text-slate-400">Alt Text</Label><Input value={fA} onChange={(e) => setFA(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div>
              <div><Label className="text-xs text-slate-400">Placement</Label><div className="flex flex-wrap gap-1.5 mt-1">{IMG_PL.map((p) => <Button key={p} type="button" variant={fP === p ? 'default' : 'outline'} size="sm" className="text-xs h-7" onClick={() => setFP(fP === p ? '' : p)}>{p.replace('_', ' ')}</Button>)}</div></div>
              <div><Label className="text-xs text-slate-400">Job Categories</Label><div className="mt-1"><JCS selected={fJ} onChange={setFJ} /></div></div>
            </>)}
            {dType === 'guarantees' && (<>
              <div><Label className="text-xs text-slate-400">Title *</Label><Input value={fTi} onChange={(e) => setFTi(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div>
              <div><Label className="text-xs text-slate-400">Description</Label><Textarea value={fDe} onChange={(e) => setFDe(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" rows={2} /></div>
              <div><Label className="text-xs text-slate-400">Items (JSON array)</Label><Textarea value={fIt} onChange={(e) => setFIt(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={4} placeholder='[{"icon":"Shield","title":"...","text":"..."}]' />
                {fIt && pj(fIt) && Array.isArray(pj(fIt)) && <div className="mt-2 bg-slate-900 rounded-lg p-3 border border-slate-800 space-y-2"><p className="text-[10px] uppercase text-slate-500 font-semibold">Preview</p>{(pj(fIt) as any[]).map((it: any, idx: number) => { const Ic = G_ICONS[it.icon] || Shield; return <div key={idx} className="flex items-start gap-2"><Ic className="w-4 h-4 text-emerald-400 mt-0.5" /><div><span className="text-xs font-medium text-slate-200">{it.title}</span> <span className="text-xs text-slate-400">{it.text}</span></div></div>; })}</div>}
              </div>
              <div><Label className="text-xs text-slate-400">Badges (JSON)</Label><Textarea value={fBa} onChange={(e) => setFBa(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={3} /></div>
              <div><Label className="text-xs text-slate-400">Job Categories</Label><div className="mt-1"><JCS selected={fJ} onChange={setFJ} /></div></div>
              <div><Label className="text-xs text-slate-400">Signals (JSON)</Label><Textarea value={fS} onChange={(e) => setFS(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={3} /></div>
            </>)}
            {dType === 'testimonials' && (<>
              <div><Label className="text-xs text-slate-400">Quote Text *</Label><Textarea value={fT} onChange={(e) => setFT(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" rows={3} /></div>
              <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs text-slate-400">Author *</Label><Input value={fAu} onChange={(e) => setFAu(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div><div><Label className="text-xs text-slate-400">Location</Label><Input value={fLo} onChange={(e) => setFLo(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label className="text-xs text-slate-400">Rating</Label><div className="flex gap-1 mt-1">{[1,2,3,4,5].map((r) => <button key={r} type="button" onClick={() => setFRa(r)} className="focus:outline-none"><Star className={`w-5 h-5 ${r <= fRa ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} /></button>)}</div></div><div><Label className="text-xs text-slate-400">Source</Label><div className="flex flex-wrap gap-1.5 mt-1">{TEST_SRC.map((s) => <Button key={s} type="button" variant={fSr === s ? 'default' : 'outline'} size="sm" className="text-xs h-7" onClick={() => setFSr(fSr === s ? '' : s)}>{s}</Button>)}</div></div></div>
              <div><Label className="text-xs text-slate-400">Job Categories</Label><div className="mt-1"><JCS selected={fJ} onChange={setFJ} /></div></div>
            </>)}
            {dType === 'hassle-items' && (<>
              <div><Label className="text-xs text-slate-400">Without Us *</Label><Textarea value={fWo} onChange={(e) => setFWo(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" rows={2} /></div>
              <div><Label className="text-xs text-slate-400">With Us *</Label><Textarea value={fWi} onChange={(e) => setFWi(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" rows={2} /></div>
              {(fWo || fWi) && <div className="flex items-center gap-3 bg-slate-900 rounded-lg p-3 border border-slate-800"><div className="flex-1 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2"><p className="text-[10px] uppercase text-red-400 font-bold mb-1">Without Us</p><p className="text-xs text-red-200">{fWo || '...'}</p></div><ArrowRight className="w-4 h-4 text-green-400 shrink-0" /><div className="flex-1 bg-green-500/5 border border-green-500/20 rounded-md px-3 py-2"><p className="text-[10px] uppercase text-green-400 font-bold mb-1">With Us</p><p className="text-xs text-green-200">{fWi || '...'}</p></div></div>}
              <div><Label className="text-xs text-slate-400">Job Categories</Label><div className="mt-1"><JCS selected={fJ} onChange={setFJ} /></div></div>
              <div><Label className="text-xs text-slate-400">Signals (JSON)</Label><Textarea value={fS} onChange={(e) => setFS(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={3} /></div>
            </>)}
            {dType === 'booking-rules' && (<>
              <div><Label className="text-xs text-slate-400">Rule Name *</Label><Input value={fNa} onChange={(e) => setFNa(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div>
              <div><Label className="text-xs text-slate-400">Conditions (JSON) *</Label><Textarea value={fCo} onChange={(e) => setFCo(e.target.value)} className="mt-1 font-mono text-xs bg-slate-900 border-slate-700" rows={4} /></div>
              <div><Label className="text-xs text-slate-400">Booking Modes (comma-separated) *</Label><Input value={fMo} onChange={(e) => setFMo(e.target.value)} className="mt-1 bg-slate-900 border-slate-700" /></div>
              <div><Label className="text-xs text-slate-400">Priority</Label><Input type="number" value={fPr} onChange={(e) => setFPr(parseInt(e.target.value) || 0)} className="mt-1 w-24 bg-slate-900 border-slate-700" /></div>
            </>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDOpen(false)} disabled={busy} className="border-slate-700">Cancel</Button>
            <Button onClick={sub} disabled={busy} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{ed ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
