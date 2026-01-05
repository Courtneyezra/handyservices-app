import { useState, useEffect } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { MapPin, Mail, Globe, Share2, Star, ShieldCheck, Clock, Calendar as CalendarIcon, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface PublicProfile {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    bio: string | null;
    city: string | null;
    postcode: string | null;
    heroImageUrl: string | null;
    socialLinks: {
        instagram?: string;
        linkedin?: string;
        website?: string;
    } | null;
    skills: string[];
    radiusMiles: number;
}

interface AvailabilitySlot {
    date: string;
    startTime: string;
    endTime: string;
}

export default function ContractorPublicProfile() {
    const [, params] = useRoute('/handy/:slug');
    const slug = params?.slug;
    const { toast } = useToast();
    const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
    const [isBookingOpen, setIsBookingOpen] = useState(false);

    // Fetch Profile
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

    // Fetch Availability
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

    // Booking Mutation
    const bookingMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch(`/api/public/contractor/${slug}/book`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('Booking failed');
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Request Sent!",
                description: "The contractor has been notified of your request.",
            });
            setIsBookingOpen(false);
            setSelectedSlot(null);
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to send booking request. Please try again.",
                variant: "destructive"
            });
        }
    });

    const handleSlotClick = (slot: AvailabilitySlot) => {
        setSelectedSlot(slot);
        setIsBookingOpen(true);
    };

    const handleBookingSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        bookingMutation.mutate({
            name: formData.get('name'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            description: formData.get('description'),
            date: selectedSlot?.date,
            slot: `${selectedSlot?.startTime} - ${selectedSlot?.endTime}`
        });
    };

    useEffect(() => {
        if (profile) {
            document.title = `${profile.fullName} | Handy Services`;
        }
    }, [profile]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
                <h1 className="text-2xl font-bold text-slate-800 mb-2">Profile Not Found</h1>
                <p className="text-slate-600">This contractor profile does not exist or is currently private.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            {/* Hero Section */}
            <div className="relative h-64 md:h-80 lg:h-96 bg-slate-800 overflow-hidden">
                {profile.heroImageUrl ? (
                    <img
                        src={profile.heroImageUrl}
                        alt="Expertise"
                        className="w-full h-full object-cover opacity-60"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 to-transparent" />

                <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
                    <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-end gap-6">
                        {/* Avatar Stub */}
                        <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-white p-1 shadow-xl -mb-12 md:-mb-16 z-10">
                            <div className="w-full h-full rounded-full bg-amber-500 flex items-center justify-center text-white text-4xl font-bold">
                                {profile.firstName[0]}
                            </div>
                        </div>

                        <div className="flex-1 text-white pb-2">
                            <h1 className="text-3xl md:text-5xl font-bold">{profile.fullName}</h1>
                            <div className="flex items-center gap-4 mt-2 text-slate-300 text-sm md:text-base">
                                <span className="flex items-center gap-1">
                                    <MapPin className="w-4 h-4 text-amber-400" />
                                    {profile.city || 'Local Expert'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                    Verified Pro
                                </span>
                            </div>
                        </div>

                        {/* Contact CTA */}
                        <div className="w-full md:w-auto pb-2">
                            <a
                                href="#contact"
                                className="block w-full text-center px-8 py-3 bg-white text-slate-900 hover:bg-slate-100 font-bold rounded-lg shadow-lg transition-colors"
                            >
                                Contact Me
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <main className="max-w-5xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-3 gap-10">

                {/* Left Column: Bio & Skills */}
                <div className="md:col-span-2 space-y-10">
                    <section>
                        <h2 className="text-2xl font-bold mb-4">About Me</h2>
                        <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed whitespace-pre-line">
                            {profile.bio || "Hi, I'm a professional contractor ready to help with your home improvement needs."}
                        </div>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold mb-4">My Services</h2>
                        <div className="flex flex-wrap gap-2">
                            {profile.skills.length > 0 ? profile.skills.map(skill => (
                                <span key={skill} className="px-3 py-1 bg-white border border-slate-200 rounded-full text-slate-600 text-sm font-medium">
                                    {skill}
                                </span>
                            )) : (
                                <p className="text-slate-500 italic">No specific services listed.</p>
                            )}
                        </div>
                    </section>

                    <section id="contact">
                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-6">
                            <div className="flex items-start gap-4">
                                <Star className="w-6 h-6 text-amber-500 flex-shrink-0 mt-1" />
                                <div>
                                    <h3 className="font-bold text-slate-900">Why choose me?</h3>
                                    <ul className="mt-2 space-y-2 text-slate-700">
                                        <li className="flex items-center gap-2">✓ Verified background check</li>
                                        <li className="flex items-center gap-2">✓ Professional tools and equipment</li>
                                        <li className="flex items-center gap-2">✓ Satisfaction guaranteed</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Right Column: Sidebar info */}
                <div className="space-y-6">
                    {/* Availability / Booking Widget */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm sticky top-6">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
                            <Clock className="w-5 h-5 text-slate-400" />
                            Next Availability
                        </h3>

                        {availabilityData?.availability && availabilityData.availability.length > 0 ? (
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                                {availabilityData.availability.slice(0, 5).map((slot, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleSlotClick(slot)}
                                        className="w-full text-left p-3 rounded-lg border border-slate-100 hover:border-amber-300 hover:bg-amber-50 transition-all group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium text-slate-700 group-hover:text-amber-900">
                                                {format(new Date(slot.date), 'EEE, MMM d')}
                                            </span>
                                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full group-hover:bg-amber-200 group-hover:text-amber-800">
                                                {slot.startTime}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                                <p className="text-xs text-center text-slate-500 pt-2">
                                    Select a slot to request a booking.
                                </p>
                            </div>
                        ) : (
                            <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                <p className="text-slate-500 text-sm">No upcoming slots available online.</p>
                                <a href={`mailto:contact@handy.com?subject=Booking Request for ${profile.fullName}`} className="text-amber-600 font-medium text-sm hover:underline mt-1 block">
                                    Email for availability
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Service Area */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
                            <MapPin className="w-5 h-5 text-slate-400" />
                            Service Area
                        </h3>
                        <p className="text-slate-600 text-sm mb-4">
                            Covering {profile.city} and surrounding areas within {profile.radiusMiles} miles.
                        </p>
                        {/* Visual map placeholder */}
                        <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs">
                            Map View
                        </div>
                    </div>

                    {/* Social Links */}
                    {profile.socialLinks && Object.values(profile.socialLinks).some(Boolean) && (
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
                                <Share2 className="w-5 h-5 text-slate-400" />
                                Connect
                            </h3>
                            <div className="space-y-3">
                                {profile.socialLinks.website && (
                                    <a href={profile.socialLinks.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-slate-600 hover:text-amber-600 transition-colors">
                                        <Globe className="w-4 h-4" /> Website
                                    </a>
                                )}
                                {profile.socialLinks.instagram && (
                                    <a href={profile.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-slate-600 hover:text-amber-600 transition-colors">
                                        <span className="w-4 h-4 font-bold text-center leading-none">IG</span> Instagram
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Booking Modal */}
            <Dialog open={isBookingOpen} onOpenChange={setIsBookingOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Request Booking</DialogTitle>
                        <DialogDescription>
                            Request a service with {profile.fullName} for {selectedSlot && format(new Date(selectedSlot.date), 'MMMM d, yyyy')} at {selectedSlot?.startTime}.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleBookingSubmit} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Your Name</Label>
                            <Input id="name" name="name" required placeholder="John Doe" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input id="email" name="email" type="email" placeholder="john@example.com" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input id="phone" name="phone" required placeholder="07123 456789" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description">Job Description</Label>
                            <Textarea id="description" name="description" placeholder="Briefly describe what you need help with..." />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsBookingOpen(false)}>Cancel</Button>
                            <Button type="submit" disabled={bookingMutation.isPending}>
                                {bookingMutation.isPending && <Clock className="w-4 h-4 mr-2 animate-spin" />}
                                Send Request
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
