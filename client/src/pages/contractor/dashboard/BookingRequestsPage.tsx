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

export default function BookingRequestsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: bookings, isLoading } = useQuery<BookingRequest[]>({
        queryKey: ['contractor-bookings'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/bookings');
            if (!res.ok) throw new Error('Failed to fetch bookings');
            return res.json();
        }
    });

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
                    <h1 className="text-2xl font-bold text-slate-900">Booking Requests</h1>
                    <p className="text-slate-500">Manage incoming job requests from your public profile.</p>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                    </div>
                ) : bookings && bookings.length > 0 ? (
                    <div className="space-y-4">
                        {bookings.map((booking) => (
                            <div key={booking.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row gap-6">
                                {/* Left: Date & Time Badge */}
                                <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-lg min-w-[100px] text-center border border-slate-100">
                                    <span className="text-sm font-bold text-slate-500 uppercase">
                                        {format(new Date(booking.requestedDate), 'MMM')}
                                    </span>
                                    <span className="text-3xl font-bold text-slate-900">
                                        {format(new Date(booking.requestedDate), 'd')}
                                    </span>
                                    <span className="text-xs text-slate-500 mt-1">
                                        {format(new Date(booking.requestedDate), 'EEE')}
                                    </span>
                                </div>

                                {/* Middle: Details */}
                                <div className="flex-1 space-y-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase tracking-wide
                                                ${booking.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                                    booking.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-red-100 text-red-700'}`}>
                                                {booking.status}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                Received {format(new Date(booking.createdAt), 'MMM d, h:mm a')}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                            <User className="w-4 h-4 text-slate-400" />
                                            {booking.customerName}
                                        </h3>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-600">
                                        <p className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-slate-400" />
                                            Slot: <span className="font-medium">{booking.requestedSlot}</span>
                                        </p>
                                        <p className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-slate-400" />
                                            {booking.description}
                                        </p>
                                    </div>

                                    {/* Contact Info (Only show if accepted?) - For now show always for ease */}
                                    <div className="text-sm text-slate-500 pt-2 border-t border-slate-100 mt-2">
                                        <span className="mr-4">📧 {booking.customerEmail}</span>
                                        <span>📞 {booking.customerPhone}</span>
                                    </div>
                                </div>

                                {/* Right: Actions */}
                                {booking.status === 'pending' && (
                                    <div className="flex md:flex-col gap-2 justify-center min-w-[140px]">
                                        <button
                                            onClick={() => respondMutation.mutate({ id: booking.id, status: 'accepted' })}
                                            disabled={respondMutation.isPending}
                                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Check className="w-4 h-4" /> Accept
                                        </button>
                                        <button
                                            onClick={() => respondMutation.mutate({ id: booking.id, status: 'declined' })}
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
