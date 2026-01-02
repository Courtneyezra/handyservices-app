
import React, { useState } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Edit2, Check, User, Sparkles, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

interface NameCandidate {
    name: string;
    confidence: number;
    reasoning: string;
}

interface NameCorrectionProps {
    callId: string;
    currentName: string;
    metadataJson: any;
    onUpdate?: (newName: string) => void;
}

export function NameCorrection({ callId, currentName, metadataJson, onUpdate }: NameCorrectionProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [customName, setCustomName] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const queryClient = useQueryClient();

    const candidates: NameCandidate[] = metadataJson?.nameCandidates || [];

    const updateName = async (newName: string) => {
        try {
            setIsLoading(true);
            const res = await fetch(`/api/calls/${callId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerName: newName })
            });

            if (!res.ok) throw new Error("Failed to update name");

            // Optimistic update or refetch
            queryClient.invalidateQueries({ queryKey: ["calls"] });
            queryClient.invalidateQueries({ queryKey: ["call", callId] });
            if (onUpdate) onUpdate(newName);
            setIsOpen(false);
            setIsEditing(false);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div className="flex items-center gap-2 cursor-pointer group hover:bg-muted/50 p-1 rounded transition-colors">
                    <span className="font-medium text-foreground">
                        {currentName || "Unknown"}
                    </span>
                    <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 bg-white dark:bg-slate-950 border shadow-md" align="start">
                <div className="p-3 border-b bg-muted/30">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                        <Sparkles className="h-3 w-3 text-purple-500" />
                        AI Name Suggestions
                    </h4>
                </div>

                <div className="p-2 space-y-1">
                    {candidates.length > 0 ? (
                        candidates.map((candidate, idx) => (
                            <button
                                key={idx}
                                onClick={() => updateName(candidate.name)}
                                disabled={isLoading}
                                className={`w-full text-left p-2 rounded flex items-center justify-between hover:bg-accent transition-colors ${candidate.name === currentName ? "bg-accent/50" : ""
                                    }`}
                            >
                                <div>
                                    <div className="font-medium text-sm">{candidate.name}</div>
                                    <div className="text-xs text-muted-foreground">{candidate.reasoning}</div>
                                </div>
                                {candidate.confidence > 0.8 ? (
                                    <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 border-green-200">
                                        {Math.round(candidate.confidence * 100)}%
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="text-[10px]">
                                        {Math.round(candidate.confidence * 100)}%
                                    </Badge>
                                )}
                            </button>
                        ))
                    ) : (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            No AI candidates found.
                        </div>
                    )}
                </div>

                <div className="p-2 border-t">
                    {!isEditing ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => {
                                setIsEditing(true);
                                setCustomName(currentName);
                            }}
                        >
                            Enter Custom Name
                        </Button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Input
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                className="h-8 text-sm"
                                placeholder="Enter name..."
                                autoFocus
                            />
                            <Button
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => updateName(customName)}
                                disabled={!customName.trim() || isLoading}
                            >
                                <Check className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
