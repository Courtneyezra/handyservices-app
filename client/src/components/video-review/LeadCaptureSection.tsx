import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Phone, CheckCircle2, ArrowRight } from 'lucide-react';

interface LeadCaptureSectionProps {
    onSubmit: (data: { name: string; phone: string }) => void;
    isVisible: boolean;
    isSubmitting: boolean;
}

export function LeadCaptureSection({ onSubmit, isVisible, isSubmitting }: LeadCaptureSectionProps) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [isValid, setIsValid] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [touched, setTouched] = useState({ name: false, phone: false }); // F5: Track touched state

    // Sequential form state
    const [showPhone, setShowPhone] = useState(false);
    const phoneInputRef = useRef<HTMLInputElement>(null);

    // Initial load from session storage
    useEffect(() => {
        const savedData = sessionStorage.getItem('lead_data');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            if (parsed.name) {
                setName(parsed.name);
                setShowPhone(true);
            }
            setPhone(parsed.phone || '');
        }
    }, []);

    // Validation and Formatting
    useEffect(() => {
        const nameValid = name.trim().length > 0;
        const phoneClean = phone.replace(/\D/g, '');
        const phoneValid = phoneClean.length >= 10;

        setIsValid(nameValid && phoneValid);

        // Auto-show phone field when name is entered
        if (nameValid && !showPhone) {
            // Small delay to make it feel responsive but not jarring
            const timer = setTimeout(() => setShowPhone(true), 500);
            return () => clearTimeout(timer);
        }

        // Save to session storage
        if (name || phone) {
            sessionStorage.setItem('lead_data', JSON.stringify({ name, phone }));
        }
    }, [name, phone, showPhone]);

    // UK Phone Number Formatting (Option B: 07xxx xxxxxx)
    const formatPhoneNumber = (value: string) => {
        const cleaned = value.replace(/\D/g, '');

        // Handle UK mobile starting with 07 (07xxx xxxxxx)
        if (cleaned.startsWith('07')) {
            if (cleaned.length <= 5) return cleaned;
            if (cleaned.length <= 11) return `${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
            return `${cleaned.slice(0, 5)} ${cleaned.slice(5, 11)}`;
        }

        // Handle UK landline starting with 0 (0xxxx xxxxxx)
        if (cleaned.startsWith('0')) {
            if (cleaned.length <= 5) return cleaned;
            if (cleaned.length <= 11) return `${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
            return `${cleaned.slice(0, 5)} ${cleaned.slice(5, 11)}`;
        }

        // Fallback for other numbers: just group by 4
        if (cleaned.length > 5 && !cleaned.startsWith('0')) {
            return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
        }

        return cleaned;
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow spaces during input for UK format
        const input = e.target.value.replace(/[^0-9\s]/g, '');
        const formatted = formatPhoneNumber(input);

        // UK numbers are max 11 digits (excluding spaces)
        // 07700 900000 = 11 digits + 1 space = 12 chars
        if (formatted.replace(/\s/g, '').length <= 11) {
            setPhone(formatted);
            if (touched.phone) setTouched(prev => ({ ...prev, phone: false }));
        }
    };

    const handleSubmit = () => {
        if (isValid) {
            setIsComplete(true);
            onSubmit({ name, phone });
        }
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="overflow-hidden"
                >
                    <div className="px-4 pb-8 pt-4">
                        <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50 shadow-xl backdrop-blur-sm">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                    <User className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Get your instant quote texted to you</h2>
                                    <p className="text-slate-400 text-sm">We'll just need your name and number</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                {/* NAME FIELD */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-white ml-1">What should we call you?</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <Input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            onBlur={() => setTouched({ ...touched, name: true })} // F5
                                            placeholder="John Smith"
                                            className={`bg-slate-950 border-slate-600 focus:border-emerald-500 pl-10 h-12 text-lg focus:ring-emerald-500/50 transition-all placeholder:text-slate-500 text-white ${touched.name && name.trim().length === 0 ? 'border-red-500 focus:border-red-500' : ''}`}
                                            disabled={isComplete}
                                            autoFocus
                                        />
                                        {name.trim().length > 0 && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                                            >
                                                <CheckCircle2 className="w-5 h-5" />
                                            </motion.div>
                                        )}
                                    </div>
                                    {!showPhone && (
                                        <motion.p
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="text-xs text-emerald-500/80 ml-1 flex items-center"
                                        >
                                            We'll ask for your number next <ArrowRight className="w-3 h-3 ml-1" />
                                        </motion.p>
                                    )}
                                </div>

                                {/* PHONE FIELD (Sequential Reveal) */}
                                <AnimatePresence>
                                    {showPhone && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0, y: -10 }}
                                            animate={{ height: 'auto', opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4 }}
                                            className="space-y-2 overflow-hidden"
                                        >
                                            <label className="text-sm font-medium text-white ml-1">Phone Number</label>
                                            <div className="relative">
                                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <Input
                                                    ref={phoneInputRef}
                                                    type="tel"
                                                    value={phone}
                                                    onChange={handlePhoneChange}
                                                    onBlur={() => setTouched({ ...touched, phone: true })} // F5
                                                    placeholder="07700 900000"
                                                    className={`bg-slate-950 border-slate-600 focus:border-emerald-500 pl-10 h-12 text-lg focus:ring-emerald-500/50 placeholder:text-slate-500 text-white ${touched.phone && phone.replace(/\D/g, '').length < 10 ? 'border-red-500 focus:border-red-500' : ''}`}
                                                    disabled={isComplete}
                                                />
                                                {phone.replace(/\D/g, '').length >= 10 && (
                                                    <motion.div
                                                        initial={{ scale: 0 }}
                                                        animate={{ scale: 1 }}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                                                    >
                                                        <CheckCircle2 className="w-5 h-5" />
                                                    </motion.div>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-400 ml-1">
                                                {touched.phone && phone.replace(/\D/g, '').length > 0 && phone.replace(/\D/g, '').length < 10 ? (
                                                    <span className="text-red-400">Please enter a valid 10-digit phone number</span>
                                                ) : (
                                                    "We'll text you updates on your request. No spam, ever."
                                                )}
                                            </p>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <Button
                                    onClick={handleSubmit}
                                    className={`w-full h-12 text-lg font-bold mt-4 transition-all duration-300
                                        ${isValid
                                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-[1.02]'
                                            : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-50'
                                        }`}
                                    disabled={!isValid || isSubmitting || isComplete}
                                >
                                    {isSubmitting ? (
                                        <span className="flex items-center gap-2">
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                                            />
                                            Submitting...
                                        </span>
                                    ) : (
                                        'Show me the quote →'
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
