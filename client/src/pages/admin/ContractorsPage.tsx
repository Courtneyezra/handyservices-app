import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Users,
    Search,
    MapPin,
    Briefcase,
    Calendar,
    Clock,
    CheckCircle,
    XCircle,
    ChevronDown,
    ChevronUp,
    Wrench,
    Phone,
    Mail,
    AlertTriangle,
    DollarSign,
    Plus,
    Pencil,
    Trash2,
    Loader2,
} from 'lucide-react';
import { CATEGORY_LABELS } from '@shared/categories';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';

// All job categories from contextual pricing
const ALL_CATEGORIES = [
    'general_fixing', 'flat_pack', 'tv_mounting', 'carpentry',
    'plumbing_minor', 'electrical_minor', 'painting', 'tiling',
    'plastering', 'lock_change', 'guttering', 'pressure_washing',
    'fencing', 'garden_maintenance', 'bathroom_fitting', 'kitchen_fitting',
    'door_fitting', 'flooring', 'curtain_blinds', 'silicone_sealant',
    'shelving', 'furniture_repair', 'waste_removal', 'other',
] as const;

interface Contractor {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    postcode: string;
    city: string;
    radiusMiles: number;
    bio: string;
    businessName: string;
    hourlyRate: number;
    profileImageUrl: string | null;
    heroImageUrl: string | null;
    availabilityStatus: string;
    publicProfileEnabled: boolean;
    slug: string;
    createdAt: string;
    skills: Array<{
        serviceId: string;
        serviceName: string;
        hourlyRate: number;
    }>;
    totalJobs: number;
    earningsThisWeekPence: number;
    earningsThisMonthPence: number;
    earningsAllTimePence: number;
    categorySkills: Array<{ categorySlug: string; hourlyRate: number; dayRate: number }>;
    insuranceUrl: string | null;
    stripeConnectId: string | null;
    lastAvailabilityRefresh: string | null;
    isStaleAvailability: boolean;
    verificationStatus: string;
    avgMarginPercent: number | null;
    quotesWithThinMargin: number;
    weeklyPatterns: Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        isActive: boolean;
    }>;
    upcomingOverrides: Array<{
        date: string;
        isAvailable: boolean;
        startTime: string;
        endTime: string;
    }>;
}

interface ContractorFormData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    bio: string;
    businessName: string;
    postcode: string;
    city: string;
    radiusMiles: number;
    hourlyRate: number;
    profileImageUrl: string;
    heroImageUrl: string;
    skills: Record<string, { enabled: boolean; hourlyRate: string; dayRate: string }>;
}

interface AvailabilityOverride {
    date: string;
    slot: 'am' | 'pm' | 'full_day' | 'off';
}

const EMPTY_FORM: ContractorFormData = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    bio: '',
    businessName: '',
    postcode: '',
    city: '',
    radiusMiles: 10,
    hourlyRate: 35,
    profileImageUrl: '',
    heroImageUrl: '',
    skills: {},
};

function generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getNext14Days(): string[] {
    const days: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getCategoryLabelFromSlug(slug: string): string {
    return (CATEGORY_LABELS as Record<string, string>)[slug] || slug;
}

function getAdminToken(): string {
    return localStorage.getItem('adminToken') || '';
}

// --------------------------------------------------------------------------
// Contractor Form Panel (used for both Create and Edit)
// --------------------------------------------------------------------------

function ContractorFormPanel({
    open,
    onOpenChange,
    editingContractor,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingContractor: Contractor | null;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const isEditing = !!editingContractor;

    const [form, setForm] = useState<ContractorFormData>(EMPTY_FORM);
    const [activeTab, setActiveTab] = useState<'details' | 'skills' | 'availability'>('details');
    const [availabilityOverrides, setAvailabilityOverrides] = useState<AvailabilityOverride[]>([]);

    // Populate form when editing
    useEffect(() => {
        if (editingContractor) {
            const skillsMap: ContractorFormData['skills'] = {};
            editingContractor.categorySkills?.forEach(cs => {
                skillsMap[cs.categorySlug] = {
                    enabled: true,
                    hourlyRate: String(cs.hourlyRate || ''),
                    dayRate: String(cs.dayRate || ''),
                };
            });
            setForm({
                firstName: editingContractor.firstName || '',
                lastName: editingContractor.lastName || '',
                email: editingContractor.email || '',
                phone: editingContractor.phone || '',
                password: '',
                bio: editingContractor.bio || '',
                businessName: editingContractor.businessName || '',
                postcode: editingContractor.postcode || '',
                city: editingContractor.city || '',
                radiusMiles: editingContractor.radiusMiles || 10,
                hourlyRate: editingContractor.hourlyRate || 35,
                profileImageUrl: editingContractor.profileImageUrl || '',
                heroImageUrl: editingContractor.heroImageUrl || '',
                skills: skillsMap,
            });
            // Pre-populate availability overrides from existing data
            const overrides: AvailabilityOverride[] = [];
            editingContractor.upcomingOverrides?.forEach(ov => {
                const dateStr = ov.date.split('T')[0];
                let slot: AvailabilityOverride['slot'] = 'off';
                if (ov.isAvailable) {
                    if (ov.startTime === '08:00' && ov.endTime === '12:00') slot = 'am';
                    else if (ov.startTime === '12:00' && ov.endTime === '18:00') slot = 'pm';
                    else slot = 'full_day';
                }
                overrides.push({ date: dateStr, slot });
            });
            setAvailabilityOverrides(overrides);
        } else {
            setForm(EMPTY_FORM);
            setAvailabilityOverrides([]);
        }
        setActiveTab('details');
    }, [editingContractor, open]);

    const updateField = <K extends keyof ContractorFormData>(key: K, value: ContractorFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const toggleSkill = (slug: string) => {
        setForm(prev => {
            const current = prev.skills[slug];
            const newSkills = { ...prev.skills };
            if (current?.enabled) {
                delete newSkills[slug];
            } else {
                newSkills[slug] = { enabled: true, hourlyRate: '', dayRate: '' };
            }
            return { ...prev, skills: newSkills };
        });
    };

    const updateSkillRate = (slug: string, field: 'hourlyRate' | 'dayRate', value: string) => {
        setForm(prev => ({
            ...prev,
            skills: {
                ...prev.skills,
                [slug]: { ...prev.skills[slug], [field]: value },
            },
        }));
    };

    const setOverrideSlot = (date: string, slot: AvailabilityOverride['slot']) => {
        setAvailabilityOverrides(prev => {
            const existing = prev.findIndex(o => o.date === date);
            if (slot === 'off' && existing >= 0) {
                // Remove override to revert to default
                return prev.filter((_, i) => i !== existing);
            }
            if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { date, slot };
                return updated;
            }
            return [...prev, { date, slot }];
        });
    };

    // Create contractor mutation
    const createMutation = useMutation({
        mutationFn: async (data: ContractorFormData) => {
            const res = await fetch('/api/admin/contractors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getAdminToken()}`,
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Failed to create contractor' }));
                throw new Error(err.message || 'Failed to create contractor');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-contractors'] });
            toast({ title: 'Contractor created', description: 'New contractor has been added successfully.' });
            onOpenChange(false);
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    // Update contractor mutation
    const updateMutation = useMutation({
        mutationFn: async (data: ContractorFormData) => {
            const res = await fetch(`/api/admin/contractors/${editingContractor!.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getAdminToken()}`,
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Failed to update contractor' }));
                throw new Error(err.message || 'Failed to update contractor');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-contractors'] });
            toast({ title: 'Contractor updated', description: 'Changes saved successfully.' });
            onOpenChange(false);
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    // Availability override mutation
    const availabilityMutation = useMutation({
        mutationFn: async (overrides: AvailabilityOverride[]) => {
            const res = await fetch(`/api/admin/contractors/${editingContractor!.id}/availability`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getAdminToken()}`,
                },
                body: JSON.stringify({ overrides }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Failed to update availability' }));
                throw new Error(err.message || 'Failed to update availability');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-contractors'] });
            toast({ title: 'Availability updated', description: 'Overrides saved.' });
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const handleSubmit = () => {
        if (!form.firstName || !form.lastName || !form.email) {
            toast({ title: 'Validation error', description: 'First name, last name, and email are required.', variant: 'destructive' });
            return;
        }
        if (isEditing) {
            updateMutation.mutate(form);
        } else {
            if (!form.password) {
                toast({ title: 'Validation error', description: 'Password is required for new contractors.', variant: 'destructive' });
                return;
            }
            createMutation.mutate(form);
        }
    };

    const handleSaveAvailability = () => {
        availabilityMutation.mutate(availabilityOverrides);
    };

    const isSaving = createMutation.isPending || updateMutation.isPending;
    const next14Days = getNext14Days();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Edit Contractor' : 'Add Contractor'}</DialogTitle>
                    <DialogDescription>
                        {isEditing
                            ? `Editing ${editingContractor?.firstName} ${editingContractor?.lastName}`
                            : 'Create a new contractor account and profile'}
                    </DialogDescription>
                </DialogHeader>

                {/* Tab Navigation */}
                <div className="flex gap-1 border-b mb-4">
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'details'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setActiveTab('details')}
                    >
                        Details
                    </button>
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'skills'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setActiveTab('skills')}
                    >
                        Skills
                    </button>
                    {isEditing && (
                        <button
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'availability'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setActiveTab('availability')}
                        >
                            Availability
                        </button>
                    )}
                </div>

                {/* Details Tab */}
                {activeTab === 'details' && (
                    <div className="space-y-4">
                        {/* Name Row */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">First Name *</Label>
                                <Input
                                    id="firstName"
                                    value={form.firstName}
                                    onChange={e => updateField('firstName', e.target.value)}
                                    placeholder="John"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">Last Name *</Label>
                                <Input
                                    id="lastName"
                                    value={form.lastName}
                                    onChange={e => updateField('lastName', e.target.value)}
                                    placeholder="Smith"
                                />
                            </div>
                        </div>

                        {/* Contact Row */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email *</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={form.email}
                                    onChange={e => updateField('email', e.target.value)}
                                    placeholder="john@example.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input
                                    id="phone"
                                    value={form.phone}
                                    onChange={e => updateField('phone', e.target.value)}
                                    placeholder="07700 900123"
                                />
                            </div>
                        </div>

                        {/* Password (only for create, or optional for edit) */}
                        <div className="space-y-2">
                            <Label htmlFor="password">
                                Password {isEditing ? '(leave blank to keep current)' : '*'}
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    id="password"
                                    type="text"
                                    value={form.password}
                                    onChange={e => updateField('password', e.target.value)}
                                    placeholder={isEditing ? 'Leave blank to keep current' : 'Enter password'}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateField('password', generatePassword())}
                                >
                                    Auto-generate
                                </Button>
                            </div>
                        </div>

                        {/* Bio */}
                        <div className="space-y-2">
                            <Label htmlFor="bio">About Me</Label>
                            <Textarea
                                id="bio"
                                value={form.bio}
                                onChange={e => updateField('bio', e.target.value)}
                                placeholder="Brief description of experience and specialties..."
                                rows={3}
                            />
                        </div>

                        {/* Location Row */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="postcode">Postcode</Label>
                                <Input
                                    id="postcode"
                                    value={form.postcode}
                                    onChange={e => updateField('postcode', e.target.value)}
                                    placeholder="NG1 1AA"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="city">City</Label>
                                <Input
                                    id="city"
                                    value={form.city}
                                    onChange={e => updateField('city', e.target.value)}
                                    placeholder="Nottingham"
                                />
                            </div>
                        </div>

                        {/* Radius */}
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
                                    value={form.radiusMiles}
                                    onChange={e => updateField('radiusMiles', Number(e.target.value) || 1)}
                                    className="w-20"
                                    min={1}
                                    max={50}
                                />
                            </div>
                        </div>

                        {/* Profile image and hourly rate managed via contractor detail page after creation */}
                    </div>
                )}

                {/* Skills Tab */}
                {activeTab === 'skills' && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Select categories this contractor can handle. Rates are set globally via the WTBP Rate Card.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-2">
                            {ALL_CATEGORIES.map(slug => {
                                const label = getCategoryLabelFromSlug(slug);
                                const isEnabled = form.skills[slug]?.enabled;
                                return (
                                    <div
                                        key={slug}
                                        className={`rounded-lg border p-3 transition-colors ${
                                            isEnabled ? 'border-primary bg-primary/5' : 'border-border'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Checkbox
                                                id={`skill-${slug}`}
                                                checked={isEnabled || false}
                                                onCheckedChange={() => toggleSkill(slug)}
                                            />
                                            <Label
                                                htmlFor={`skill-${slug}`}
                                                className="cursor-pointer font-medium"
                                            >
                                                {label}
                                            </Label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {Object.values(form.skills).filter(s => s.enabled).length} categories selected
                        </div>
                    </div>
                )}

                {/* Availability Tab (edit only) */}
                {activeTab === 'availability' && isEditing && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Set date-specific availability overrides for the next 14 days. These override the contractor's weekly pattern.
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {next14Days.map(dateStr => {
                                const d = new Date(dateStr + 'T00:00:00');
                                const dayName = DAY_NAMES[d.getDay()];
                                const dayNum = d.getDate();
                                const monthName = d.toLocaleDateString('en-GB', { month: 'short' });
                                const override = availabilityOverrides.find(o => o.date === dateStr);
                                const currentSlot = override?.slot || 'off';

                                return (
                                    <div key={dateStr} className="border rounded-lg p-3 space-y-2">
                                        <div className="text-sm font-medium text-center">
                                            {dayName} {dayNum} {monthName}
                                        </div>
                                        <div className="grid grid-cols-2 gap-1">
                                            {(['am', 'pm', 'full_day', 'off'] as const).map(slot => (
                                                <button
                                                    key={slot}
                                                    className={`text-xs px-2 py-1.5 rounded transition-colors ${
                                                        currentSlot === slot
                                                            ? slot === 'off'
                                                                ? 'bg-red-500 text-white'
                                                                : 'bg-green-500 text-white'
                                                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                                    }`}
                                                    onClick={() => setOverrideSlot(dateStr, slot)}
                                                >
                                                    {slot === 'am' ? 'AM' : slot === 'pm' ? 'PM' : slot === 'full_day' ? 'Full' : 'Off'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <Button
                            onClick={handleSaveAvailability}
                            disabled={availabilityMutation.isPending}
                            variant="outline"
                        >
                            {availabilityMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Availability Overrides
                        </Button>
                    </div>
                )}

                {/* Footer */}
                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    {activeTab !== 'availability' && (
                        <Button onClick={handleSubmit} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isEditing ? 'Save Changes' : 'Create Contractor'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// --------------------------------------------------------------------------
// Deactivate Confirmation Dialog
// --------------------------------------------------------------------------

function DeactivateDialog({
    open,
    onOpenChange,
    contractor,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contractor: Contractor | null;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const deactivateMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/admin/contractors/${contractor!.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${getAdminToken()}` },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: 'Failed to deactivate' }));
                throw new Error(err.message || 'Failed to deactivate contractor');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-contractors'] });
            toast({ title: 'Contractor deactivated', description: `${contractor?.firstName} ${contractor?.lastName} has been deactivated.` });
            onOpenChange(false);
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Deactivate Contractor</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to deactivate{' '}
                        <strong>{contractor?.firstName} {contractor?.lastName}</strong>?
                        This will prevent them from receiving new jobs.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={() => deactivateMutation.mutate()}
                        disabled={deactivateMutation.isPending}
                    >
                        {deactivateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Deactivate
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// --------------------------------------------------------------------------
// Main Page Component
// --------------------------------------------------------------------------

export default function ContractorsPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [formOpen, setFormOpen] = useState(false);
    const [editingContractor, setEditingContractor] = useState<Contractor | null>(null);
    const [deactivateOpen, setDeactivateOpen] = useState(false);
    const [deactivatingContractor, setDeactivatingContractor] = useState<Contractor | null>(null);

    const { data: contractors, isLoading } = useQuery<Contractor[]>({
        queryKey: ['admin-contractors'],
        queryFn: async () => {
            const token = localStorage.getItem('adminToken');
            const res = await fetch('/api/admin/contractors', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch contractors');
            return res.json();
        }
    });

    const filteredContractors = contractors?.filter(c => {
        const search = searchTerm.toLowerCase();
        return (
            c.firstName?.toLowerCase().includes(search) ||
            c.lastName?.toLowerCase().includes(search) ||
            c.email?.toLowerCase().includes(search) ||
            c.postcode?.toLowerCase().includes(search) ||
            c.city?.toLowerCase().includes(search)
        );
    });

    const toggleRow = (id: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedRows(newExpanded);
    };

    const openCreateForm = () => {
        setEditingContractor(null);
        setFormOpen(true);
    };

    const openEditForm = (contractor: Contractor, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingContractor(contractor);
        setFormOpen(true);
    };

    const openDeactivate = (contractor: Contractor, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeactivatingContractor(contractor);
        setDeactivateOpen(true);
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'available':
                return <Badge className="bg-green-500">Available</Badge>;
            case 'busy':
                return <Badge className="bg-yellow-500">Busy</Badge>;
            case 'offline':
                return <Badge className="bg-gray-500">Offline</Badge>;
            default:
                return <Badge className="bg-blue-500">{status || 'Active'}</Badge>;
        }
    };

    if (isLoading) {
        return (
            <div className="p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                    <div className="h-64 bg-gray-200 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6" />
                        Contractors
                    </h1>
                    <p className="text-muted-foreground">
                        {contractors?.length || 0} contractors onboarded
                    </p>
                </div>
                <Button onClick={openCreateForm} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Contractor
                </Button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, email, postcode..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-blue-500" />
                            <div>
                                <p className="text-2xl font-bold">{contractors?.length || 0}</p>
                                <p className="text-sm text-muted-foreground">Total Contractors</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-green-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.filter(c => c.availabilityStatus === 'available' || !c.availabilityStatus).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Available Now</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Wrench className="h-5 w-5 text-purple-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.filter(c => c.skills?.length > 0).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">With Skills Set</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Briefcase className="h-5 w-5 text-orange-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.reduce((sum, c) => sum + (c.totalJobs || 0), 0) || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Total Jobs</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            <div>
                                <p className="text-2xl font-bold text-red-600">
                                    {contractors?.filter(c => c.isStaleAvailability).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Stale Availability</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-amber-500" />
                            <div>
                                <p className="text-2xl font-bold text-amber-600">
                                    {contractors?.filter(c => c.quotesWithThinMargin > 0).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Margin Alerts</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Contractors Table */}
            <Card>
                <CardHeader>
                    <CardTitle>All Contractors</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-8"></TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead>Location</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Skills</TableHead>
                                <TableHead>Jobs</TableHead>
                                <TableHead>Availability</TableHead>
                                <TableHead>Categories</TableHead>
                                <TableHead>Earnings</TableHead>
                                <TableHead>Margin</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-24">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredContractors?.map((contractor) => (
                                <>
                                    <TableRow
                                        key={contractor.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => toggleRow(contractor.id)}
                                    >
                                        <TableCell>
                                            {expandedRows.has(contractor.id) ? (
                                                <ChevronUp className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            <Link
                                                href={`/admin/contractors/${contractor.id}`}
                                                className="text-primary hover:underline"
                                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                            >
                                                {contractor.firstName} {contractor.lastName}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <div className="flex items-center gap-1">
                                                    <Mail className="h-3 w-3" />
                                                    {contractor.email}
                                                </div>
                                                {contractor.phone && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {contractor.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                                {contractor.postcode || contractor.city || 'N/A'}
                                            </div>
                                            {contractor.radiusMiles && (
                                                <span className="text-xs text-muted-foreground">
                                                    {contractor.radiusMiles} mile radius
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(contractor.availabilityStatus)}
                                        </TableCell>
                                        <TableCell>
                                            {contractor.skills?.length || 0} skills
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{contractor.totalJobs} jobs</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-0.5">
                                                {DAY_NAMES.map((day, i) => {
                                                    const pattern = contractor.weeklyPatterns?.find(p => p.dayOfWeek === i);
                                                    const isActive = pattern?.isActive;
                                                    return (
                                                        <span
                                                            key={i}
                                                            className={`w-6 h-6 text-xs flex items-center justify-center rounded ${
                                                                isActive
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : 'bg-gray-100 text-gray-400'
                                                            }`}
                                                            title={`${day}: ${isActive ? 'Available' : 'Unavailable'}`}
                                                        >
                                                            {day.charAt(0)}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{contractor.categorySkills?.length || 0}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-green-600 font-medium">
                                                £{(contractor.earningsThisMonthPence / 100).toFixed(0)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            {contractor.avgMarginPercent != null ? (
                                                <span className={
                                                    contractor.avgMarginPercent >= 25
                                                        ? 'text-green-600'
                                                        : contractor.avgMarginPercent >= 15
                                                            ? 'text-amber-600'
                                                            : 'text-red-600'
                                                }>
                                                    {contractor.avgMarginPercent}%
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">&mdash;</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className={`w-2 h-2 rounded-full inline-block ${
                                                        contractor.verificationStatus === 'verified'
                                                            ? 'bg-green-500'
                                                            : 'bg-red-500'
                                                    }`}
                                                    title={contractor.verificationStatus || 'Unverified'}
                                                />
                                                <span title={contractor.insuranceUrl ? 'Insured' : 'No insurance'}>
                                                    {contractor.insuranceUrl ? '🛡️' : '❌'}
                                                </span>
                                                <span title={contractor.stripeConnectId ? 'Stripe connected' : 'No Stripe'}>
                                                    {contractor.stripeConnectId ? '💳' : '—'}
                                                </span>
                                                {contractor.isStaleAvailability && (
                                                    <span title="Stale availability">⏰</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    title="Edit contractor"
                                                    onClick={(e) => openEditForm(contractor, e)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    title="Deactivate contractor"
                                                    onClick={(e) => openDeactivate(contractor, e)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    {expandedRows.has(contractor.id) && (
                                        <TableRow>
                                            <TableCell colSpan={13} className="bg-muted/30">
                                                <div className="p-4 space-y-4">
                                                    {/* Skills */}
                                                    <div>
                                                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                            <Wrench className="h-4 w-4" />
                                                            Skills
                                                        </h4>
                                                        {contractor.skills?.length > 0 ? (
                                                            <div className="flex flex-wrap gap-2">
                                                                {contractor.skills.map((skill, i) => (
                                                                    <Badge key={i} variant="secondary">
                                                                        {skill.serviceName}
                                                                        {skill.hourlyRate && (
                                                                            <span className="ml-1 text-green-600">
                                                                                £{skill.hourlyRate}/hr
                                                                            </span>
                                                                        )}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground">No skills set</p>
                                                        )}
                                                    </div>

                                                    {/* Weekly Pattern */}
                                                    <div>
                                                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                            <Calendar className="h-4 w-4" />
                                                            Weekly Pattern
                                                        </h4>
                                                        <div className="grid grid-cols-7 gap-2">
                                                            {DAY_NAMES.map((day, i) => {
                                                                const pattern = contractor.weeklyPatterns?.find(p => p.dayOfWeek === i);
                                                                return (
                                                                    <div
                                                                        key={i}
                                                                        className={`p-2 rounded text-center text-sm ${
                                                                            pattern?.isActive
                                                                                ? 'bg-green-100 border border-green-300'
                                                                                : 'bg-gray-100 border border-gray-200'
                                                                        }`}
                                                                    >
                                                                        <div className="font-medium">{day}</div>
                                                                        {pattern?.isActive ? (
                                                                            <div className="text-xs text-green-700">
                                                                                {pattern.startTime}-{pattern.endTime}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="text-xs text-gray-400">Off</div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Upcoming Overrides */}
                                                    {contractor.upcomingOverrides?.length > 0 && (
                                                        <div>
                                                            <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                                <Clock className="h-4 w-4" />
                                                                Upcoming Date Overrides
                                                            </h4>
                                                            <div className="flex flex-wrap gap-2">
                                                                {contractor.upcomingOverrides.slice(0, 10).map((override, i) => (
                                                                    <Badge
                                                                        key={i}
                                                                        variant={override.isAvailable ? 'default' : 'destructive'}
                                                                    >
                                                                        {new Date(override.date).toLocaleDateString('en-GB', {
                                                                            weekday: 'short',
                                                                            month: 'short',
                                                                            day: 'numeric'
                                                                        })}
                                                                        {override.isAvailable ? ' ✓' : ' ✕'}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Bio */}
                                                    {contractor.bio && (
                                                        <div>
                                                            <h4 className="font-semibold mb-1">Bio</h4>
                                                            <p className="text-sm text-muted-foreground">{contractor.bio}</p>
                                                        </div>
                                                    )}

                                                    {/* Category Skills */}
                                                    {contractor.categorySkills?.length > 0 && (
                                                        <div className="space-y-2">
                                                            <h4 className="font-semibold text-sm">Category Skills</h4>
                                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                                {contractor.categorySkills.map(cs => (
                                                                    <div key={cs.categorySlug} className="bg-slate-50 rounded-lg px-3 py-1.5 text-sm font-medium">
                                                                        {getCategoryLabelFromSlug(cs.categorySlug)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Earnings Breakdown */}
                                                    <div>
                                                        <h4 className="font-semibold text-sm mb-2">Earnings</h4>
                                                        <div className="grid grid-cols-3 gap-3">
                                                            <div className="bg-emerald-50 rounded-lg p-3 text-center">
                                                                <div className="text-xs text-slate-500">This Week</div>
                                                                <div className="text-lg font-bold text-emerald-600">£{(contractor.earningsThisWeekPence / 100).toFixed(0)}</div>
                                                            </div>
                                                            <div className="bg-emerald-50 rounded-lg p-3 text-center">
                                                                <div className="text-xs text-slate-500">This Month</div>
                                                                <div className="text-lg font-bold text-emerald-600">£{(contractor.earningsThisMonthPence / 100).toFixed(0)}</div>
                                                            </div>
                                                            <div className="bg-slate-50 rounded-lg p-3 text-center">
                                                                <div className="text-xs text-slate-500">All Time</div>
                                                                <div className="text-lg font-bold text-slate-700">£{(contractor.earningsAllTimePence / 100).toFixed(0)}</div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Margin Health */}
                                                    {contractor.avgMarginPercent != null && (
                                                        <div>
                                                            <h4 className="font-semibold text-sm mb-2">Margin Health</h4>
                                                            <div className="flex items-center gap-4">
                                                                <div>Avg Margin: <span className={contractor.avgMarginPercent >= 25 ? 'text-green-600' : contractor.avgMarginPercent >= 15 ? 'text-amber-600' : 'text-red-600'}>{contractor.avgMarginPercent}%</span></div>
                                                                {contractor.quotesWithThinMargin > 0 && <Badge variant="destructive">{contractor.quotesWithThinMargin} thin margin quotes</Badge>}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Insurance & Stripe Status */}
                                                    <div>
                                                        <h4 className="font-semibold text-sm mb-2">Verification & Payments</h4>
                                                        <div className="flex gap-4">
                                                            <div className="flex items-center gap-1">
                                                                {contractor.insuranceUrl ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                                                                <span className="text-sm">Insurance</span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                {contractor.stripeConnectId ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                                                                <span className="text-sm">Stripe</span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                {contractor.verificationStatus === 'verified' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-amber-500" />}
                                                                <span className="text-sm">{contractor.verificationStatus || 'Unverified'}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Stale Availability Warning */}
                                                    {contractor.isStaleAvailability && (
                                                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
                                                            <AlertTriangle className="w-4 h-4" />
                                                            Availability not updated in over 7 days. Last refreshed: {contractor.lastAvailabilityRefresh ? new Date(contractor.lastAvailabilityRefresh).toLocaleDateString() : 'Never'}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </>
                            ))}
                        </TableBody>
                    </Table>

                    {filteredContractors?.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            No contractors found
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Form Dialog (Create / Edit) */}
            <ContractorFormPanel
                open={formOpen}
                onOpenChange={setFormOpen}
                editingContractor={editingContractor}
            />

            {/* Deactivate Confirmation */}
            <DeactivateDialog
                open={deactivateOpen}
                onOpenChange={setDeactivateOpen}
                contractor={deactivatingContractor}
            />
        </div>
    );
}
