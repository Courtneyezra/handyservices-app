import { motion, AnimatePresence } from "framer-motion";
import { Phone, MessageCircle, Shield, Calendar, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StickyCTAProps {
    isVisible: boolean;
    onConversion?: (source: string) => void;
    onBook?: () => void;
    selectedPackage?: string | null;
    selectedPrice?: number;
    scrollPhase?: 'early' | 'mid' | 'late';
    children?: React.ReactNode;
}

export function StickyCTA({
    isVisible,
    onConversion,
    onBook,
    selectedPackage,
    selectedPrice,
    scrollPhase = 'early',
    children
}: StickyCTAProps) {

    // Dynamic CTA text based on scroll phase
    const getCtaText = () => {
        if (selectedPackage && selectedPrice) {
            return `Book ${selectedPackage} - £${(selectedPrice / 100).toFixed(0)}`;
        }
        switch (scrollPhase) {
            case 'early':
                return 'See Your Quote';
            case 'mid':
                return 'View Options';
            case 'late':
            default:
                return 'Secure My Slot';
        }
    };

    const handlePrimaryClick = () => {
        // If we are late stage or showing booking intent, Scroll to Book
        if (scrollPhase !== 'early' || (selectedPackage)) {
            onBook?.();
        } else {
            // Early stage: Encourage Call? Or just Scroll to Options?
            // "See Your Quote" implies scrolling down. 
            // "Call Now" implies calling. 
            // The button text is "Call Now" if not late phase.
            // Wait, logic below says: {scrollPhase === 'late' ? getCtaText() : 'Call Now'}
            // So if NOT late, it says Call Now. So it SHOULD call.

            // Correction: "See Your Quote" is returned by getCtaText('early').
            // But the button label logic was: {scrollPhase === 'late' ? getCtaText() : 'Call Now'}
            // This ignores 'early'/'mid' text return values. 

            // Let's use getCtaText() for ALL phases if we want dynamic text.
            // But if the user wants "Review -> Book", then:
            // Early: "Review Quote" (Scroll down)
            // Late: "Secure Slot" (Open Booking)

            if (scrollPhase === 'late') {
                onBook?.();
            } else {
                // Default to Call for now if text is "Call Now"
                onConversion?.('sticky_call');
                window.location.href = "tel:+447449501762";
            }
        }
    };

    // Refined Logic for Button Text/Action
    const isBookingMode = scrollPhase === 'late' || !!selectedPackage;
    const buttonText = isBookingMode ? getCtaText() : 'Call Now';

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                    className="fixed bottom-0 left-0 right-0 z-[9999] lg:hidden"
                >
                    {/* Subtle Toolbox Design - Slate Theme */}
                    <div className="relative bg-slate-900/95 backdrop-blur-lg shadow-2xl overflow-visible border-t border-slate-700/50">

                        {/* Top Handle (Subtle) */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-800 rounded-full px-6 py-1 border border-slate-700 shadow-lg" />

                        {/* Corner Rivets (Subtle) */}
                        <div className="absolute top-2 left-3 w-1.5 h-1.5 bg-slate-700 rounded-full shadow-inner opacity-50"></div>
                        <div className="absolute top-2 right-3 w-1.5 h-1.5 bg-slate-700 rounded-full shadow-inner opacity-50"></div>

                        {/* Google Reviews Tab - Top Right - Integrated */}
                        <div className="absolute -top-[28px] right-2 bg-slate-900 border-t border-x border-slate-700/50 rounded-t-lg px-3 py-1.5 pb-2 shadow-none flex items-center gap-2">
                            <div className="flex flex-col items-end leading-none">
                                <div className="flex gap-0.5 mb-1">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <Star key={i} className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                                    ))}
                                </div>
                                <span className="text-[10px] text-slate-300 font-bold tracking-wide">GOOGLE REVIEWS</span>
                            </div>
                            {/* Connector patch to hide the main border line underneath */}
                            <div className="absolute -bottom-[2px] left-[1px] right-[1px] h-[4px] bg-slate-900"></div>
                        </div>

                        {/* Selected Package Echo */}
                        {selectedPackage && selectedPrice && (
                            <div className="flex items-center justify-center gap-2 py-2 px-3 bg-slate-800/80 border-b border-slate-700/50">
                                <Calendar className="w-3 h-3 text-[#7DB00E]" />
                                <span className="text-xs text-white font-medium">
                                    {selectedPackage} Package Selected - £{(selectedPrice / 100).toFixed(0)}
                                </span>
                            </div>
                        )}

                        {children ? (
                            children
                        ) : (
                            <div className="p-3 pb-4 flex gap-3">\
                                <Button
                                    onClick={(e) => {
                                        // Override if booking mode
                                        if (isBookingMode) {
                                            e.preventDefault();
                                            onBook?.();
                                        } else {
                                            onConversion?.('sticky_call');
                                            window.location.href = "tel:+447449501762";
                                        }
                                    }}
                                    className={`flex-1 py-3 font-bold rounded-xl text-sm flex items-center justify-center gap-2 ${isBookingMode ? 'bg-[#7DB00E] hover:bg-[#6da000] text-[#1D2D3D]' : 'bg-amber-400 hover:bg-amber-500 text-slate-900'}`}
                                >
                                    {isBookingMode ? <Calendar className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                                    {buttonText}
                                </Button>
                                <Button
                                    onClick={() => {
                                        onConversion?.('sticky_whatsapp');
                                        window.open("https://wa.me/447508744402", "_blank");
                                    }}
                                    className="flex-1 py-3 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"
                                >
                                    <MessageCircle className="w-4 h-4" />
                                    WhatsApp
                                </Button>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
