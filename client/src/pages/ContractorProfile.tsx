import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    User,
    Phone,
    MapPin,
    Mail,
    Save,
    Lock,
    ArrowLeft,
    LogOut,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Globe,
    Share2,
    Copy,
    ExternalLink,
    Upload,
    X
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface ContractorProfile {
    user: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        role: string;
        emailVerified: boolean;
    };
    profile: {
        id: string;
        bio: string | null;
        address: string | null;
        city: string | null;
        postcode: string | null;
        radiusMiles: number;
        slug: string | null;
        publicProfileEnabled: boolean;
        heroImageUrl: string | null;
        socialLinks: {
            instagram?: string;
            linkedin?: string;
            website?: string;
        } | null;
    } | null;
}

export default function ContractorProfile() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Check auth on mount
    useEffect(() => {
        const token = localStorage.getItem('contractorToken');
        if (!token) {
            setLocation('/contractor/login');
        }
    }, [setLocation]);

    // Fetch profile data
    const { data, isLoading: isProfileLoading } = useQuery<ContractorProfile>({
        queryKey: ['contractor-profile'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                if (res.status === 401) {
                    setLocation('/contractor/login');
                    throw new Error('Unauthorized');
                }
                throw new Error('Failed to fetch profile');
            }
            return res.json();
        },
    });

    // Form state
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
        instagram: '',
        linkedin: '',
        website: ''
    });

    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
    });

    // Update form data when profile loads
    useEffect(() => {
        if (data) {
            setFormData({
                firstName: data.user.firstName || '',
                lastName: data.user.lastName || '',
                phone: data.user.phone || '',
                bio: data.profile?.bio || '',
                address: data.profile?.address || '',
                city: data.profile?.city || '',
                postcode: data.profile?.postcode || '',
                radiusMiles: data.profile?.radiusMiles || 10,
                slug: data.profile?.slug || '',
                publicProfileEnabled: data.profile?.publicProfileEnabled || false,
                heroImageUrl: data.profile?.heroImageUrl || '',
                instagram: data.profile?.socialLinks?.instagram || '',
                linkedin: data.profile?.socialLinks?.linkedin || '',
                website: data.profile?.socialLinks?.website || '',
            });
        }
    }, [data]);

    // Update profile mutation
    const updateProfileMutation = useMutation({
        mutationFn: async (updatedData: any) => {
            const token = localStorage.getItem('contractorToken');

            // Format social links back to object
            const payload = {
                ...updatedData,
                socialLinks: {
                    instagram: updatedData.instagram,
                    linkedin: updatedData.linkedin,
                    website: updatedData.website
                }
            };

            const res = await fetch('/api/contractor/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('Failed to update profile');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-profile'] });
            toast({
                title: "Profile Updated",
                description: "Your changes have been saved successfully.",
            });
        },
        onError: () => {
            toast({
                title: "Update Failed",
                description: "Could not save changes. Please try again.",
                variant: "destructive",
            });
        }
    });

    // Upload image mutation
    const uploadImageMutation = useMutation({
        mutationFn: async (file: File) => {
            const token = localStorage.getItem('contractorToken');
            const formData = new FormData();
            formData.append('heroImage', file);

            const res = await fetch('/api/contractor/media/hero-upload', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                    // Do not set Content-Type header when sending FormData, browser does it automatically with boundary
                },
                body: formData,
            });

            if (!res.ok) throw new Error('Failed to upload image');
            return res.json();
        },
        onSuccess: (data) => {
            setFormData(prev => ({ ...prev, heroImageUrl: data.url }));
            toast({ title: "Image Uploaded", description: "Hero image uploaded successfully." });
        },
        onError: () => {
            toast({ title: "Upload Failed", description: "Could not upload image.", variant: "destructive" });
        }
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            uploadImageMutation.mutate(e.target.files[0]);
        }
    };


    // Change password mutation
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

    const handleProfileSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        updateProfileMutation.mutate(formData);
    };

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

    if (isProfileLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900">
            {/* Header */}
            <header className="bg-slate-800/50 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-4 sm:px-6">
                    <div className="flex items-center justify-between h-16">
                        <button
                            onClick={() => setLocation('/contractor')}
                            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            <span className="hidden sm:inline">Back to Dashboard</span>
                        </button>

                        <div className="flex items-center gap-3">
                            <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain" />
                            <span className="text-white font-semibold">My Profile</span>
                        </div>

                        <button
                            onClick={handleLogout}
                            className="p-2 text-slate-400 hover:text-white transition-colors"
                        >
                            <LogOut className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-20">
                <div className="grid gap-8">
                    {/* Personal Information */}
                    <section className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                                <User className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Personal Information</h2>
                                <p className="text-sm text-slate-400">Update your contact details</p>
                            </div>
                        </div>

                        <form onSubmit={handleProfileSubmit} className="p-6 space-y-6">
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">First Name</label>
                                    <input
                                        type="text"
                                        value={formData.firstName}
                                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Last Name</label>
                                    <input
                                        type="text"
                                        value={formData.lastName}
                                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                        <input
                                            type="email"
                                            value={data?.user.email}
                                            disabled
                                            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/30 border border-white/5 rounded-xl text-slate-400 cursor-not-allowed"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">Contact support to change email</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Phone Number</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Address</label>
                                <div className="relative">
                                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={2}
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
                                        placeholder="Street Address"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                <div className="col-span-1">
                                    <label className="block text-sm font-medium text-slate-300 mb-2">City</label>
                                    <input
                                        type="text"
                                        value={formData.city}
                                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Postcode</label>
                                    <input
                                        type="text"
                                        value={formData.postcode}
                                        onChange={(e) => setFormData({ ...formData, postcode: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Service Radius (Miles)</label>
                                    <input
                                        type="number"
                                        value={formData.radiusMiles}
                                        onChange={(e) => setFormData({ ...formData, radiusMiles: parseInt(e.target.value) || 0 })}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Bio / Introduction</label>
                                <textarea
                                    value={formData.bio}
                                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                                    rows={4}
                                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder:text-slate-600"
                                    placeholder="Tell customers a bit about yourself and your experience..."
                                />
                            </div>

                            <div className="pt-4 border-t border-white/5 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={updateProfileMutation.isPending}
                                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-white font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {updateProfileMutation.isPending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Save className="w-4 h-4" />
                                    )}
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </section>

                    {/* Public Profile Settings */}
                    <section className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                                <Globe className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Public Profile</h2>
                                <p className="text-sm text-slate-400">Share your profile with clients</p>
                            </div>
                        </div>

                        <form onSubmit={handleProfileSubmit} className="p-6 space-y-6">
                            <div className="flex items-center justify-between p-4 bg-slate-900/30 rounded-xl border border-white/5">
                                <div>
                                    <h3 className="text-white font-medium">Enable Public Profile</h3>
                                    <p className="text-sm text-slate-400">Allow customers to view your profile page</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.publicProfileEnabled}
                                        onChange={(e) => setFormData({ ...formData, publicProfileEnabled: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>

                            {formData.publicProfileEnabled && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Profile Slug (URL)</label>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">handy.com/handy/</span>
                                                <input
                                                    type="text"
                                                    value={formData.slug}
                                                    onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                                                    className="w-full pl-36 pr-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                                    placeholder="your-name-location"
                                                />
                                            </div>
                                            {formData.slug && (
                                                <a
                                                    href={`/handy/${formData.slug}`}
                                                    target="_blank"
                                                    title="View Profile"
                                                    className="p-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white transition-colors"
                                                >
                                                    <ExternalLink className="w-5 h-5" />
                                                </a>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">Hero Image</label>

                                        {formData.heroImageUrl ? (
                                            <div className="relative w-full h-48 rounded-xl overflow-hidden mb-4 group">
                                                <img
                                                    src={formData.heroImageUrl}
                                                    alt="Hero"
                                                    className="w-full h-full object-cover"
                                                />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, heroImageUrl: '' })}
                                                        className="p-2 bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
                                                    >
                                                        <X className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-700 rounded-xl hover:border-emerald-500/50 hover:bg-slate-800/50 transition-all cursor-pointer group">
                                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                                    <Upload className="w-8 h-8 text-slate-500 group-hover:text-emerald-500 mb-2 transition-colors" />
                                                    <p className="mb-2 text-sm text-slate-400 group-hover:text-slate-300"><span className="font-semibold">Click to upload</span> hero image</p>
                                                    <p className="text-xs text-slate-500">SVG, PNG, JPG or GIF (MAX. 5MB)</p>
                                                </div>
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept="image/*"
                                                    onChange={handleFileChange}
                                                    disabled={uploadImageMutation.isPending}
                                                />
                                            </label>
                                        )}
                                        {uploadImageMutation.isPending && <p className="text-sm text-emerald-500 mt-2 animate-pulse">Uploading...</p>}
                                    </div>

                                    <div className="grid md:grid-cols-3 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">Website</label>
                                            <input
                                                type="url"
                                                value={formData.website}
                                                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                                                className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                                placeholder="https://"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">Instagram</label>
                                            <input
                                                type="url"
                                                value={formData.instagram}
                                                onChange={(e) => setFormData({ ...formData, instagram: e.target.value })}
                                                className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                                placeholder="Profile URL"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">LinkedIn</label>
                                            <input
                                                type="url"
                                                value={formData.linkedin}
                                                onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
                                                className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                                placeholder="Profile URL"
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-4 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={updateProfileMutation.isPending}
                                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
                                        >
                                            {updateProfileMutation.isPending ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Save className="w-4 h-4" />
                                            )}
                                            Save Public Profile
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!formData.publicProfileEnabled && (
                                <div className="pt-4 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={updateProfileMutation.isPending}
                                        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-white font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                        <Save className="w-4 h-4" /> Save Changes
                                    </button>
                                </div>
                            )}
                        </form>
                    </section>

                    {/* Services & Rates */}
                    <section className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-500">
                                <CheckCircle2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Services & Rates</h2>
                                <p className="text-sm text-slate-400">Manage your skills and pricing</p>
                            </div>
                        </div>
                        <div className="p-8 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
                                <CheckCircle2 className="w-8 h-8 text-slate-600" />
                            </div>
                            <h3 className="text-white font-medium mb-2">Rate Cards Coming Soon</h3>
                            <p className="text-slate-400 max-w-md mx-auto">
                                We are building a dedicated editor for you to manage your hourly rates, day rates, and specific service pricing.
                            </p>
                            <button className="mt-6 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors">
                                View Current Rate Card
                            </button>
                        </div>
                    </section>

                    {/* Media Gallery */}
                    <section className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-500">
                                <Upload className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Work Gallery</h2>
                                <p className="text-sm text-slate-400">Showcase your best work</p>
                            </div>
                        </div>
                        <div className="p-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="aspect-square bg-slate-800 rounded-xl border border-white/5 flex items-center justify-center">
                                        <div className="w-full h-full bg-slate-900/50 flex items-center justify-center text-slate-600">
                                            <Upload className="w-6 h-6 opacity-20" />
                                        </div>
                                    </div>
                                ))}
                                <button className="aspect-square bg-slate-800/50 hover:bg-slate-800 rounded-xl border-2 border-dashed border-slate-700 hover:border-purple-500/50 transition-colors flex flex-col items-center justify-center gap-2 group">
                                    <div className="p-2 bg-slate-900 rounded-full group-hover:bg-purple-500/20 transition-colors">
                                        <Upload className="w-4 h-4 text-slate-400 group-hover:text-purple-400" />
                                    </div>
                                    <span className="text-xs font-medium text-slate-400 group-hover:text-purple-400">Add Media</span>
                                </button>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 flex gap-3">
                                <AlertCircle className="w-5 h-5 text-purple-400 shrink-0" />
                                <div>
                                    <h4 className="text-sm font-medium text-purple-200">Pro Tip</h4>
                                    <p className="text-xs text-purple-300/80 mt-1">
                                        Contractors with at least 3 photos of their past work get 2x more booking requests.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>
                    {/* Change Password */}
                    <section className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-700/50 flex items-center justify-center text-slate-300">
                                <Lock className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">Security</h2>
                                <p className="text-sm text-slate-400">Change your password</p>
                            </div>
                        </div>

                        <form onSubmit={handlePasswordSubmit} className="p-6 space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Current Password</label>
                                <input
                                    type="password"
                                    value={passwordData.currentPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                    required
                                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                />
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">New Password</label>
                                    <input
                                        type="password"
                                        value={passwordData.newPassword}
                                        onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                        required
                                        minLength={8}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Confirm New Password</label>
                                    <input
                                        type="password"
                                        value={passwordData.confirmNewPassword}
                                        onChange={(e) => setPasswordData({ ...passwordData, confirmNewPassword: e.target.value })}
                                        required
                                        minLength={8}
                                        className="w-full px-4 py-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/5 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={changePasswordMutation.isPending}
                                    className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {changePasswordMutation.isPending ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <div className="w-4 h-4" />
                                    )}
                                    Update Password
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            </main >
        </div >
    );
}
