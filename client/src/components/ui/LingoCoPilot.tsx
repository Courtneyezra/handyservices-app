import React from 'react';
import { Card } from './card';
import { BookOpen, Info } from 'lucide-react';
import { ScrollArea } from './scroll-area';

interface LingoTerm {
    jargon: string; // What the customer says (e.g. "box is clicking")
    term: string;   // Professional translation (e.g. "Consumer Unit / RCD")
    definition: string;
    context?: string;
}

interface LingoCoPilotProps {
    terms: LingoTerm[];
    isLoading?: boolean;
}

export const LingoCoPilot: React.FC<LingoCoPilotProps> = ({
    terms,
    isLoading = false
}) => {
    return (
        <Card className="bento-card h-full flex flex-col glow-purple border-purple-500/20">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center space-x-2">
                    <BookOpen className="w-5 h-5 text-purple-400" />
                    <h3 className="font-bold text-white tracking-tight uppercase text-sm">Translation Engine</h3>
                </div>
                {isLoading && (
                    <div className="flex space-x-1">
                        <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                        <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                    </div>
                )}
            </div>

            <ScrollArea className="flex-1 p-4">
                {terms.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-30 py-12">
                        <Info className="w-8 h-8" />
                        <p className="text-xs font-medium uppercase tracking-widest leading-relaxed px-4">Listening for customer descriptions to translate...</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {terms.map((item, idx) => (
                            <div key={idx} className="group p-3 rounded-xl bg-white/5 border border-white/5 hover:border-purple-500/30 transition-all hover:bg-white/[0.08]">
                                <div className="mb-2">
                                    <span className="text-[10px] font-black uppercase text-purple-400/50 block mb-1">Customer Said:</span>
                                    <p className="text-xs text-white/90 italic">"{item.jargon}"</p>
                                </div>
                                <div className="pt-2 border-t border-white/5">
                                    <span className="text-[10px] font-black uppercase text-green-400/50 block mb-1">Trade Translation:</span>
                                    <h4 className="font-bold text-purple-300 text-sm mb-1 group-hover:text-purple-200">{item.term}</h4>
                                    <p className="text-[10px] text-white/50 leading-tight">
                                        {item.definition}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            <div className="p-3 bg-purple-500/5 border-t border-white/5">
                <p className="text-[10px] text-purple-300/50 font-bold uppercase tracking-widest text-center">
                    Bridging Customer & Trade
                </p>
            </div>
        </Card>
    );
};
