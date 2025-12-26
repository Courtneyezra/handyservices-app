import React from 'react';
import { motion } from 'framer-motion';
import { Check, Clock } from 'lucide-react';

export type FlowSection = 'review' | 'details' | 'quote';

interface ProgressIndicatorProps {
    currentSection: FlowSection;
}

const steps = [
    { id: 'review', label: 'Review', time: '~30s' },
    { id: 'details', label: 'Details', time: '~15s' },
    { id: 'quote', label: 'Quote', time: 'Instant' },
];

export function ProgressIndicator({ currentSection }: ProgressIndicatorProps) {
    const currentStepIndex = steps.findIndex(s => s.id === currentSection);

    const getTimeEstimate = () => {
        switch (currentSection) {
            case 'review': return '~2 min to complete';
            case 'details': return '~1 min left';
            case 'quote': return 'Complete';
            default: return '';
        }
    };

    return (
        <div className="w-full max-w-md mx-auto mb-6 px-4">
            {/* Steps Visual */}
            <div className="relative flex justify-between items-center mb-2">
                {/* Connecting Line - Background */}
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-700 -z-10 transform -translate-y-1/2" />

                {/* Connecting Line - Progress */}
                <motion.div
                    className="absolute top-1/2 left-0 h-0.5 bg-emerald-500 -z-10 transform -translate-y-1/2"
                    initial={{ width: '0%' }}
                    animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                />

                {steps.map((step, index) => {
                    const status = index < currentStepIndex ? 'completed' : index === currentStepIndex ? 'current' : 'upcoming';

                    return (
                        <div key={step.id} className="flex flex-col items-center">
                            <motion.div
                                className={`
                                    w-8 h-8 rounded-full flex items-center justify-center border-2 
                                    ${status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' :
                                        status === 'current' ? 'bg-[#1a2332] border-emerald-500 text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
                                            'bg-[#1a2332] border-slate-600 text-slate-400'}
                                    transition-colors duration-300
                                `}
                                initial={false}
                                animate={status === 'current' ? { scale: 1.1 } : { scale: 1 }}
                            >
                                {status === 'completed' ? (
                                    <Check className="w-4 h-4" />
                                ) : (
                                    <span className="text-xs font-bold">{index + 1}</span>
                                )}
                            </motion.div>
                            <span className={`text-[10px] sm:text-xs mt-1 font-medium ${status === 'upcoming' ? 'text-slate-400' : 'text-white'}`}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Time Estimate */}
            <div className="flex justify-center items-center text-xs text-slate-300 gap-1.5 opacity-90">
                <Clock className="w-3 h-3" />
                <span>{getTimeEstimate()}</span>
            </div>
        </div>
    );
}
