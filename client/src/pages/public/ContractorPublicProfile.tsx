import { useState, useEffect } from 'react';
import { useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
    MapPin, Share2, Star, ShieldCheck, Clock, Check,
    ArrowRight, MessageCircle, Sparkles, LayoutTemplate
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

// --- Types ---

interface PublicProfile {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    bio: string | null;
    city: string | null;
    postcode: string | null;
    phone: string | null;
    heroImageUrl: string | null;
    mediaGallery: { type: 'image' | 'video'; url: string; caption?: string }[];
    skills: string[];
    services: {
        id: string;
        name: string;
        description: string;
        pricePence: number;
        category: string;
    }[];
    radiusMiles: number;
    trustBadges?: string[];
    availabilityStatus?: 'available' | 'busy' | 'holiday';
    beforeAfterGallery?: { before: string; after: string; caption: string }[];
    whatsappNumber?: string | null;
    reviews?: { id: string; author: string; rating: number; date: string; text: string }[];
}

interface AvailabilitySlot {
    date: string;
    startTime: string;
    endTime: string;
}

// --- Component ---

export default function ContractorPublicProfile({ forcedSlug }: { forcedSlug?: string }) {
    const [, params] = useRoute('/handy/:slug');
    const slug = forcedSlug || params?.slug;
    const { toast } = useToast();

    // States
    const [isQuoteOpen, setIsQuoteOpen] = useState(false); // Rough Quote Modal
    const [scrolled, setScrolled] = useState(false);

    // Scroll listener for sticky header
    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 50);
        // Check initial position
        handleScroll();
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // 1. Fetch Profile
    const { data: profile, isLoading, error } = useQuery<PublicProfile>({
        queryKey: ['public-profile', slug],
        queryFn: async () => {
            if (!slug) throw new Error('No slug provided');
            const res = await fetch(`/api/public/contractor/${slug}`);
            if (!res.ok) {
                if (res.status === 404) throw new Error('Profile not found');
                throw new Error('Failed to fetch profile');
            }
            return res.json();
        },
        enabled: !!slug,
        retry: false
    });

    // 2. Fetch Availability
    const { data: availabilityData } = useQuery<{ availability: AvailabilitySlot[] }>({
        queryKey: ['public-availability', slug],
        queryFn: async () => {
            if (!slug) return { availability: [] };
            const res = await fetch(`/api/public/contractor/${slug}/availability`);
            if (!res.ok) throw new Error('Failed to fetch availability');
            return res.json();
        },
        enabled: !!slug
    });

    // --- Loading / Error States ---

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Profile Not Found</h1>
                <p className="text-slate-500">This contractor profile is strictly private or does not exist.</p>
            </div>
        );
    }

    // --- Handlers ---

    const handleWhatsAppClick = () => {
        const targetNumber = profile.whatsappNumber || profile.phone;
        if (!targetNumber) return;
        const phone = targetNumber.replace(/[^0-9]/g, '');
        const text = `Hi ${profile.firstName}, I found your profile on Handy. I'd like to discuss a job.`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    };

    const handleShareClick = () => {
        if (navigator.share) {
            navigator.share({
                title: `${profile.fullName} - Professional Handyman`,
                url: window.location.href
            }).catch(console.error);
        } else {
            navigator.clipboard.writeText(window.location.href);
            toast({ title: "Copied!", description: "Profile link copied to clipboard." });
        }
    };

    // --- Render ---

    const safeFirstName = profile.firstName || 'Pro';
    const safeInitial = safeFirstName[0] || 'H';

    const reviews = profile.reviews || [];
    const reviewCount = reviews.length;
    const averageRating = reviewCount > 0
        ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount).toFixed(1)
        : 'New';

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 selection:bg-amber-100">

            {/* Sticky Header */}
            <header className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-3' : 'bg-transparent py-4'}`}>
                <div className="max-w-md mx-auto px-4 flex items-center justify-between">
                    {scrolled ? (
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold text-sm">
                                {safeInitial}
                            </div>
                            <span className="font-bold text-slate-900 text-sm">{profile.fullName || 'Verified Pro'}</span>
                        </div>
                    ) : (
                        <span className="text-xs font-bold tracking-wider text-slate-500 uppercase bg-white/20 backdrop-blur-md px-2 py-1 rounded-full">
                            Verified Pro
                        </span>
                    )}

                    <button
                        onClick={handleShareClick}
                        className="w-10 h-10 rounded-full bg-white/80 hover:bg-white flex items-center justify-center text-slate-700 shadow-sm backdrop-blur-sm transition-all active:scale-95"
                    >
                        <Share2 className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Hero Section */}
            <div className="relative">
                {/* Background Image */}
                <div className="h-64 bg-slate-200 overflow-hidden relative">
                    {profile.heroImageUrl ? (
                        <img src={profile.heroImageUrl} alt="Background" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-b from-slate-700 to-slate-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-50 via-slate-50/20 to-transparent" />
                </div>

                {/* Content Sections */}
                <div className="max-w-md mx-auto px-4 -mt-20 relative z-10 text-center">
                    {/* Avatar */}
                    <div className="w-32 h-32 rounded-3xl bg-white p-1.5 shadow-xl mb-4 rotate-3 hover:rotate-0 transition-transform duration-300 mx-auto">
                        <div className="w-full h-full rounded-2xl bg-amber-500 flex items-center justify-center overflow-hidden relative">
                            {profile.heroImageUrl ? (
                                <img src={profile.heroImageUrl} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-5xl font-bold text-white shadow-sm">
                                    {(profile.firstName && profile.firstName[0]) || 'H'}
                                </span>
                            )}
                        </div>
                        {/* Verified Badge */}
                        <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-1.5 rounded-full border-4 border-white shadow-sm">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                    </div>

                    {/* Name & Bio */}
                    <h1 className="text-2xl font-bold text-slate-900 mb-1">{profile.fullName || 'Verified Pro'}</h1>
                    <div className="flex items-center justify-center gap-2 text-slate-500 text-sm mb-4">
                        <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4 text-amber-500" /> {profile.city || 'Local Area'}
                        </div>
                        <span className="w-1 h-1 rounded-full bg-slate-300" />
                        <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-amber-500 fill-amber-500" /> {averageRating} ({reviewCount} reviews)
                        </div>
                    </div>

                    {/* Bio Text */}
                    <p className="text-slate-600 text-sm leading-relaxed max-w-sm mx-auto mb-6 line-clamp-3">
                        {profile.bio || `Hi, I'm ${profile.firstName || 'a professional'}. I'm a professional tradesperson dedicated to high-quality work and happy customers. Let's get your job done right.`}
                    </p>

                    {/* Trust Badges */}
                    {profile.trustBadges && profile.trustBadges.length > 0 && (
                        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
                            {profile.trustBadges.map((badge) => (
                                <div key={badge} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/80 backdrop-blur-sm rounded-full border border-slate-200 shadow-sm">
                                    <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />
                                    <span className="text-xs font-semibold text-slate-700">{badge}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* MAIN ACTIONS (The "2025" Buttons) */}
                    <div className="w-full grid grid-cols-1 gap-3 mb-8">
                        {/* WhatsApp Primary */}
                        {profile.phone && (
                            <button
                                onClick={handleWhatsAppClick}
                                className="w-full py-4 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-2xl shadow-lg shadow-green-900/10 flex items-center justify-center gap-3 active:scale-[0.98] transition-all"
                            >
                                <MessageCircle className="w-6 h-6 fill-current" />
                                <span>WhatsApp Me</span>
                            </button>
                        )}

                        {/* AI Assistant Secondary */}
                        <button
                            onClick={() => setIsQuoteOpen(true)}
                            className="w-full py-4 bg-white border border-indigo-100 text-indigo-600 font-bold rounded-2xl shadow-sm hover:bg-indigo-50 flex items-center justify-center gap-3 active:scale-[0.98] transition-all relative overflow-hidden group"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-indigo-50 to-purple-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <Sparkles className="w-5 h-5 text-indigo-500 relative z-10" />
                            <span className="relative z-10">Get Rough Quote (AI)</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Sections */}
            <div className="max-w-md mx-auto px-4 space-y-8">

                {/* Before & After Transformations */}
                {profile.beforeAfterGallery && profile.beforeAfterGallery.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <LayoutTemplate className="w-5 h-5 text-indigo-500" />
                                Transformations
                            </h2>
                            <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-1 rounded-full">
                                {profile.beforeAfterGallery.length} Projects
                            </span>
                        </div>
                        <div className="space-y-4">
                            {profile.beforeAfterGallery.map((pair, idx) => (
                                <div key={idx} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
                                    <div className="grid grid-cols-2 gap-0.5">
                                        <div className="relative h-48 bg-slate-100 group">
                                            <img src={pair.before} alt="Before" className="w-full h-full object-cover" />
                                            <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md">BEFORE</div>
                                        </div>
                                        <div className="relative h-48 bg-slate-100 group">
                                            <img src={pair.after} alt="After" className="w-full h-full object-cover" />
                                            <div className="absolute top-2 right-2 bg-emerald-500/90 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm">AFTER</div>
                                        </div>
                                    </div>
                                    {pair.caption && (
                                        <div className="p-4 bg-white">
                                            <p className="text-sm font-medium text-slate-700">{pair.caption}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Media Gallery */}
                {profile.mediaGallery && profile.mediaGallery.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Work Portfolio</h2>
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                                {profile.mediaGallery.length} Photos
                            </span>
                        </div>
                        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
                            {profile.mediaGallery.map((media, idx) => (
                                <div key={idx} className="flex-shrink-0 w-64 h-48 rounded-2xl overflow-hidden bg-slate-200 border border-slate-100 shadow-sm snap-center relative group">
                                    {media.type === 'video' ? (
                                        <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
                                            <span>Video Placeholder</span>
                                        </div>
                                    ) : (
                                        <img src={media.url} alt={media.caption || `Work sample ${idx + 1}`} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                    )}
                                    {media.caption && (
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                                            <p className="text-white text-xs font-medium">{media.caption}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Services / Rate Card */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-slate-900">Services & Rates</h2>
                        <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            {profile.services?.length || 0} Active
                        </span>
                    </div>

                    <div className="space-y-3">
                        {profile.services && profile.services.length > 0 ? (
                            profile.services.map((service) => (
                                <div key={service.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between group active:scale-[0.99] transition-transform">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors">
                                            {/* Ideally dynamic icon based on category */}
                                            <Check className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-900 text-sm">{service.name}</h3>
                                            <p className="text-xs text-slate-500">{service.category || 'General'}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-slate-900">£{(service.pricePence / 100).toFixed(0)}</div>
                                        <div className="text-[10px] text-slate-400 font-medium">STARTING</div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            // Fallback Empty State
                            <div className="p-6 bg-white rounded-2xl border border-dashed border-slate-200 text-center">
                                <p className="text-sm text-slate-500">Contact me for custom service pricing.</p>
                            </div>
                        )}
                    </div>
                </section>

                {/* Availability Widget */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-slate-900">Next Available</h2>
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-100/50 rounded-full">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span className="text-[10px] font-bold text-emerald-700 tracking-wide uppercase">Live</span>
                        </div>
                    </div>

                    <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
                        {/* Decorative BG Blob */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

                        {availabilityData?.availability && availabilityData.availability.length > 0 ? (
                            <div className="relative z-10">
                                <p className="text-sm text-slate-500 mb-4">I have openings coming up in the next few days.</p>
                                <div className="space-y-2">
                                    {availabilityData.availability.slice(0, 3).map((slot, i) => (
                                        <button
                                            key={i}
                                            onClick={handleWhatsAppClick} // Direct to WhatsApp for booking
                                            className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition-colors group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="bg-white p-2 rounded-lg shadow-sm text-emerald-600 font-bold text-xs uppercase text-center w-12 leading-none">
                                                    {format(new Date(slot.date), 'MMM')}<br />
                                                    <span className="text-lg text-slate-900">{format(new Date(slot.date), 'd')}</span>
                                                </div>
                                                <div className="text-left">
                                                    <span className="block font-bold text-slate-700 text-sm group-hover:text-emerald-800">{format(new Date(slot.date), 'EEEE')}</span>
                                                    <span className="text-xs text-slate-500">{slot.startTime} Start</span>
                                                </div>
                                            </div>
                                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-4">
                                <p className="text-sm text-slate-500 mb-2">My calendar is fully booked for online requests.</p>
                                <button onClick={handleWhatsAppClick} className="text-emerald-600 font-bold text-sm hover:underline">Message to squeeze in</button>
                            </div>
                        )}
                    </div>
                </section>

                {/* Reviews List Section */}
                {reviewCount > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Recent Reviews</h2>
                            <div className="flex items-center gap-1">
                                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                <span className="font-bold text-slate-900">{averageRating}</span>
                                <span className="text-slate-400 text-sm">({reviewCount})</span>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {reviews.map((review, idx) => (
                                <div key={review.id || idx} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="font-bold text-slate-900 text-sm">{review.author}</div>
                                        <span className="text-xs text-slate-400">{review.date ? format(new Date(review.date), 'MMM d, yyyy') : ''}</span>
                                    </div>
                                    <div className="flex gap-0.5 mb-2">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <Star
                                                key={star}
                                                className={`w-3 h-3 ${star <= review.rating ? 'text-amber-500 fill-amber-500' : 'text-slate-200 fill-slate-200'}`}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-sm text-slate-600 leading-relaxed">{review.text}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}


                {/* Footer Brand */}
                <div className="pb-10 pt-4 text-center">
                    <p className="text-xs text-slate-400 font-medium flex items-center justify-center gap-1">
                        Powered by <Sparkles className="w-3 h-3 text-amber-500" /> <span className="text-slate-600 font-bold">HandyProfile</span>
                    </p>
                </div>

            </div>

            {/* AI Quote Modal Placeholder */}
            <Dialog open={isQuoteOpen} onOpenChange={setIsQuoteOpen}>
                <DialogContent className="sm:max-w-md border-0 bg-slate-50 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Sparkles className="w-5 h-5 text-amber-500" />
                            Use AI Quote Bot
                        </DialogTitle>
                        <DialogDescription>
                            Get a rough estimate in seconds based on {profile.firstName}'s rates.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm text-center">
                        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full mx-auto flex items-center justify-center text-white mb-4 shadow-lg shadow-indigo-500/20">
                            <Sparkles className="w-8 h-8 animate-pulse" />
                        </div>
                        <h3 className="font-bold text-slate-900 mb-2">How it works</h3>
                        <p className="text-sm text-slate-500 mb-6">
                            Describe your job, upload photos if you have them, and our AI will generate a price range based on {profile.firstName}'s past work.
                        </p>
                        <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-12 rounded-xl">
                            Start Chat
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

        </div>
    );
}
