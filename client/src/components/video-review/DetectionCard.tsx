import React from 'react';
import { motion } from 'framer-motion';
import { Clock, AlertTriangle, Edit2, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Detection {
    summary: string;
    urgencyLevel: 'high' | 'medium' | 'low';
    estimatedTimeRange: string;
    confidence: number;
}

interface DetectionCardProps {
    detection: Detection;
    onEdit: () => void;
}

export function DetectionCard({ detection, onEdit }: DetectionCardProps) {
    const getUrgencyColor = (level: string) => {
        switch (level) {
            case 'high': return 'bg-red-100 text-red-700 border-red-200';
            case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'low': return 'bg-green-100 text-green-700 border-green-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
        }
    };

    return (
        <Card className="overflow-hidden border-2 border-primary/10 shadow-sm relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />

            <div className="p-5">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            <span className="text-sm font-medium text-green-600 uppercase tracking-wider">AI Detected</span>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 leading-tight">
                            {detection.summary || "Handyman Job"}
                        </h3>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onEdit}
                        className="text-gray-500 hover:text-primary gap-1.5 h-8 px-3 rounded-full hover:bg-primary/5"
                    >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Edit</span>
                    </Button>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Badge variant="outline" className={`px-2.5 py-1 ${getUrgencyColor(detection.urgencyLevel)} border`}>
                        <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                        {detection.urgencyLevel.charAt(0).toUpperCase() + detection.urgencyLevel.slice(1)} Urgency
                    </Badge>

                    <Badge variant="outline" className="px-2.5 py-1 bg-blue-50 text-blue-700 border-blue-200">
                        <Clock className="w-3.5 h-3.5 mr-1.5" />
                        {detection.estimatedTimeRange} est.
                    </Badge>
                </div>
            </div>
        </Card>
    );
}
