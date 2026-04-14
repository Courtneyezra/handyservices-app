import { useState, useMemo, useCallback, useRef } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  User,
  Briefcase,
  MapPin,
  Calendar,
  Wrench,
  Camera,
  DollarSign,
  ClipboardList,
  Save,
  Loader2,
  Upload,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  ExternalLink,
} from 'lucide-react';
import { CATEGORY_LABELS } from '@shared/categories';
import { useToast } from '@/hooks/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContractorDetail {
  id: string;
  userId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  bio: string | null;
  businessName: string | null;
  postcode: string | null;
  city: string | null;
  radiusMiles: number;
  hourlyRate: number | null;
  profileImageUrl: string | null;
  heroImageUrl: string | null;
  availabilityStatus: string;
  publicProfileEnabled: boolean;
  slug: string;
  createdAt: string;
  skills: Array<{
    id: string;
    categorySlug: string | null;
    hourlyRate: number | null;
    dayRate: number | null;
    proficiency: string | null;
    service?: { id: string; name: string } | null;
  }>;
  recentJobs: Array<{
    id: string;
    contractorId: string;
    quoteId: string | null;
    customerName: string | null;
    jobDescription: string | null;
    status: string;
    totalPence: number | null;
    payoutPence: number | null;
    scheduledDate: string | null;
    completedAt: string | null;
    createdAt: string;
  }>;
  weeklyPatterns: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>;
  dateOverrides: Array<{
    id: string;
    contractorId: string;
    date: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
  }>;
}

