import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface LiveSchedulePreviewProps {
    mode: string;
    start?: string;
    end?: string;
    days?: string;
    className?: string;
}

export function LiveSchedulePreview({ mode, start = "08:00", end = "18:00", days = "1,2,3,4,5", className }: LiveSchedulePreviewProps) {
    const [currentTime, setCurrentTime] = useState<Date>(new Date());
    const [status, setStatus] = useState<'open' | 'closed' | 'forced-open' | 'forced-closed' | 'voicemail'>('closed');

    // Update time every second
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Calculate status
    useEffect(() => {
        if (mode === 'force-in-hours') {
            setStatus('forced-open');
            return;
        }
        if (mode === 'force-out-of-hours') {
            setStatus('forced-closed');
            return;
        }
        if (mode === 'voicemail-only') {
            setStatus('voicemail');
            return;
        }

        // Auto mode logic
        const ukTime = toZonedTime(currentTime, 'Europe/London');
        const currentDay = ukTime.getDay() === 0 ? 7 : ukTime.getDay(); // 1=Mon, 7=Sun
        const currentHour = ukTime.getHours();
        const currentMin = ukTime.getMinutes();
        const currentMinutes = currentHour * 60 + currentMin;

        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        const businessDays = days.split(',').map(Number);
        const isDay = businessDays.includes(currentDay);
        const isTime = currentMinutes >= startMinutes && currentMinutes < endMinutes;

        if (isDay && isTime) {
            setStatus('open');
        } else {
            setStatus('closed');
        }
    }, [currentTime, mode, start, end, days]);

    const ukTime = toZonedTime(currentTime, 'Europe/London');
    const formattedTime = format(ukTime, "h:mm:ss a");
    const formattedDate = format(ukTime, "EEE, MMM d");

    const getStatusColor = () => {
        switch (status) {
            case 'open':
            case 'forced-open':
                return "text-green-400 bg-green-400/10 border-green-400/20";
            case 'closed':
            case 'forced-closed':
                return "text-orange-400 bg-orange-400/10 border-orange-400/20";
            case 'voicemail':
                return "text-pink-400 bg-pink-400/10 border-pink-400/20";
            default:
                return "text-gray-400";
        }
    };

    const getStatusText = () => {
        switch (status) {
            case 'open': return "Open (Business Hours)";
            case 'closed': return "Closed (Out of Hours)";
            case 'forced-open': return "Forced Open";
            case 'forced-closed': return "Forced Closed";
            case 'voicemail': return "Voicemail Only";
            default: return "Unknown";
        }
    };

    const getIcon = () => {
        switch (status) {
            case 'open':
            case 'forced-open':
                return <CheckCircle2 className="w-5 h-5" />;
            case 'closed':
            case 'forced-closed':
                return <XCircle className="w-5 h-5" />;
            case 'voicemail':
                return <AlertCircle className="w-5 h-5" />;
            default:
                return <Clock className="w-5 h-5" />;
        }
    };

    return (
        <Card className={cn("p-4 border", getStatusColor(), className)}>
            <div className="flex items-center gap-3 mb-3">
                {getIcon()}
                <div>
                    <div className="font-semibold text-sm">{getStatusText()}</div>
                    <div className="text-xs opacity-80">Live routing status</div>
                </div>
            </div>

            <div className="flex items-center justify-between text-sm bg-black/20 rounded p-2">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 opacity-70" />
                    <span>Current UK Time:</span>
                </div>
                <div className="font-mono font-medium">
                    {formattedTime}
                </div>
            </div>
            <div className="text-right text-xs mt-1 opacity-70">
                {formattedDate}
            </div>
        </Card>
    );
}
