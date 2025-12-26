import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, AlertTriangle, Play, Save, Trash2, Mic } from 'lucide-react';

interface Scenario {
    id: string;
    transcript: string;
    category: string;
    expectedRoute: string;
    notes?: string;
    source: string;
    ignore?: boolean;
    audioUrl?: string; // New: link to local MP3
}

export default function TrainingCenter() {
    const [scenarios, setScenarios] = useState<Scenario[]>([]);
    const [loading, setLoading] = useState(true);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, any>>({});
    const [filter, setFilter] = useState<'ALL' | 'NOISE' | 'REAL'>('ALL');

    useEffect(() => {
        fetchScenarios();
    }, []);

    const fetchScenarios = async () => {
        try {
            const res = await fetch('/api/training/scenarios');
            const data = await res.json();
            setScenarios(data.scenarios);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateScenario = async (id: string, updates: Partial<Scenario>) => {
        // Optimistic UI update
        setScenarios(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));

        try {
            await fetch(`/api/training/scenarios/${id}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
        } catch (err) {
            console.error("Update failed", err);
            // Revert on fail? For prototype, just log.
        }
    };

    const setSpeed = (id: string, rate: number) => {
        const audio = document.getElementById(`audio-${id}`) as HTMLAudioElement;
        if (audio) {
            audio.playbackRate = rate;
            // distinct visual feedback could go here
        }
    };

    const runTest = async (scenario: Scenario) => {
        setTestingId(scenario.id);
        try {
            const res = await fetch('/api/training/test-one', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: scenario.transcript })
            });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, [scenario.id]: data.result }));
        } catch (err) {
            console.error(err);
        } finally {
            setTestingId(null);
        }
    };

    const getStatusColor = (route: string) => {
        switch (route) {
            case 'INSTANT_PRICE': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'VIDEO_QUOTE': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'SITE_VISIT': return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'MIXED_QUOTE': return 'bg-purple-50 text-purple-700 border-purple-200';
            case 'MANUAL_REVIEW': return 'bg-gray-100 text-gray-600 border-gray-200';
            default: return 'bg-gray-50';
        }
    };

    const filtered = scenarios.filter(s => {
        if (s.ignore) return false; // Hide ignored
        if (filter === 'NOISE') return s.transcript.length < 50;
        if (filter === 'REAL') return s.source !== 'synthetic';
        return true;
    });

    if (loading) return <div className="p-8">Loading Training Data...</div>;

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            <header className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">AI Training Center</h1>
                    <p className="text-gray-500">Review and tag historical calls to improve accuracy.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => setFilter('ALL')}>All</Button>
                    <Button variant={filter === 'REAL' ? 'default' : 'outline'} onClick={() => setFilter('REAL')}>Real Calls</Button>
                    <Button variant={filter === 'NOISE' ? 'default' : 'outline'} onClick={() => setFilter('NOISE')}>Short/Noise</Button>
                </div>
            </header>

            <div className="grid gap-4">
                {filtered.map(scenario => {
                    const result = testResults[scenario.id];
                    const isMatch = result && (
                        result.nextRoute === scenario.expectedRoute ||
                        (scenario.expectedRoute === 'MANUAL_REVIEW')
                    );

                    return (
                        <Card key={scenario.id} className="group overflow-hidden hover:shadow-md transition-all duration-200">
                            <div className="flex flex-col md:flex-row">
                                {/* Transcript Section */}
                                <div className="flex-1 p-6 border-r border-gray-100 bg-white">
                                    <div className="flex justify-between mb-3">
                                        <Badge variant="outline" className="opacity-50">{scenario.source}</Badge>
                                        <button
                                            onClick={() => updateScenario(scenario.id, { ignore: true })}
                                            className="text-gray-300 hover:text-red-500 transition-colors"
                                            title="Mark as Noise/Ignore"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <p className="text-gray-800 leading-relaxed font-medium">"{scenario.transcript}"</p>
                                    <div className="mt-4 flex gap-2 text-xs text-gray-400">
                                        <span>Length: {scenario.transcript.length} chars</span>
                                    </div>

                                    {/* Audio Player */}
                                    {scenario.audioUrl && (
                                        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Mic className="w-3 h-3 text-gray-400" />
                                                <span className="text-xs font-semibold text-gray-500 uppercase">Recording</span>
                                            </div>
                                            <audio
                                                id={`audio-${scenario.id}`}
                                                controls
                                                className="w-full h-8 mb-2"
                                                src={scenario.audioUrl}
                                                preload="none"
                                            />
                                            <div className="flex gap-2">
                                                {[1, 1.5, 2].map(speed => (
                                                    <button
                                                        key={speed}
                                                        onClick={() => setSpeed(scenario.id, speed)}
                                                        className="px-2 py-1 text-xs bg-white border border-gray-200 rounded hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
                                                    >
                                                        {speed}x
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Controls Section */}
                                <div className="w-full md:w-80 bg-gray-50/50 p-6 flex flex-col gap-4">

                                    {/* Expected Outcome Selector */}
                                    <div>
                                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Correct Answer</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['INSTANT_PRICE', 'VIDEO_QUOTE', 'SITE_VISIT', 'MANUAL_REVIEW'].map(route => (
                                                <button
                                                    key={route}
                                                    onClick={() => updateScenario(scenario.id, { expectedRoute: route })}
                                                    className={`
                                                        px-3 py-2 rounded-lg text-xs font-medium transition-all
                                                        ${scenario.expectedRoute === route
                                                            ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-200'
                                                            : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
                                                        }
                                                    `}
                                                >
                                                    {route.replace('_', ' ')}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Test Runner */}
                                    <div className="mt-auto pt-4 border-t border-gray-200">
                                        {result ? (
                                            <div className={`p-3 rounded-lg border ${isMatch ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>

                                                {/* Header: Pass/Fail + Traffic Light */}
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xs font-bold uppercase flex items-center gap-2">
                                                        {isMatch ? 'PASS' : 'FAIL'}
                                                        {result.trafficLight && (
                                                            <span className={`
                                                                px-2 py-0.5 rounded-full text-[10px] border
                                                                ${result.trafficLight === 'GREEN' ? 'bg-green-100 text-green-800 border-green-200' : ''}
                                                                ${result.trafficLight === 'AMBER' ? 'bg-amber-100 text-amber-800 border-amber-200' : ''}
                                                                ${result.trafficLight === 'RED' ? 'bg-red-100 text-red-800 border-red-200' : ''}
                                                            `}>
                                                                {result.trafficLight}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-xs opacity-75">{result.confidence}% Conf</span>
                                                </div>

                                                <div className="text-sm font-semibold flex justify-between">
                                                    {result.nextRoute}
                                                    {result.vaAction && <span className="text-xs text-gray-500 font-normal self-center">Action: {result.vaAction}</span>}
                                                </div>

                                                {result.suggestedScript && (
                                                    <div className="text-xs mt-2 p-2 bg-white/50 rounded border border-black/5 italic text-gray-600">
                                                        "{result.suggestedScript}"
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <Button
                                                size="sm"
                                                className="w-full gap-2"
                                                variant="outline"
                                                onClick={() => runTest(scenario)}
                                                disabled={!!testingId}
                                            >
                                                {testingId === scenario.id ? (
                                                    "Running..."
                                                ) : (
                                                    <><Play className="w-3 h-3" /> Test AI Logic</>
                                                )}
                                            </Button>
                                        )}
                                    </div>

                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
