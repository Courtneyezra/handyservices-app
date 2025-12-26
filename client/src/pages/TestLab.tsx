import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OutcomeGauge } from '@/components/ui/OutcomeGauge';
import { Send, RefreshCw, Trash2, Mic, User, Bot } from 'lucide-react';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface AnalysisResult {
    matched: boolean;
    sku: any;
    confidence: number;
    method: string;
    rationale: string;
    nextRoute: string;
    suggestedScript?: string;
    // Multi-task fields
    tasks?: any[];
    matchedServices?: any[];
    unmatchedTasks?: any[];
    nextRouteGlobal?: string;
}

export default function TestLab() {
    const [history, setHistory] = useState<string[]>([]); // Backend context history
    const [messages, setMessages] = useState<ChatMessage[]>([]); // UI chat history
    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Latest Analysis State
    const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || isLoading) return;

        const userMsg = inputText.trim();
        setInputText("");

        // Add User Message to UI
        const newMessage: ChatMessage = { role: 'user', content: userMsg, timestamp: Date.now() };
        setMessages(prev => [...prev, newMessage]);
        setIsLoading(true);

        try {
            // Try multi-task analysis if enabled (or default to it for robustness)
            // For this demo, let's use the new endpoint
            const response = await fetch('/api/test/analyze-multi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg })
            });

            const data = await response.json();

            // Map multi-result to UI format
            const multiRes = data.result;
            // Hacky mapping to reuse existing UI for single results while adding multi-support
            const uiResult: AnalysisResult = {
                matched: multiRes.hasMatches,
                sku: multiRes.matchedServices[0]?.sku || null,
                confidence: multiRes.matchedServices[0]?.confidence || 0,
                method: "multi-task",
                rationale: `Detected ${multiRes.tasks.length} intent(s).`,
                nextRoute: multiRes.nextRoute,
                suggestedScript: SuggestScript(multiRes),
                tasks: multiRes.tasks,
                matchedServices: multiRes.matchedServices,
                unmatchedTasks: multiRes.unmatchedTasks
            };

            setLastAnalysis(uiResult);
            // setHistory(...) // Multi-endpoint is stateless currently, so history reset or ignored for this specific test mode

        } catch (error) {
            console.error("Analysis failed", error);
            // Show Error in UI
            setLastAnalysis({
                matched: false,
                sku: null,
                confidence: 0,
                method: "error",
                rationale: "Connection error or timeout. Check server logs.",
                nextRoute: "UNKNOWN",
                suggestedScript: "System Error: Unable to reach analysis engine."
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setHistory([]);
        setMessages([]);
        setLastAnalysis(null);
    };

    return (
        <div className="h-[calc(100vh-4rem)] -m-8 flex flex-col md:flex-row bg-slate-50">

            {/* Left Panel: Chat Interface */}
            <div className="w-full md:w-1/2 flex flex-col border-r border-slate-200 bg-white">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div>
                        <h2 className="font-bold text-slate-800">Interactive Chat Lab</h2>
                        <p className="text-xs text-slate-500">Test the conversational memory</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleReset} className="text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4 mr-2" /> Reset
                    </Button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50">
                    {messages.length === 0 && (
                        <div className="text-center text-slate-400 mt-20">
                            <Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p className="text-sm">Type a message to start the simulation.</p>
                            <p className="text-xs mt-2 opacity-60">Try: "I have a leak" then "It's the tap"</p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'user' ? (
                                <>
                                    <div className="max-w-[80%] bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-none shadow-sm text-sm">
                                        {msg.content}
                                    </div>
                                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                        <User className="w-4 h-4 text-blue-600" />
                                    </div>
                                </>
                            ) : (
                                // If we ever put bot responses back in chat
                                <div className="max-w-[80%] bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-2xl rounded-tl-none shadow-sm text-sm">
                                    {msg.content}
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-slate-100">
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <Input
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="Type a customer message..."
                            className="flex-1"
                            autoFocus
                        />
                        <Button type="submit" disabled={isLoading || !inputText.trim()}>
                            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                    </form>
                </div>
            </div>

            {/* Right Panel: Live Intelligence Dashboard */}
            <div className="w-full md:w-1/2 bg-slate-100/50 p-6 overflow-y-auto">
                <div className="max-w-md mx-auto space-y-6">

                    {/* 1. The Output Gauge */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 w-full text-center">Live Forecast</h3>
                        <OutcomeGauge
                            value={lastAnalysis?.confidence || 0}
                            outcome={(lastAnalysis?.nextRoute || 'UNKNOWN') as any}
                            size={260}
                        />
                    </div>

                    {/* 2. Suggested Script (The VA Helper) */}
                    <div className="bg-indigo-600 rounded-xl shadow-lg shadow-indigo-200 p-6 text-white relative overflow-hidden transition-all duration-300">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <Mic className="w-16 h-16" />
                        </div>
                        <h3 className="text-xs font-bold text-indigo-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Mic className="w-4 h-4" /> AI Suggestion
                        </h3>
                        <div className="text-lg font-medium leading-relaxed">
                            "{lastAnalysis?.suggestedScript || "Waiting for input..."}"
                        </div>
                    </div>

                    {/* 3. Debug / Rationale */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Analysis Logic</h3>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <span className="text-xs text-slate-400 uppercase font-bold">Method</span>
                                <div className="mt-1">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                        {lastAnalysis?.method || "N/A"}
                                    </span>
                                </div>
                            </div>
                            <div>
                                <span className="text-xs text-slate-400 uppercase font-bold">Rationale</span>
                                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                                    {lastAnalysis?.rationale || "No analysis yet."}
                                </p>
                            </div>

                            {/* SKU Match Details */}
                            {lastAnalysis?.matched && (
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    <span className="text-xs text-green-600 font-bold uppercase flex items-center gap-1 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500" /> Matched SKU
                                    </span>
                                    <div className="text-sm font-semibold text-slate-900">{lastAnalysis.sku.name}</div>
                                    <div className="text-xs text-slate-500">{lastAnalysis.sku.description}</div>
                                    <div className="mt-2 text-sm font-bold text-slate-800">£{(lastAnalysis.sku.pricePence / 100).toFixed(2)}</div>
                                </div>
                            )}


                            {/* Multi-Task Breakdown */}
                            {lastAnalysis?.tasks && lastAnalysis.tasks.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    <span className="text-xs text-slate-400 uppercase font-bold block mb-2">Intent Breakdown</span>
                                    <div className="space-y-2">
                                        {lastAnalysis.tasks.map((task: any, idx: number) => {
                                            const match = lastAnalysis.matchedServices?.find((m: any) => m.task.originalIndex === task.originalIndex);
                                            return (
                                                <div key={idx} className="flex justify-between items-center text-xs bg-slate-50 p-2 rounded border border-slate-100">
                                                    <span className="font-medium text-slate-700">{task.description}</span>
                                                    {match ? (
                                                        <span className="text-green-600 font-bold flex items-center gap-1">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                            £{(match.sku.pricePence / 100).toFixed(0)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-orange-500 font-bold flex items-center gap-1">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                                                            Video Req.
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Context Memory Visualizer (Single Task Only) */}
                            {/* <div className="mt-4 pt-4 border-t border-slate-100">
                                <span className="text-xs text-slate-400 uppercase font-bold block mb-2">Memory Window ({history.length})</span>
                                <div className="space-y-1">
                                    {history.map((h, i) => (
                                        <div key={i} className="text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded truncate">
                                            {h}
                                        </div>
                                    ))}
                                </div>
                            </div> */}

                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

function SuggestScript(multiRes: any): string {
    if (multiRes.nextRoute === 'INSTANT_PRICE') {
        const total = multiRes.totalMatchedPrice / 100;
        return `I can give you a fixed price of £${total.toFixed(0)} for the whole job.`;
    }
    if (multiRes.nextRoute === 'MIXED_QUOTE') {
        return "Ideally we'd need to visit to assess the complex parts. The fee is £39, but I can quote the standard items now.";
    }
    // Video Quote / Partial
    if (multiRes.matchedServices.length > 0) {
        // Anchor script
        const known = multiRes.matchedServices[0].sku.name;
        const price = (multiRes.matchedServices[0].sku.pricePence / 100).toFixed(0);
        return `I can definitely do the ${known} for £${price}. For the rest, I need to see a quick video to be accurate.`;
    }
    return "To be accurate on the price for these items, could you upload a quick video?";
}
