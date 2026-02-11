import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

interface SignatureCaptureProps {
    onSignatureComplete: (signatureDataUrl: string) => void;
    onClear?: () => void;
    className?: string;
}

export default function SignatureCapture({ onSignatureComplete, onClear, className = "" }: SignatureCaptureProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Set up canvas for high DPI displays
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        ctx.scale(dpr, dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        // Set drawing styles
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Fill with white background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
    }, []);

    const getCoordinates = (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();

        if ("touches" in e) {
            const touch = e.touches[0];
            if (!touch) return null;
            return {
                x: touch.clientX - rect.left,
                y: touch.clientY - rect.top
            };
        } else {
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }
    };

    const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
        e.preventDefault();
        const coords = getCoordinates(e);
        if (!coords) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx) return;

        setIsDrawing(true);
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y);
    };

    const draw = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isDrawing) return;
        e.preventDefault();

        const coords = getCoordinates(e);
        if (!coords) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx) return;

        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
        setHasSignature(true);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx || !canvas) return;

        const rect = canvas.getBoundingClientRect();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
        setHasSignature(false);
        onClear?.();
    };

    const confirmSignature = () => {
        const canvas = canvasRef.current;
        if (!canvas || !hasSignature) return;

        const dataUrl = canvas.toDataURL("image/png");
        onSignatureComplete(dataUrl);
    };

    return (
        <div className={`space-y-3 ${className}`}>
            <div className="relative">
                <canvas
                    ref={canvasRef}
                    className="w-full h-40 border-2 border-dashed border-slate-300 rounded-xl bg-white touch-none cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                />
                {!hasSignature && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-slate-400 text-sm">Sign here</p>
                    </div>
                )}
            </div>
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearSignature}
                    className="flex-1"
                >
                    <Eraser className="w-4 h-4 mr-2" />
                    Clear
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={confirmSignature}
                    disabled={!hasSignature}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                    <Check className="w-4 h-4 mr-2" />
                    Confirm
                </Button>
            </div>
        </div>
    );
}
