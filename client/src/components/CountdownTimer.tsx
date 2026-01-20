import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface CountdownTimerProps {
    expiresAt: string | Date;
    onExpire?: () => void;
}

export function CountdownTimer({ expiresAt, onExpire }: CountdownTimerProps) {
    const [timeLeft, setTimeLeft] = useState(() => {
        const expiryTime = new Date(expiresAt).getTime();
        const now = Date.now();
        return Math.max(0, Math.floor((expiryTime - now) / 1000));
    });

    useEffect(() => {
        // Immediate check
        const expiryTime = new Date(expiresAt).getTime();
        const now = Date.now();
        const initialDiff = Math.floor((expiryTime - now) / 1000);

        // If already expired, don't start timer
        if (initialDiff <= 0) {
            if (timeLeft > 0) setTimeLeft(0);
            onExpire?.();
            return;
        }

        const interval = setInterval(() => {
            const currentNow = Date.now();
            const diff = Math.floor((expiryTime - currentNow) / 1000);
            const remaining = Math.max(0, diff);

            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(interval);
                onExpire?.();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [expiresAt, onExpire]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (timeLeft <= 0) {
        return <span className="text-red-500 font-bold">Expired</span>;
    }

    return (
        <span className="font-mono tabular-nums text-red-500 font-bold">
            {formatTime(timeLeft)}
        </span>
    );
}
