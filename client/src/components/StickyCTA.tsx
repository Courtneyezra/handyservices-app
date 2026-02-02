import { motion, AnimatePresence } from "framer-motion";
import { Phone, MessageCircle, Shield, Calendar } from "lucide-react";
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
                    className="fixed bottom-4 left-0 right-0 z-[9999] lg:hidden"
                >
                    <div className="bg-slate-900/95 backdrop-blur-lg border-t border-slate-700 shadow-2xl overflow-hidden">\

                        {/* Selected Package Echo */}
                        {selectedPackage && selectedPrice && (
                            <div className="flex items-center justify-center gap-2 py-2 px-3 bg-slate-800 border-b border-slate-700">
                                <Calendar className="w-3 h-3 text-[#7DB00E]" />
                                <span className="text-xs text-white font-medium">
                                    {selectedPackage} Package Selected - £{(selectedPrice / 100).toFixed(0)}
                                </span>
                            </div>
                        )}

                        {children ? (
                            children
                        ) : (
                            <div className="p-3 flex gap-3">
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