// All job categories
const ALL_CATEGORIES = [
  'general_fixing', 'flat_pack', 'tv_mounting', 'carpentry',
  'plumbing_minor', 'electrical_minor', 'painting', 'tiling',
  'plastering', 'lock_change', 'guttering', 'pressure_washing',
  'fencing', 'garden_maintenance', 'bathroom_fitting', 'kitchen_fitting',
  'door_fitting', 'flooring', 'curtain_blinds', 'silicone_sealant',
  'shelving', 'furniture_repair', 'waste_removal', 'other',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminToken(): string {
  return localStorage.getItem('adminToken') || '';
}

function getCategoryLabel(slug: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[slug] || slug;
}

function formatPence(pence: number): string {
  return `\u00A3${(pence / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  switch (status) {
    case 'available':
      return <Badge className="bg-green-600 text-white">Available</Badge>;
    case 'busy':
      return <Badge className="bg-amber-600 text-white">Busy</Badge>;
    default:
      return <Badge variant="secondary">Inactive</Badge>;
  }
}

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Profile Header
// ---------------------------------------------------------------------------

function ProfileHeader({ contractor }: { contractor: ContractorDetail }) {
  const [, setLocation] = useLocation();
  const memberSince = new Date(contractor.createdAt).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  });

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible">
      <Card className="bg-card border border-border rounded-xl">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Back Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setLocation('/admin/contractors')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>

            {/* Profile Photo */}
            <div className="shrink-0">
              {contractor.profileImageUrl ? (
                <img
                  src={contractor.profileImageUrl}
                  alt={`${contractor.user.firstName} ${contractor.user.lastName}`}
                  className="w-[120px] h-[120px] rounded-full object-cover border-4 border-green-500"
                />
              ) : (
                <div className="w-[120px] h-[120px] rounded-full bg-muted flex items-center justify-center border-4 border-border">
                  <User className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Name & Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">
                  {contractor.user.firstName} {contractor.user.lastName}
                </h1>
                {statusBadge(contractor.availabilityStatus)}
              </div>
              {/* Quick Stats */}
              <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-4 w-4" />
                  <span>{contractor.skills.length} skills</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4" />
                  <span>{contractor.recentJobs.length} recent jobs</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  <span>{contractor.radiusMiles} mile radius</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>Since {memberSince}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Profile Details Card (editable)
// ---------------------------------------------------------------------------

function ProfileDetailsCard({ contractor }: { contractor: ContractorDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    firstName: contractor.user.firstName || '',
    lastName: contractor.user.lastName || '',
    email: contractor.user.email || '',
    phone: contractor.user.phone || '',
    businessName: contractor.businessName || '',
    bio: contractor.bio || '',
    postcode: contractor.postcode || '',
    city: contractor.city || '',
    hourlyRate: contractor.hourlyRate ? String(contractor.hourlyRate) : '',
    radiusMiles: contractor.radiusMiles || 10,
  });

  const updateField = (field: string, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/contractors/${contractor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone || null,
          businessName: form.businessName || null,
          bio: form.bio || null,
          postcode: form.postcode || null,
          city: form.city || null,
          hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
          radiusMiles: form.radiusMiles,
        }),
      });
      if (!res.ok) throw new Error('Failed to save profile');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-contractor', contractor.id] });
      toast({ title: 'Profile saved', description: 'Contractor details updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.05 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={e => updateField('firstName', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={e => updateField('lastName', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => updateField('email', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => updateField('phone', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Hourly Rate (pence)</Label>
              <Input type="number" value={form.hourlyRate} onChange={e => updateField('hourlyRate', e.target.value)} placeholder="e.g. 3500" />
            </div>
            <div className="space-y-2">
              <Label>Postcode</Label>
              <Input value={form.postcode} onChange={e => updateField('postcode', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={form.city} onChange={e => updateField('city', e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea
              value={form.bio}
              onChange={e => updateField('bio', e.target.value)}
              rows={3}
              placeholder="Brief description of experience..."
            />
          </div>

          <div className="space-y-2">
            <Label>Service Radius: {form.radiusMiles} miles</Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[form.radiusMiles]}
                onValueChange={([v]) => updateField('radiusMiles', v)}
                min={1}
                max={50}
                step={1}
                className="flex-1"
              />
              <Input
                type="number"
                className="w-20"
                value={form.radiusMiles}
                onChange={e => updateField('radiusMiles', Number(e.target.value) || 1)}
                min={1}
                max={50}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Profile
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Display Image Section
// ---------------------------------------------------------------------------

function DisplayImageSection({ contractor }: { contractor: ContractorDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload a JPG, PNG, or WebP image.', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    // Simulate progress since fetch doesn't support progress natively
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 15, 90));
    }, 200);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`/api/admin/contractors/${contractor.id}/image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!res.ok) {
        throw new Error('Upload failed');
      }

      queryClient.invalidateQueries({ queryKey: ['admin-contractor', contractor.id] });
      toast({ title: 'Image uploaded', description: 'Profile image has been updated.' });
    } catch (err: any) {
      clearInterval(progressInterval);
      toast({ title: 'Upload failed', description: err.message || 'Could not upload image.', variant: 'destructive' });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [contractor.id, queryClient, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.1 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Display Image
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Current Image */}
            <div className="shrink-0">
              {contractor.profileImageUrl ? (
                <img
                  src={contractor.profileImageUrl}
                  alt="Current profile"
                  className="w-32 h-32 rounded-full object-cover border-2 border-border"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-muted flex items-center justify-center border-2 border-border">
                  <ImageIcon className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Upload Zone */}
            <div
              className={`flex-1 w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {uploading ? (
                <div className="space-y-2">
                  <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Uploading... {uploadProgress}%</p>
                  <div className="w-full bg-muted rounded-full h-2 max-w-xs mx-auto">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag and drop an image here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    JPG, PNG, or WebP. Max 5MB.
                  </p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Skills & Rates Card
// ---------------------------------------------------------------------------

function SkillsRatesCard({ contractor }: { contractor: ContractorDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch WTBP rates: { categorySlug: ratePence }
  const { data: wtbpRates } = useQuery<Record<string, number>>({
    queryKey: ['wtbp-rate-card-current'],
    queryFn: async () => {
      const res = await fetch('/api/wtbp-rate-card/current');
      if (!res.ok) throw new Error('Failed to fetch WTBP rates');
      const data = await res.json();
      // Use flat map for backward compat
      return data.flat || data;
    },
    staleTime: 5 * 60 * 1000, // cache for 5 mins
  });

  // Build initial state from contractor's existing skills
  const [skills, setSkills] = useState<Record<string, { enabled: boolean; hourlyRate: string; dayRate: string }>>(() => {
    const map: Record<string, { enabled: boolean; hourlyRate: string; dayRate: string }> = {};
    for (const cat of ALL_CATEGORIES) {
      const existing = contractor.skills.find(s => s.categorySlug === cat);
      map[cat] = {
        enabled: !!existing,
        hourlyRate: existing?.hourlyRate ? String(existing.hourlyRate) : '',
        dayRate: existing?.dayRate ? String(existing.dayRate) : '',
      };
    }
    return map;
  });

  const toggleCategory = (cat: string) => {
    setSkills(prev => ({
      ...prev,
      [cat]: { ...prev[cat], enabled: !prev[cat].enabled },
    }));
  };

  const updateSkillField = (cat: string, field: 'hourlyRate' | 'dayRate', value: string) => {
    setSkills(prev => ({
      ...prev,
      [cat]: { ...prev[cat], [field]: value },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const skillsPayload = Object.entries(skills)
        .filter(([, v]) => v.enabled)
        .map(([categorySlug, v]) => ({
          categorySlug,
          hourlyRate: v.hourlyRate ? Number(v.hourlyRate) : null,
          dayRate: v.dayRate ? Number(v.dayRate) : null,
        }));

      const res = await fetch(`/api/admin/contractors/${contractor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({ skills: skillsPayload }),
      });
      if (!res.ok) throw new Error('Failed to save skills');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-contractor', contractor.id] });
      toast({ title: 'Skills saved', description: 'Skills and rates updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  // Active skills for earnings preview
  const activeCategories = Object.entries(skills)
    .filter(([, v]) => v.enabled)
    .map(([slug]) => slug);

  const earningsTotal = activeCategories.reduce((sum, slug) => {
    const rate = wtbpRates?.[slug];
    return sum + (rate || 0);
  }, 0);

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.15 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Skills & Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALL_CATEGORIES.map(cat => {
              const wtbpRate = wtbpRates?.[cat];
              return (
                <div
                  key={cat}
                  className={`rounded-lg border p-3 transition-colors ${
                    skills[cat]?.enabled ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      checked={skills[cat]?.enabled || false}
                      onCheckedChange={() => toggleCategory(cat)}
                    />
                    <span className="text-sm font-medium">{getCategoryLabel(cat)}</span>
                  </div>
                  {skills[cat]?.enabled && (
                    <div className="ml-6 mt-1">
                      <div className="text-xs">
                        {wtbpRate ? (
                          <span className="text-green-500 font-medium">
                            Platform pays: {formatPence(wtbpRate)}
                          </span>
                        ) : (
                          <span className="text-amber-500 font-medium">
                            No rate set
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end mt-4">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Skills
            </Button>
          </div>

          {/* Earnings Preview */}
          {activeCategories.length > 0 && (
            <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
              <h4 className="text-sm font-semibold text-foreground mb-3">Estimated Earnings Per Job</h4>
              <div className="space-y-1.5">
                {activeCategories.map(slug => {
                  const rate = wtbpRates?.[slug];
                  return (
                    <div key={slug} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{getCategoryLabel(slug)}</span>
                      <span className={rate ? 'text-foreground font-medium' : 'text-amber-500'}>
                        {rate ? formatPence(rate) : 'No rate'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <Link
                  href="/admin/wtbp-rates"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Manage global rates
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Availability Calendar
// ---------------------------------------------------------------------------

type SlotType = 'am' | 'pm' | 'full_day' | 'off';

interface DayAvailability {
  date: string; // YYYY-MM-DD
  slot: SlotType;
}

function getSlotFromOverride(override: ContractorDetail['dateOverrides'][0]): SlotType {
  if (!override.isAvailable) return 'off';
  if (override.startTime === '08:00' && override.endTime === '18:00') return 'full_day';
  if (override.startTime === '08:00' && override.endTime === '13:00') return 'am';
  if (override.startTime === '13:00' && override.endTime === '18:00') return 'pm';
  return 'full_day';
}

function AvailabilityCalendar({ contractor }: { contractor: ContractorDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Build initial override map from contractor data
  const [overrides, setOverrides] = useState<Record<string, SlotType>>(() => {
    const map: Record<string, SlotType> = {};
    for (const o of contractor.dateOverrides) {
      const dateStr = new Date(o.date).toISOString().split('T')[0];
      map[dateStr] = getSlotFromOverride(o);
    }
    return map;
  });

  const [dirty, setDirty] = useState(false);

  const toggleDay = (dateStr: string) => {
    const cycle: SlotType[] = ['full_day', 'am', 'pm', 'off'];
    const current = overrides[dateStr] || 'off';
    const idx = cycle.indexOf(current);
    const next = cycle[(idx + 1) % cycle.length];
    setOverrides(prev => ({ ...prev, [dateStr]: next }));
    setDirty(true);
  };

  const daysInMonth = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun

    const days: Array<{ date: Date; dateStr: string } | null> = [];

    // Pad start
    for (let i = 0; i < startPad; i++) days.push(null);

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      days.push({
        date,
        dateStr: date.toISOString().split('T')[0],
      });
    }

    return days;
  }, [currentMonth]);

  const monthLabel = new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 };
      return { ...prev, month: prev.month - 1 };
    });
  };

  const nextMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 };
      return { ...prev, month: prev.month + 1 };
    });
  };

  // Find booked dates from recent jobs
  const bookedDates = useMemo(() => {
    const set = new Set<string>();
    for (const job of contractor.recentJobs) {
      if (job.scheduledDate) {
        set.add(new Date(job.scheduledDate).toISOString().split('T')[0]);
      }
    }
    return set;
  }, [contractor.recentJobs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Only send overrides that are within the current or future
      const dates = Object.entries(overrides).map(([date, slot]) => ({
        date,
        slot,
        isAvailable: slot !== 'off',
      }));

      const res = await fetch(`/api/admin/contractors/${contractor.id}/availability`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify({ dates }),
      });
      if (!res.ok) throw new Error('Failed to save availability');
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin-contractor', contractor.id] });
      toast({ title: 'Availability saved', description: 'Calendar updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const slotBadge = (slot: SlotType) => {
    switch (slot) {
      case 'full_day':
        return <span className="text-[10px] font-bold text-green-400">FD</span>;
      case 'am':
        return <span className="text-[10px] font-bold text-green-400">AM</span>;
      case 'pm':
        return <span className="text-[10px] font-bold text-green-400">PM</span>;
      default:
        return null;
    }
  };

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.2 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Availability Calendar
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Month Nav */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold">{monthLabel}</span>
            <Button variant="ghost" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-600" />
              Available
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-600" />
              Booked
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-muted" />
              Off
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
            {daysInMonth.map((day, idx) => {
              if (!day) {
                return <div key={`pad-${idx}`} className="h-14" />;
              }
              const isBooked = bookedDates.has(day.dateStr);
              const slot = overrides[day.dateStr];
              const isAvailable = slot && slot !== 'off';
              const dayNum = day.date.getDate();

              let bgColor = 'bg-muted/30';
              if (isBooked) bgColor = 'bg-red-900/40 border-red-700';
              else if (isAvailable) bgColor = 'bg-green-900/40 border-green-700';

              return (
                <button
                  key={day.dateStr}
                  className={`h-14 rounded-md border text-center p-1 flex flex-col items-center justify-center gap-0.5 transition-colors hover:border-primary ${bgColor}`}
                  onClick={() => !isBooked && toggleDay(day.dateStr)}
                  disabled={isBooked}
                  title={isBooked ? 'Booked - has a job' : `Click to toggle (${slot || 'off'})`}
                >
                  <span className="text-sm font-medium">{dayNum}</span>
                  {isBooked ? (
                    <span className="text-[10px] font-bold text-red-400">JOB</span>
                  ) : (
                    slotBadge(slot)
                  )}
                </button>
              );
            })}
          </div>

          {dirty && (
            <div className="flex justify-end mt-4">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Availability
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Booked Jobs Card
// ---------------------------------------------------------------------------

function BookedJobsCard({ contractor }: { contractor: ContractorDetail }) {
  const jobs = contractor.recentJobs;

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.25 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Booked Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No jobs yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map(job => (
                    <TableRow key={job.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {job.scheduledDate
                          ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : new Date(job.createdAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                      </TableCell>
                      <TableCell className="text-sm">{job.customerName || 'N/A'}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {job.jobDescription || 'No description'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            job.status === 'completed'
                              ? 'default'
                              : job.status === 'in_progress'
                              ? 'secondary'
                              : 'outline'
                          }
                          className={
                            job.status === 'completed'
                              ? 'bg-green-600 text-white'
                              : ''
                          }
                        >
                          {job.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {job.totalPence ? formatPence(job.totalPence) : '--'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Earnings Summary Card
// ---------------------------------------------------------------------------

function EarningsSummaryCard({ contractor }: { contractor: ContractorDetail }) {
  const completedJobs = contractor.recentJobs.filter(j => j.status === 'completed');
  const totalEarned = completedJobs.reduce((sum, j) => sum + (j.payoutPence || 0), 0);
  const avgJobValue = completedJobs.length > 0 ? totalEarned / completedJobs.length : 0;

  return (
    <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.3 }}>
      <Card className="bg-card border border-border rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Earnings Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-muted/30 border border-border p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{formatPence(totalEarned)}</p>
              <p className="text-sm text-muted-foreground mt-1">Total Earned</p>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{completedJobs.length}</p>
              <p className="text-sm text-muted-foreground mt-1">Jobs Completed</p>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{formatPence(Math.round(avgJobValue))}</p>
              <p className="text-sm text-muted-foreground mt-1">Avg Job Value</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function ContractorDetailPage() {
  const [, params] = useRoute('/admin/contractors/:id');
  const contractorId = params?.id;

  const { data: contractor, isLoading, error } = useQuery<ContractorDetail>({
    queryKey: ['admin-contractor', contractorId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/contractors/${contractorId}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      if (!res.ok) throw new Error('Failed to fetch contractor');
      return res.json();
    },
    enabled: !!contractorId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !contractor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-lg text-destructive mb-4">
          {error ? 'Failed to load contractor' : 'Contractor not found'}
        </p>
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-32 sm:px-6 sm:pt-6 space-y-6">
      <ProfileHeader contractor={contractor} />
      <ProfileDetailsCard contractor={contractor} />
      <DisplayImageSection contractor={contractor} />
      <SkillsRatesCard contractor={contractor} />
      <AvailabilityCalendar contractor={contractor} />
      <BookedJobsCard contractor={contractor} />
      <EarningsSummaryCard contractor={contractor} />
    </div>
  );
}
