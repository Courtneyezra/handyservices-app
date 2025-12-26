import { motion } from 'framer-motion';
import { Loader2, Upload, Sparkles, CheckCircle } from 'lucide-react';

interface UploadingAnimationProps {
    state: 'uploading' | 'processing' | 'analyzing' | null;
    progress: number;
}

export function UploadingAnimation({ state, progress }: UploadingAnimationProps) {
    const getStateInfo = () => {
        switch (state) {
            case 'uploading':
                return {
                    icon: Upload,
                    text: 'Securing your video...',
                    subtext: 'Your privacy is our priority',
                    color: 'text-blue-400'
                };
            case 'processing':
                return {
                    icon: Loader2,
                    text: 'Analyzing your job...',
                    subtext: 'Our AI is detecting tasks',
                    color: 'text-emerald-400'
                };
            case 'analyzing':
                return {
                    icon: Sparkles,
                    text: 'Calculating your quote...',
                    subtext: 'Almost ready!',
                    color: 'text-amber-400'
                };
            default:
                return {
                    icon: CheckCircle,
                    text: 'Quote Ready!',
                    subtext: 'Review the details below',
                    color: 'text-emerald-400'
                };
        }
    };

    const { icon: Icon, text, color } = getStateInfo();

    return (
        <div className="relative">
            {/* Video placeholder with shimmer */}
            <div className="aspect-video bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl overflow-hidden relative border border-slate-700/50">
                {/* Animated shimmer effect */}
                <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                />

                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                        animate={state === 'processing' || state === 'analyzing' ? { rotate: 360 } : {}}
                        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                    >
                        <Icon className={`w-16 h-16 ${color}`} />
                    </motion.div>
                </div>

                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-900/50 backdrop-blur-sm">
                    <motion.div
                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.3 }}
                    />
                </div>

                {/* Progress percentage */}
                <div className="absolute top-4 right-4">
                    <div className="px-3 py-1 bg-slate-900/80 backdrop-blur-sm rounded-full border border-emerald-500/30">
                        <span className="text-emerald-400 text-sm font-mono font-bold">
                            {Math.round(progress)}%
                        </span>
                    </div>
                </div>
            </div>

            {/* Status text */}
            <div className="text-center mt-4">
                <motion.p
                    className={`font-medium text-lg ${color}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={text}
                >
                    {text}
                </motion.p>
                {/* @ts-ignore */}
                <motion.p
                    className="text-sm text-gray-400 mt-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={`${text}-sub`}
                >
                    {/* @ts-ignore */}
                    {getStateInfo().subtext}
                </motion.p>
            </div>
        </div>
    );
}
