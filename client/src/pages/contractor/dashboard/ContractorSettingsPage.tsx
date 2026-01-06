import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
    Save, MapPin, ShieldCheck, Camera, Video, MessageCircle, Sparkles,
    Trash2, Plus, GripVertical, CheckCircle2, AlertCircle, LayoutTemplate, Upload, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

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
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Page Settings</h1>
                <Button onClick={() => setLocation('/contractor/dashboard')} variant="ghost" className="text-slate-400 hover:text-white">Done</Button>
            </header>

            <div className="max-w-3xl mx-auto p-6 space-y-12">

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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                {/* 2. TRUST BADGES */}
                <section>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-100">Trust Badges</h2>
                            <p className="text-sm text-slate-500">Highlight your credentials to win trust.</p>
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
                                        const newBadges = isSelected
                                            ? current.filter((b: string) => b !== badge)
                                            : [...current, badge];
                                        mutation.mutate({ trustBadges: newBadges });
                                    }}
                                    className={`p-3 rounded-xl border text-sm font-medium transition-all flex items-center gap-2 ${isSelected
                                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                        }`}
                                >
                                    {isSelected && <CheckCircle2 className="w-4 h-4" />}
                                    {badge}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <hr className="border-slate-800" />

                {/* 3. BEFORE & AFTER GALLERY */}
                <section>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                            <LayoutTemplate className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-100">Before & After Slider</h2>
                            <p className="text-sm text-slate-500">Showcase your transformations. These convert 3x better than static photos.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* List existing pairs */}
                        {(profile?.beforeAfterGallery || []).map((pair: any, idx: number) => (
                            <div key={idx} className="bg-slate-900 rounded-2xl p-4 border border-slate-800 flex items-center gap-4">
                                <div className="w-24 h-16 rounded-lg bg-slate-800 overflow-hidden relative">
                                    <img src={pair.before} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/50 text-[10px] text-center text-white">Before</div>
                                </div>
                                <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center">
                                    <span className="text-slate-500">→</span>
                                </div>
                                <div className="w-24 h-16 rounded-lg bg-slate-800 overflow-hidden relative">
                                    <img src={pair.after} className="absolute inset-0 w-full h-full object-cover" />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/50 text-[10px] text-center text-white">After</div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-300 truncate">{pair.caption}</p>
                                </div>
                                <Button
                                    variant="ghost" size="sm"
                                    onClick={() => {
                                        const newGallery = profile.beforeAfterGallery.filter((_: any, i: number) => i !== idx);
                                        mutation.mutate({ beforeAfterGallery: newGallery });
                                    }}
                                    className="text-red-400 hover:bg-slate-800"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}

                        {/* Add New - Dialog Trigger */}
                        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                            <DialogTrigger asChild>
                                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:border-slate-700 transition-colors cursor-pointer group">
                                    <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mb-3 group-hover:bg-slate-800">
                                        <Plus className="w-6 h-6 text-slate-500" />
                                    </div>
                                    <h3 className="text-slate-300 font-medium">Add Transformation Pair</h3>
                                    <p className="text-xs text-slate-500 mt-1">Upload 'Before' and 'After' shots</p>
                                </div>
                            </DialogTrigger>
                            <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>Add Transformation</DialogTitle>
                                </DialogHeader>

                                <div className="space-y-4 py-4">
                                    {/* Before Image Input */}
                                    <div className="space-y-2">
                                        <Label className="text-slate-400">Before Image</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => setBeforeFile(e.target.files?.[0] || null)}
                                                className="bg-slate-950 border-slate-800 text-slate-300 file:bg-slate-800 file:text-slate-300 file:border-0 file:rounded-md file:mr-4 file:px-4 file:py-2 hover:file:bg-slate-700"
                                            />
                                            {beforeFile && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                                        </div>
                                    </div>

                                    {/* After Image Input */}
                                    <div className="space-y-2">
                                        <Label className="text-slate-400">After Image</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => setAfterFile(e.target.files?.[0] || null)}
                                                className="bg-slate-950 border-slate-800 text-slate-300 file:bg-slate-800 file:text-slate-300 file:border-0 file:rounded-md file:mr-4 file:px-4 file:py-2 hover:file:bg-slate-700"
                                            />
                                            {afterFile && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                                        </div>
                                    </div>

                                    {/* Caption Input */}
                                    <div className="space-y-2">
                                        <Label className="text-slate-400">Caption (What did you do?)</Label>
                                        <Input
                                            value={caption}
                                            onChange={(e) => setCaption(e.target.value)}
                                            placeholder="e.g. Full bathroom renovation"
                                            className="bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-slate-700"
                                        />
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button variant="ghost" onClick={() => setIsUploadOpen(false)} className="text-slate-400 hover:text-white hover:bg-slate-800">Cancel</Button>
                                    <Button
                                        onClick={handleGalleryUpload}
                                        disabled={!beforeFile || !afterFile || uploadStep === 'uploading'}
                                        className="bg-blue-600 hover:bg-blue-500 text-white"
                                    >
                                        {uploadStep === 'uploading' ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Uploading...
                                            </>
                                        ) : (
                                            'Save Transformation'
                                        )}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </section>

                <hr className="border-slate-800" />

                {/* 4. AI RULEBOOK */}
                <section>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-100">AI Quote Rules</h2>
                            <p className="text-sm text-slate-500">Train your AI to filter jobs effectively.</p>
                        </div>
                    </div>

                    <div className="space-y-4 bg-slate-900 rounded-2xl p-6 border border-slate-800">
                        {/* Remove Rubbish */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-slate-200">Remove Rubbish</h3>
                                <p className="text-xs text-slate-500">Do you take waste to the tip?</p>
                            </div>
                            <Switch
                                checked={profile?.aiRules?.removeRubbish ?? false}
                                onCheckedChange={(c) => mutation.mutate({
                                    aiRules: { ...profile?.aiRules, removeRubbish: c }
                                })}
                            />
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Supply Materials */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-slate-200">Supply Materials</h3>
                                <p className="text-xs text-slate-500">Can you buy parts upfront?</p>
                            </div>
                            <Switch
                                checked={profile?.aiRules?.supplyMaterials ?? true}
                                onCheckedChange={(c) => mutation.mutate({
                                    aiRules: { ...profile?.aiRules, supplyMaterials: c }
                                })}
                            />
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Minimum Charge */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-slate-200">Minimum Callout</h3>
                                <p className="text-xs text-slate-500">Lowest job value you'll accept (GBP)</p>
                            </div>
                            <input
                                type="number"
                                className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-right text-sm"
                                defaultValue={profile?.aiRules?.minCallout || 50}
                                onBlur={(e) => mutation.mutate({
                                    aiRules: { ...profile?.aiRules, minCallout: parseInt(e.target.value) }
                                })}
                            />
                        </div>
                    </div>
                </section>

                <hr className="border-slate-800" />

                {/* 6. VIDEO HANDSHAKE */}
                {/* 5. VERIFICATION DOCUMENTS */}
                <section>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-slate-100">Verification Documents</h2>
                                {profile?.verificationStatus === 'verified' && (
                                    <span className="text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">VERIFIED</span>
                                )}
                            </div>
                            <p className="text-sm text-slate-500">Upload documents to get the "Handy Verified" badge.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Insurance */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-white">Public Liability Insurance</h3>
                                    {profile?.publicLiabilityExpiryDate && (
                                        <p className="text-xs text-slate-400 mt-1">
                                            Expires: {new Date(profile.publicLiabilityExpiryDate).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>
                                {profile?.publicLiabilityInsuranceUrl ? (
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-amber-500" />
                                )}
                            </div>

                            <div className="space-y-3">
                                {profile?.publicLiabilityInsuranceUrl && (
                                    <a href={profile.publicLiabilityInsuranceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                                        <FileText className="w-3 h-3" /> View Document
                                    </a>
                                )}
                                <div className="relative">
                                    <Input
                                        type="file"
                                        accept=".pdf,image/*"
                                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const expiry = prompt("Please enter expiry date (YYYY-MM-DD)", new Date().toISOString().split('T')[0]);
                                                if (expiry) handleVerificationUpload(file, 'insurance', expiry);
                                            }
                                        }}
                                    />
                                    <Button variant="outline" className="w-full border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                                        <Upload className="w-4 h-4 mr-2" />
                                        {profile?.publicLiabilityInsuranceUrl ? 'Update Insurance' : 'Upload Insurance'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* DBS Check */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="font-bold text-white">DBS Check</h3>
                                {profile?.dbsCertificateUrl ? (
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-amber-500" />
                                )}
                            </div>
                            <div className="space-y-3">
                                {profile?.dbsCertificateUrl && (
                                    <a href={profile.dbsCertificateUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                                        <FileText className="w-3 h-3" /> View Document
                                    </a>
                                )}
                                <div className="relative">
                                    <Input
                                        type="file"
                                        accept=".pdf,image/*"
                                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleVerificationUpload(file, 'dbs');
                                        }}
                                    />
                                    <Button variant="outline" className="w-full border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                                        <Upload className="w-4 h-4 mr-2" />
                                        {profile?.dbsCertificateUrl ? 'Update DBS' : 'Upload DBS'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Identity */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="font-bold text-white">Identity Document</h3>
                                {profile?.identityDocumentUrl ? (
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-amber-500" />
                                )}
                            </div>
                            <div className="space-y-3">
                                {profile?.identityDocumentUrl && (
                                    <a href={profile.identityDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                                        <FileText className="w-3 h-3" /> View Document
                                    </a>
                                )}
                                <div className="relative">
                                    <Input
                                        type="file"
                                        accept=".pdf,image/*"
                                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleVerificationUpload(file, 'identity');
                                        }}
                                    />
                                    <Button variant="outline" className="w-full border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                                        <Upload className="w-4 h-4 mr-2" />
                                        {profile?.identityDocumentUrl ? 'Update ID' : 'Upload ID'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <hr className="border-slate-800" />

                {/* 6. VIDEO HANDSHAKE */}
                <section>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-500">
                            <Video className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-100">Video Handshake</h2>
                            <p className="text-sm text-slate-500">A 30-second personal intro video.</p>
                        </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                        <div className="w-16 h-16 bg-slate-800 rounded-full mx-auto flex items-center justify-center mb-4">
                            <Camera className="w-8 h-8 text-slate-500" />
                        </div>
                        <h3 className="text-slate-300 font-medium mb-2">Record Intro Video</h3>
                        <p className="text-slate-500 text-xs mb-6 max-w-xs mx-auto">Introduce yourself, your trade, and your area. Keep it friendly!</p>
                        <Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">
                            Open Camera App
                        </Button>
                    </div>
                </section>

                <div className="h-20" /> {/* Spacing */}
            </div>
        </div>
    );
}
