/**
 * PhotoUpload — reusable evidence photo uploader for pay-protection forms.
 *
 * Module 07 — Pay Protection (FF_PAY_PROTECTION). Uploads files via the
 * existing simple `/api/upload` endpoint (server/upload.ts) and returns the
 * resulting URLs to the parent. Designed for evidence photos on
 * mis-scope uplift, call-out fee, and materials reimbursement claims.
 *
 * No S3 presigning here — Module 07 evidence is small (≤ a few MB per photo)
 * and the simple multer upload is sufficient for v1. If/when usage grows we
 * can swap to the presigned PUT flow used by AdminGenerateDispatch.tsx.
 */
import { useRef, useState } from 'react';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';

interface PhotoUploadProps {
    /** Currently uploaded URLs (controlled). */
    value: string[];
    /** Called whenever the URL list changes (after upload, after remove). */
    onChange: (urls: string[]) => void;
    /** Max number of photos accepted (defaults to 6). */
    max?: number;
    /** Optional label rendered above the input. */
    label?: string;
    /** Hint text under the label. */
    hint?: string;
    /** When true, render the field as required (* in label). */
    required?: boolean;
    /** Disable the input (e.g. while parent submitting). */
    disabled?: boolean;
}

const NAVY = '#1B2A4A';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const BG_LIGHT = '#F7F8FC';

export default function PhotoUpload({
    value,
    onChange,
    max = 6,
    label = 'Evidence photos',
    hint = 'JPG/PNG · up to 10MB each',
    required = false,
    disabled = false,
}: PhotoUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function uploadOne(file: File): Promise<string | null> {
        const fd = new FormData();
        fd.append('file', file);
        const token = localStorage.getItem('contractorToken');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/upload', { method: 'POST', headers, body: fd });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.url ?? null;
    }

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        setError(null);
        const remaining = max - value.length;
        if (remaining <= 0) {
            setError(`Maximum ${max} photos`);
            return;
        }
        const list = Array.from(files).slice(0, remaining);
        setUploading(true);
        try {
            const urls: string[] = [];
            for (const f of list) {
                const url = await uploadOne(f);
                if (url) urls.push(url);
            }
            if (urls.length === 0) {
                setError('Upload failed — try again');
            } else {
                onChange([...value, ...urls]);
            }
        } catch (e: any) {
            setError(e?.message || 'Upload failed');
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    }

    function removeAt(idx: number) {
        const next = [...value];
        next.splice(idx, 1);
        onChange(next);
    }

    const canAddMore = value.length < max && !disabled;

    return (
        <div className="space-y-2">
            <label className="text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: NAVY }}>
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
                <span className="ml-2 font-normal text-[11px]" style={{ color: MUTED }}>
                    ({value.length}/{max})
                </span>
            </label>
            {hint && (
                <p className="text-[11px]" style={{ color: MUTED }}>{hint}</p>
            )}

            <div className="grid grid-cols-3 gap-2">
                {value.map((url, idx) => (
                    <div
                        key={`${url}-${idx}`}
                        className="relative aspect-square rounded-lg overflow-hidden border"
                        style={{ borderColor: BORDER }}
                    >
                        <img src={url} alt={`evidence ${idx + 1}`} className="w-full h-full object-cover" />
                        {!disabled && (
                            <button
                                type="button"
                                onClick={() => removeAt(idx)}
                                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                                aria-label={`remove photo ${idx + 1}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                ))}

                {canAddMore && (
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors hover:bg-white"
                        style={{ borderColor: BORDER, backgroundColor: BG_LIGHT, color: NAVY }}
                    >
                        {uploading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                            <>
                                <Upload className="h-5 w-5" />
                                <span className="text-[10px] font-bold uppercase">Add</span>
                            </>
                        )}
                    </button>
                )}
            </div>

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
            />

            {error && (
                <p className="text-[12px] text-red-600">{error}</p>
            )}
        </div>
    );
}
