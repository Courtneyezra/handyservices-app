import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Check, X, Calendar, Clock, MapPin, User, FileText } from "lucide-react";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { useToast } from "@/hooks/use-toast";

interface BookingRequest {
    id: string;
    contractorId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    description: string;
    requestedDate: string; // ISO
    requestedSlot: string; // "09:00 - 10:00"
    status: 'pending' | 'accepted' | 'declined';
    createdAt: string;
}

interface Quote {
    id: string;
    customerName: string;
    jobDescription: string;
    quoteMode: 'hhh' | 'simple' | 'pick_and_mix' | 'consultation';
    bookedAt: string | null;
    createdAt: string;
    status: string | null;
}

export default function BookingRequestsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: bookings, isLoading: bookingsLoading } = useQuery<BookingRequest[]>({
        queryKey: ['contractor-bookings'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/bookings');
            if (!res.ok) throw new Error('Failed to fetch bookings');
            return res.json();
        }
    });

    const { data: quotes, isLoading: quotesLoading } = useQuery<Quote[]>({
        queryKey: ['contractor-quotes'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/quotes');
            if (!res.ok) throw new Error('Failed to fetch quotes');
            return res.json();
        }
    });

    const isLoading = bookingsLoading || quotesLoading;

    // Merge Bookings and Diagnostic Visits
    const diagnosticVisits = quotes?.filter(q => q.quoteMode === 'consultation') || [];

    // Normalize to a unified Display Item
    const unifiedSchedule = [
        ...(bookings || []).map(b => ({
            id: b.id,
            type: 'request',
            title: b.customerName,
            subtitle: b.description,
            date: b.requestedDate,
            slot: b.requestedSlot,
            status: b.status,
            created: b.createdAt,
            phone: b.customerPhone,
            email: b.customerEmail
        })),
        ...diagnosticVisits.map(q => ({
            id: q.id,
            type: 'visit_link',
            title: q.customerName,
            subtitle: q.jobDescription || "Diagnostic Visit Link Sent",
            date: q.bookedAt || q.createdAt,
            slot: q.bookedAt ? format(new Date(q.bookedAt), 'HH:mm') : 'Pending Booking',
            status: q.bookedAt ? 'accepted' : 'pending',
            created: q.createdAt,
            phone: 'N/A', // Quotes might not have this in list view? Wait, type Def above has only title/desc.
            email: 'N/A'
        }))
    ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());


    const respondMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string, status: 'accepted' | 'declined' }) => {
            const res = await fetch(`/api/contractor/bookings/${id}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error('Failed to update booking');
            return res.json();
        },
        onSuccess: (data, variables) => {
            toast({
                title: variables.status === 'accepted' ? "Booking Accepted" : "Booking Declined",
                description: variables.status === 'accepted'
                    ? "Great! The customer will be notified."
                    : "The request has been declined.",
            });
            queryClient.invalidateQueries({ queryKey: ['contractor-bookings'] });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Something went wrong. Please try again.",
                variant: "destructive"
            });
        }
    });

    return (
        <ContractorAppShell>
            <div className="max-w-4xl mx-auto space-y-6 p-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Schedule & Visits</h1>
                    <p className="text-slate-500">Manage your upcoming appointments and booking requests.</p>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                    </div>
                ) : unifiedSchedule && unifiedSchedule.length > 0 ? (
                    <div className="space-y-4">
                        {unifiedSchedule.map((item) => (
                            <div key={item.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row gap-6">
                                {/* Left: Date & Time Badge */}
                                <div className={`flex flex-col items-center justify-center p-4 rounded-lg min-w-[100px] text-center border ${item.type === 'visit_link' ? 'bg-purple-50 border-purple-100' : 'bg-slate-50 border-slate-100'}`}>
                                    {item.status === 'pending' && item.type === 'visit_link' ? (
                                        <>
                                            <span className="text-xs font-bold text-purple-500 uppercase">WAITING</span>
                                            <span className="text-2xl font-bold text-purple-700">Link</span>
                                            <span className="text-[10px] text-purple-400 mt-1">SENT</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-sm font-bold text-slate-500 uppercase">
                                                {format(new Date(item.date), 'MMM')}
                                            </span>
                                            <span className="text-3xl font-bold text-slate-900">
                                                {format(new Date(item.date), 'd')}
                                            </span>
                                            <span className="text-xs text-slate-500 mt-1">
                                                {format(new Date(item.date), 'EEE')}
                                            </span>
                                        </>
                                    )}
                                </div>

                                {/* Middle: Details */}
                                <div className="flex-1 space-y-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase tracking-wide
                                                ${item.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                    item.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-red-100 text-red-700'}`}>
                                                {item.status}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {item.type === 'visit_link' ? 'Sent' : 'Received'} {format(new Date(item.created), 'MMM d, h:mm a')}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                            <User className="w-4 h-4 text-slate-400" />
                                            {item.title}
                                        </h3>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-600">
                                        <p className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-slate-400" />
                                            Slot: <span className="font-medium">{item.slot}</span>
                                        </p>
                                        <p className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-slate-400" />
                                            {item.subtitle}
                                        </p>
                                    </div>

                                    {/* Contact Info */}
                                    {item.type === 'request' && (
                                        <div className="text-sm text-slate-500 pt-2 border-t border-slate-100 mt-2">
                                            <span className="mr-4">📧 {item.email}</span>
                                            <span>📞 {item.phone}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Right: Actions */}
                                {item.type === 'request' && item.status === 'pending' && (
                                    <div className="flex md:flex-col gap-2 justify-center min-w-[140px]">
                                        <button
                                            onClick={() => respondMutation.mutate({ id: item.id, status: 'accepted' })}
                                            disabled={respondMutation.isPending}
                                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Check className="w-4 h-4" /> Accept
                                        </button>
                                        <button
                                            onClick={() => respondMutation.mutate({ id: item.id, status: 'declined' })}
                                            disabled={respondMutation.isPending}
                                            className="flex-1 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                        >
                                            <X className="w-4 h-4" /> Decline
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
                        <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Calendar className="w-8 h-8 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">No requests yet</h3>
                        <p className="text-slate-500 max-w-sm mx-auto mt-2">
                            Share your public profile link to start receiving booking requests from customers.
                        </p>
                    </div>
                )}
            </div>
        </ContractorAppShell>
    );
}
