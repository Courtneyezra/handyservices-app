import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Plus, GripVertical, CheckCircle2, AlertCircle, LayoutTemplate, Upload, FileText,
    Globe, Share2, Copy, ExternalLink, Video, User, Star, Phone, Mail, Lock, LogOut, X,
    ShieldCheck, Sparkles, MessageCircle, Save, Trash2, Loader2, ArrowRight, Camera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { RateCardEditor } from "@/components/contractor/RateCardEditor";

// Helper to update profile
async function updateProfile(data: any) {
    const token = localStorage.getItem('contractorToken');
    const res = await fetch('/api/contractor/profile', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update profile');
    return res.json();
}

export default function ContractorSettingsPage() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch Profile
    const { data: profileData, isLoading } = useQuery({
        queryKey: ['contractor-profile'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
    });

    const profile = profileData?.profile;

    // Mutation
    const mutation = useMutation({
        mutationFn: updateProfile,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-profile'] });
            toast({ title: "Saved", description: "Your settings have been updated." });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
        }
    });

    const [activeTab, setActiveTab] = useState('general');

    // Profile Form State (Ported from ContractorProfile)
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        phone: '',
        bio: '',
        address: '',
        city: '',
        postcode: '',
        radiusMiles: 10,
        slug: '',
        publicProfileEnabled: false,
        heroImageUrl: '',
        whatsappNumber: '',
        instagram: '',
        linkedin: '',
        website: '',
        mediaGallery: [] as { type: 'image' | 'video'; url: string; caption?: string }[],
        reviews: [] as { id: string; author: string; rating: number; date: string; text: string; source?: string }[],
    });
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
    });

    const changePasswordMutation = useMutation({
        mutationFn: async (passData: any) => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    currentPassword: passData.currentPassword,
                    newPassword: passData.newPassword,
                }),
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to change password');
            return result;
        },
        onSuccess: () => {
            setPasswordData({
                currentPassword: '',
                newPassword: '',
                confirmNewPassword: '',
            });
            toast({
                title: "Password Changed",
                description: "Your password has been updated successfully.",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Password Change Failed",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    const handlePasswordSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (passwordData.newPassword !== passwordData.confirmNewPassword) {
            toast({
                title: "Passwords do not match",
                description: "New password and confirmation must match.",
                variant: "destructive",
            });
            return;
        }
        if (passwordData.newPassword.length < 8) {
            toast({
                title: "Password too short",
                description: "New password must be at least 8 characters.",
                variant: "destructive",
            });
            return;
        }
        changePasswordMutation.mutate(passwordData);
    };

    const handleLogout = () => {
        const token = localStorage.getItem('contractorToken');
        if (token) {
            fetch('/api/contractor/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        }
        localStorage.removeItem('contractorToken');
        localStorage.removeItem('contractorUser');
        localStorage.removeItem('contractorProfileId');
        setLocation('/contractor/login');
    };

    useEffect(() => {
        if (profile) {
            setFormData({
                firstName: profileData.user?.firstName || '',
                lastName: profileData.user?.lastName || '',
                phone: profileData.user?.phone || '',
                bio: profile.bio || '',
                address: profile.address || '',
                city: profile.city || '',
                postcode: profile.postcode || '',
                radiusMiles: profile.radiusMiles || 10,
                slug: profile.slug || '',
                publicProfileEnabled: profile.publicProfileEnabled || false,
                heroImageUrl: profile.heroImageUrl || '',
                whatsappNumber: profile.whatsappNumber || '',
                instagram: profile.socialLinks?.instagram || '',
                linkedin: profile.socialLinks?.linkedin || '',
                website: profile.socialLinks?.website || '',
                mediaGallery: profile.mediaGallery || [],
                reviews: profile.reviews || [],
            });
        }
    }, [profileData]);

    const handleProfileSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        await mutation.mutateAsync({
            ...formData,
            socialLinks: {
                instagram: formData.instagram,
                linkedin: formData.linkedin,
                website: formData.website
            }
        });
    };


    // Before/After Upload State
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [uploadStep, setUploadStep] = useState<'idle' | 'uploading'>('idle');
    const [beforeFile, setBeforeFile] = useState<File | null>(null);
    const [afterFile, setAfterFile] = useState<File | null>(null);
    const [caption, setCaption] = useState('');

    const handleGalleryUpload = async () => {
        if (!beforeFile || !afterFile) {
            toast({ title: "Missing files", description: "Please select both before and after images.", variant: "destructive" });
            return;
        }

        try {
            setUploadStep('uploading');
            const rawToken = localStorage.getItem('contractorToken') || '';
            // Sanitize token to remove potential invalid characters causing "string did not match expected pattern"
            const token = rawToken.trim().replace(/[^a-zA-Z0-9._-]/g, '');

            if (!token) {
                throw new Error('No authentication token found. Please log in again.');
            }

            // 1. Upload Before Image
            const beforeFormData = new FormData();
            beforeFormData.append('galleryImage', beforeFile);
            const beforeRes = await fetch('/api/contractor/media/gallery-upload', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: beforeFormData
            });
            if (!beforeRes.ok) {
                const err = await beforeRes.text();
                console.error("Before image upload failed:", err);
                throw new Error(`Before image upload failed: ${beforeRes.status} ${beforeRes.statusText}`);
            }
            const beforeData = await beforeRes.json();

            // 2. Upload After Image
            const afterFormData = new FormData();
            afterFormData.append('galleryImage', afterFile);
            const afterRes = await fetch('/api/contractor/media/gallery-upload', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: afterFormData
            });
            if (!afterRes.ok) {
                const err = await afterRes.text();
                console.error("After image upload failed:", err);
                throw new Error(`After image upload failed: ${afterRes.status} ${afterRes.statusText}`);
            }
            const afterData = await afterRes.json();

            // 3. Update Profile with new pair
            const newPair = {
                before: beforeData.url,
                after: afterData.url,
                caption: caption || 'Transformation'
            };

            const currentGallery = profile?.beforeAfterGallery || [];
            await mutation.mutateAsync({
                beforeAfterGallery: [...currentGallery, newPair]
            });

            // Cleanup
            setBeforeFile(null);
            setAfterFile(null);
            setCaption('');
            setIsUploadOpen(false);
            setUploadStep('idle');
            toast({ title: "Success", description: "Transformation added successfully!" });

        } catch (error: any) {
            console.error("Gallery upload error:", error);
            setUploadStep('idle');
            toast({
                title: "Upload Failed",
                description: error.message || "Failed to upload images.",
                variant: "destructive"
            });
        }
    };



    // Verification Upload Handler
    const handleVerificationUpload = async (file: File, type: 'dbs' | 'identity' | 'insurance', expiryDate?: string) => {
        try {
            const formData = new FormData();
            formData.append('document', file);

            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/media/verification-upload', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });

            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();

            // Update profile
            const updates: any = {};
            if (type === 'dbs') updates.dbsCertificateUrl = data.url;
            if (type === 'identity') updates.identityDocumentUrl = data.url;
            if (type === 'insurance') {
                updates.publicLiabilityInsuranceUrl = data.url;
                if (expiryDate) updates.publicLiabilityExpiryDate = new Date(expiryDate).toISOString();
            }

            // If all docs present (checking current profile + new update), set to pending
            const hasInsurance = updates.publicLiabilityInsuranceUrl || profile?.publicLiabilityInsuranceUrl;
            const hasDbs = updates.dbsCertificateUrl || profile?.dbsCertificateUrl;
            const hasId = updates.identityDocumentUrl || profile?.identityDocumentUrl;

            if (hasInsurance && hasDbs && hasId && profile?.verificationStatus === 'unverified') {
                updates.verificationStatus = 'pending';
            }

            await mutation.mutateAsync(updates);
            toast({ title: "Document Uploaded", description: `${type} uploaded successfully.` });

        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to upload document", variant: "destructive" });
        }
    };

    if (isLoading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Loading settings...</div>;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Settings</h1>
                <div className="flex items-center gap-4">
                    <Button
                        onClick={() => handleProfileSubmit()}
                        disabled={mutation.isPending}
                        className="bg-amber-500 hover:bg-amber-400 text-white"
                    >
                        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Save All
                    </Button>
                    <Button onClick={() => setLocation('/contractor/dashboard')} variant="ghost" className="text-slate-400 hover:text-white">Done</Button>
                </div>
            </header>

            <div className="max-w-5xl mx-auto p-4 lg:p-10">
                <div className="flex flex-col lg:flex-row gap-10">
                    {/* Sidebar Tabs */}
                    <aside className="lg:w-64 shrink-0">
                        <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto pb-4 lg:pb-0 scrollbar-hide">
                            {[
                                { id: 'general', label: 'Availability', icon: MessageCircle },
                                { id: 'profile', label: 'Public Profile', icon: Globe },
                                { id: 'services', label: 'Services & Rates', icon: CheckCircle2 },
                                { id: 'portfolio', label: 'Work Gallery', icon: LayoutTemplate },
                                { id: 'verification', label: 'Verification', icon: ShieldCheck },
                                { id: 'ai-rules', label: 'AI Rules', icon: Sparkles },
                                { id: 'security', label: 'Security', icon: Lock },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                                        ? 'bg-amber-500/10 text-amber-500 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
                                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                                        }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                    </aside>

                    {/* Main Content Area */}
                    <main className="flex-1 space-y-12">
                        {activeTab === 'general' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* 1. STATUS CONTROLLER */}
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                            <MessageCircle className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Live Availability</h2>
                                            <p className="text-sm text-slate-500">Control how customers contact you right now.</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        {[
                                            { value: 'available', label: 'Available', desc: 'Accept calls & messages', color: 'emerald' },
                                            { value: 'busy', label: 'On a Job', desc: 'Message only mode', color: 'amber' },
                                            { value: 'holiday', label: 'Away / Holiday', desc: 'Waitlist mode', color: 'slate' }
                                        ].map((mode) => (
                                            <button
                                                key={mode.value}
                                                onClick={() => mutation.mutate({ availabilityStatus: mode.value })}
                                                className={`p-4 rounded-xl border text-left transition-all ${profile?.availabilityStatus === mode.value
                                                    ? `bg-${mode.color}-500/10 border-${mode.color}-500/50 ring-1 ring-${mode.color}-500/50`
                                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                                    }`}
                                            >
                                                <div className={`font-bold text-${mode.color === 'slate' ? 'slate-200' : mode.color + '-400'}`}>{mode.label}</div>
                                                <div className="text-xs text-slate-500 mt-1">{mode.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </section>

                                <hr className="border-slate-800" />

                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                            <Phone className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Direct Contact</h2>
                                            <p className="text-sm text-slate-500">Set specific numbers for customer outreach.</p>
                                        </div>
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">WhatsApp Number (CTA)</label>
                                            <div className="relative">
                                                <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                                                <input
                                                    type="tel"
                                                    value={formData.whatsappNumber}
                                                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                                                    placeholder="Defaults to Phone Number if empty"
                                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-500 transition-colors"
                                                />
                                            </div>
                                            <p className="text-[10px] text-slate-600 mt-2">Overrides main phone for the 'WhatsApp Me' button on your profile.</p>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'profile' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                            <Globe className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Profile Content</h2>
                                            <p className="text-sm text-slate-500">Manage how you appear to customers.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-8 bg-slate-900/50 p-6 sm:p-8 rounded-2xl border border-slate-800">
                                        <div className="flex items-center justify-between p-4 bg-slate-950 rounded-xl border border-slate-800">
                                            <div>
                                                <h3 className="font-medium text-slate-200">Public Profile Enabled</h3>
                                                <p className="text-xs text-slate-500">Turn your profile link on/off</p>
                                            </div>
                                            <Switch
                                                checked={formData.publicProfileEnabled}
                                                onCheckedChange={(c) => setFormData({ ...formData, publicProfileEnabled: c })}
                                            />
                                        </div>

                                        <div className="grid md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Username / Handle</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm">handy.com/</span>
                                                    <input
                                                        type="text"
                                                        value={formData.slug}
                                                        onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                                                        className="w-full pl-24 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                        placeholder="your-name"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Service Area (City)</label>
                                                <input
                                                    type="text"
                                                    value={formData.city}
                                                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                    placeholder="London, Bristol, etc."
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Bio / About Me</label>
                                            <textarea
                                                value={formData.bio}
                                                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                                                rows={4}
                                                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                placeholder="What makes you the best person for the job?"
                                            />
                                        </div>

                                        <div className="grid md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Website</label>
                                                <input
                                                    type="url"
                                                    value={formData.website}
                                                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                    placeholder="https://"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Instagram</label>
                                                    <input
                                                        type="text"
                                                        value={formData.instagram}
                                                        onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                                                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                        placeholder="@handle"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500 uppercase mb-2">LinkedIn</label>
                                                    <input
                                                        type="text"
                                                        value={formData.linkedin}
                                                        onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
                                                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                        placeholder="Profile Link"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <hr className="border-slate-800" />

                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Cover Photo</label>
                                            <div className="aspect-[21/9] bg-slate-950 rounded-xl border-2 border-dashed border-slate-800 overflow-hidden group relative">
                                                {formData.heroImageUrl ? (
                                                    <img src={formData.heroImageUrl} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600">
                                                        <Camera className="w-8 h-8 mb-2" />
                                                        <span className="text-xs">Click to upload banner</span>
                                                    </div>
                                                )}
                                                <input
                                                    type="file"
                                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                                    onChange={async (e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        const token = localStorage.getItem('contractorToken');
                                                        const fd = new FormData();
                                                        fd.append('heroImage', file);
                                                        const res = await fetch('/api/contractor/media/hero-upload', {
                                                            method: 'POST',
                                                            headers: { Authorization: `Bearer ${token}` },
                                                            body: fd
                                                        });
                                                        if (res.ok) {
                                                            const d = await res.json();
                                                            setFormData(f => ({ ...f, heroImageUrl: d.url }));
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'services' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                            <CheckCircle2 className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Services & Rates</h2>
                                            <p className="text-sm text-slate-500">Manage your skills and hourly pricing.</p>
                                        </div>
                                    </div>
                                    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                                        <RateCardEditor />
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'portfolio' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                                            <LayoutTemplate className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Project Portfolio</h2>
                                            <p className="text-sm text-slate-500">Showcase your best transformations.</p>
                                        </div>
                                    </div>

                                    {/* Work Gallery */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
                                        {formData.mediaGallery.map((img, i) => (
                                            <div key={i} className="aspect-square bg-slate-900 rounded-xl border border-slate-800 overflow-hidden relative group">
                                                <img src={img.url} className="w-full h-full object-cover" />
                                                <button
                                                    onClick={() => {
                                                        const g = [...formData.mediaGallery];
                                                        g.splice(i, 1);
                                                        setFormData({ ...formData, mediaGallery: g });
                                                    }}
                                                    className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <Trash2 className="w-3 h-3 text-white" />
                                                </button>
                                            </div>
                                        ))}
                                        <label className="aspect-square bg-slate-900 border-2 border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-slate-700 transition-all">
                                            <Plus className="w-6 h-6 text-slate-600" />
                                            <span className="text-[10px] text-slate-600 mt-2 font-bold uppercase tracking-widest">Add View</span>
                                            <input
                                                type="file" className="hidden"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;
                                                    const token = localStorage.getItem('contractorToken');
                                                    const fd = new FormData();
                                                    fd.append('galleryImage', file);
                                                    const res = await fetch('/api/contractor/media/gallery-upload', {
                                                        method: 'POST',
                                                        headers: { Authorization: `Bearer ${token}` },
                                                        body: fd
                                                    });
                                                    if (res.ok) {
                                                        const d = await res.json();
                                                        setFormData(f => ({ ...f, mediaGallery: [...f.mediaGallery, { type: 'image', url: d.url }] }));
                                                    }
                                                }}
                                            />
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-4">
                                            <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                                Manual Reviews
                                            </h3>
                                            <div className="space-y-4">
                                                {formData.reviews.map((r, i) => (
                                                    <div key={i} className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3">
                                                        <div className="flex justify-between items-start">
                                                            <input
                                                                value={r.author}
                                                                onChange={(e) => {
                                                                    const rs = [...formData.reviews];
                                                                    rs[i].author = e.target.value;
                                                                    setFormData({ ...formData, reviews: rs });
                                                                }}
                                                                className="bg-transparent text-sm font-bold text-white focus:outline-none"
                                                            />
                                                            <button onClick={() => {
                                                                const rs = [...formData.reviews];
                                                                rs.splice(i, 1);
                                                                setFormData({ ...formData, reviews: rs });
                                                            }} className="text-slate-600 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                                        </div>
                                                        <textarea
                                                            value={r.text}
                                                            onChange={(e) => {
                                                                const rs = [...formData.reviews];
                                                                rs[i].text = e.target.value;
                                                                setFormData({ ...formData, reviews: rs });
                                                            }}
                                                            className="w-full bg-transparent text-xs text-slate-400 focus:outline-none resize-none"
                                                            rows={2}
                                                        />
                                                    </div>
                                                ))}
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setFormData({ ...formData, reviews: [...formData.reviews, { id: Math.random().toString(), author: 'Customer Name', text: 'Excellent work!', rating: 5, date: new Date().toISOString() }] })}
                                                    className="w-full border-slate-800 text-slate-400"
                                                >
                                                    Add Review
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="font-bold text-slate-100 flex items-center gap-2">
                                                <CheckCircle2 className="w-4 h-4 text-sky-500" />
                                                Transformations
                                            </h3>
                                            <div className="space-y-4">
                                                {(profile?.beforeAfterGallery || []).map((p: any, i: number) => (
                                                    <div key={i} className="bg-slate-900 border border-slate-800 p-2 rounded-xl flex items-center gap-3">
                                                        <img src={p.before} className="w-12 h-12 rounded object-cover" />
                                                        <ArrowRight className="w-3 h-3 text-slate-600" />
                                                        <img src={p.after} className="w-12 h-12 rounded object-cover" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[10px] text-slate-400 truncate">{p.caption}</p>
                                                        </div>
                                                        <button onClick={() => {
                                                            const g = profile.beforeAfterGallery.filter((_: any, idx: number) => idx !== i);
                                                            mutation.mutate({ beforeAfterGallery: g });
                                                        }} className="p-2 text-slate-600 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                                    </div>
                                                ))}
                                                <Button variant="outline" onClick={() => setIsUploadOpen(true)} className="w-full border-slate-800 text-slate-400">Add Transformation</Button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'verification' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                            <ShieldCheck className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Verification</h2>
                                            <p className="text-sm text-slate-500">Complete these to get your Verified Badge.</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {[
                                            { id: 'insurance', label: 'Public Liability', type: 'Insurance', url: profile?.publicLiabilityInsuranceUrl },
                                            { id: 'dbs', label: 'DBS Check', type: 'DBS', url: profile?.dbsCertificateUrl },
                                            { id: 'identity', label: 'ID Verification', type: 'Identity', url: profile?.identityDocumentUrl },
                                        ].map((doc) => (
                                            <div key={doc.id} className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 flex flex-col items-center text-center space-y-4">
                                                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${doc.url ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-800 text-slate-600'}`}>
                                                    {doc.url ? <CheckCircle2 className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-sm text-white">{doc.label}</h3>
                                                    <p className="text-[10px] text-slate-500 mt-1">{doc.url ? 'Successfully Uploaded' : 'Action Required'}</p>
                                                </div>
                                                <input
                                                    type="file" id={doc.id} className="hidden"
                                                    onChange={(e) => {
                                                        const f = e.target.files?.[0];
                                                        if (f) handleVerificationUpload(f, doc.id as any);
                                                    }}
                                                />
                                                <Button
                                                    variant="secondary" size="sm"
                                                    className="w-full h-8 text-xs font-bold"
                                                    onClick={() => document.getElementById(doc.id)?.click()}
                                                >
                                                    {doc.url ? 'Replace' : 'Upload'}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <hr className="border-slate-800" />

                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                            <ShieldCheck className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Trust Badges</h2>
                                            <p className="text-sm text-slate-500">Quick-read icons for your profile.</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {['DBS Checked', 'Insured', 'City & Guilds', 'Dog Friendly', 'Boot Covers', 'Non-Smoker', 'Quick Reply', 'Warranty'].map((badge) => {
                                            const isSelected = (profile?.trustBadges || []).includes(badge);
                                            return (
                                                <button
                                                    key={badge}
                                                    onClick={() => {
                                                        const current = profile?.trustBadges || [];
                                                        const newBadges = isSelected ? current.filter((b: string) => b !== badge) : [...current, badge];
                                                        mutation.mutate({ trustBadges: newBadges });
                                                    }}
                                                    className={`p-3 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 ${isSelected
                                                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                                                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'
                                                        }`}
                                                >
                                                    {isSelected && <CheckCircle2 className="w-3 h-3" />}
                                                    {badge}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'ai-rules' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                            <Sparkles className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">AI Logic Settings</h2>
                                            <p className="text-sm text-slate-500">How our AI should screen and quote jobs.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-4 bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="font-medium text-slate-200">Remove Rubbish</h3>
                                                <p className="text-xs text-slate-500">Include waste removal in quotes?</p>
                                            </div>
                                            <Switch
                                                checked={profile?.aiRules?.removeRubbish ?? false}
                                                onCheckedChange={(c) => mutation.mutate({
                                                    aiRules: { ...profile?.aiRules, removeRubbish: c }
                                                })}
                                            />
                                        </div>
                                        <div className="h-px bg-slate-800" />
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="font-medium text-slate-200">Supply Materials</h3>
                                                <p className="text-xs text-slate-500">Quote including parts & materials?</p>
                                            </div>
                                            <Switch
                                                checked={profile?.aiRules?.supplyMaterials ?? true}
                                                onCheckedChange={(c) => mutation.mutate({
                                                    aiRules: { ...profile?.aiRules, supplyMaterials: c }
                                                })}
                                            />
                                        </div>
                                        <div className="h-px bg-slate-800" />
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="font-medium text-slate-200">Minimum Callout Fee</h3>
                                                <p className="text-xs text-slate-500">Smallest job value accepted (£)</p>
                                            </div>
                                            <input
                                                type="number" className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-right text-sm"
                                                defaultValue={profile?.aiRules?.minCallout || 50}
                                                onBlur={(e) => mutation.mutate({ aiRules: { ...profile?.aiRules, minCallout: parseInt(e.target.value) } })}
                                            />
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}
                        {activeTab === 'security' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <section>
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
                                            <Lock className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-100">Security</h2>
                                            <p className="text-sm text-slate-500">Manage your password and account session.</p>
                                        </div>
                                    </div>

                                    <div className="max-w-md space-y-6 bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                                        <form onSubmit={handlePasswordSubmit} className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Current Password</label>
                                                <input
                                                    type="password"
                                                    value={passwordData.currentPassword}
                                                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">New Password</label>
                                                <input
                                                    type="password"
                                                    value={passwordData.newPassword}
                                                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Confirm New Password</label>
                                                <input
                                                    type="password"
                                                    value={passwordData.confirmNewPassword}
                                                    onChange={(e) => setPasswordData({ ...passwordData, confirmNewPassword: e.target.value })}
                                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                                                />
                                            </div>
                                            <Button
                                                type="submit"
                                                disabled={changePasswordMutation.isPending}
                                                className="w-full bg-slate-800 hover:bg-slate-700 text-white"
                                            >
                                                {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                                                Update Password
                                            </Button>
                                        </form>

                                        <hr className="border-slate-800 shadow-[0_1px_rgba(255,255,255,0.05)]" />

                                        <button
                                            onClick={handleLogout}
                                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors font-bold text-sm"
                                        >
                                            <LogOut className="w-4 h-4" />
                                            Sign Out of Session
                                        </button>
                                    </div>
                                </section>
                            </div>
                        )}
                    </main>
                </div>

                <div className="h-20" /> {/* Spacer */}
            </div>
        </div>
    );
}
