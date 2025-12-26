import React from 'react';
import { motion } from 'framer-motion';
import { Play, Maximize2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface AnimatedThumbnailProps {
    thumbnailUrl?: string;
    videoUrl?: string;
}

export function AnimatedThumbnail({ thumbnailUrl, videoUrl }: AnimatedThumbnailProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <motion.div
                    className="relative w-full aspect-video rounded-2xl overflow-hidden cursor-pointer group shadow-2xl border-4 border-emerald-500/20"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                >
                    {thumbnailUrl ? (
                        <img
                            src={thumbnailUrl}
                            alt="Video thumbnail"
                            className="w-full h-full object-cover"
                        />
                    ) : videoUrl ? (
                        <video
                            src={videoUrl}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                        />
                    ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                            <span className="text-gray-500">Video Preview</span>
                        </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent group-hover:from-black/30 transition-all" />

                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-20 h-20 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center group-hover:bg-white group-hover:scale-110 transition-all shadow-2xl">
                            <Play className="w-10 h-10 text-gray-900 fill-gray-900 ml-1" />
                        </div>
                    </div>

                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                        <span className="text-white text-sm font-medium drop-shadow-lg">
                            0:00 / 0:{Math.floor(Math.random() * 60).toString().padStart(2, '0')}
                        </span>
                        <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 text-white text-xs font-medium border border-white/20">
                            <Maximize2 className="w-3.5 h-3.5" />
                            <span>Tap to view</span>
                        </div>
                    </div>
                </motion.div>
            </DialogTrigger>

            <DialogContent className="sm:max-w-4xl p-0 bg-black border-none overflow-hidden aspect-video">
                <video
                    src={videoUrl}
                    controls
                    autoPlay
                    className="w-full h-full"
                />
                <button
                    onClick={() => setIsOpen(false)}
                    className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors z-50"
                >
                    <X className="w-5 h-5" />
                </button>
            </DialogContent>
        </Dialog>
    );
}
