import { motion, AnimatePresence } from "framer-motion";
import { Phone, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StickyCTAProps {
    isVisible: boolean;
}

export function StickyCTA({ isVisible }: StickyCTAProps) {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="fixed bottom-0 left-0 right-0 z-50 p-4 lg:hidden"
                >
                    <div className="bg-slate-900/90 backdrop-blur-lg border border-white/10 rounded-2xl p-3 shadow-2xl flex gap-3">
                        <Button
                            onClick={() => window.location.href = "tel:+447449501762"}
                            className="flex-1 py-3 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-xl text-sm flex items-center justify-center gap-2"
                        >
                            <Phone className="w-4 h-4" />
                            Call Now
                        </Button>
                        <Button
                            onClick={() => window.open("https://wa.me/447508744402", "_blank")}
                            className="flex-1 py-3 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"
                        >
                            <MessageCircle className="w-4 h-4" />
                            WhatsApp
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
