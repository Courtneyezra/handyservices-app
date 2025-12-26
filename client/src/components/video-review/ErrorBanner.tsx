import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ErrorState {
    message: string;
    details?: string;
    code?: string;
    retry?: () => void;
}

interface ErrorBannerProps {
    error: ErrorState | null;
    onDismiss?: () => void;
    className?: string;
}

export function ErrorBanner({ error, onDismiss, className = '' }: ErrorBannerProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (error) {
            setIsVisible(true);

            // Auto-dismiss after 6 seconds if it's not critical (critical = has retry)
            if (!error.retry) {
                const timer = setTimeout(() => {
                    setIsVisible(false);
                    if (onDismiss) setTimeout(onDismiss, 300); // Wait for animation
                }, 6000);
                return () => clearTimeout(timer);
            }
        } else {
            setIsVisible(false);
        }
    }, [error, onDismiss]);

    return (
        <AnimatePresence>
            {isVisible && error && (
                <motion.div
                    initial={{ height: 0, opacity: 0, scale: 0.95 }}
                    animate={{ height: 'auto', opacity: 1, scale: 1 }}
                    exit={{ height: 0, opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    className={`fixed top-4 left-4 right-4 z-[100] max-w-md mx-auto ${className}`}
                >
                    <div className="bg-red-950/90 border border-red-500/50 text-white p-4 rounded-xl shadow-2xl backdrop-blur-md flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />

                        <div className="flex-1">
                            <h4 className="font-semibold text-sm">{error.message}</h4>
                            {error.details && (
                                <p className="text-xs text-red-200/80 mt-1">{error.details}</p>
                            )}

                            {error.retry && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={error.retry}
                                    className="mt-2 h-7 text-xs bg-red-900/50 border-red-700 hover:bg-red-800 text-white"
                                >
                                    <RefreshCw className="w-3 h-3 mr-1.5" />
                                    Try Again
                                </Button>
                            )}
                        </div>

                        {onDismiss && (
                            <button
                                onClick={() => setIsVisible(false)}
                                className="text-red-400 hover:text-white transition-colors p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
