/**
 * SlotToggle — per-slot AM/PM/Full Day toggle cell.
 *
 * Used by AvailabilityScheduler. Tap cycles `available → unavailable → available`.
 * For Teams (`isTeam`) a stepper shows `crewAvailable / crewMax`.
 *
 * Module 04 — Availability Engine spec §6.
 */

import React from 'react';
import { Sun, Sunset, Clock, Lock, Hourglass, Minus, Plus } from 'lucide-react';

export type SlotKey = 'am' | 'pm' | 'full';
export type SlotStatus = 'available' | 'held' | 'booked' | 'unavailable';

interface SlotToggleProps {
    slot: SlotKey;
    status: SlotStatus;
    onChange: (next: SlotStatus) => void;
    isTeam?: boolean;
    crewAvailable?: number;
    crewMax?: number;
    onCrewChange?: (next: number) => void;
    /** When status === 'booked', show this label instead of 'Booked'. */
    bookedLabel?: string;
    disabled?: boolean;
}

const SLOT_META: Record<SlotKey, { label: string; subLabel: string; Icon: any }> = {
    am: { label: 'AM', subLabel: '8am – 12pm', Icon: Sun },
    pm: { label: 'PM', subLabel: '12pm – 5pm', Icon: Sunset },
    full: { label: 'Full Day', subLabel: '8am – 5pm', Icon: Clock },
};

// Brand colors per Module 13:
//   navy #1B2A4A — available
//   yellow #F5A623 — held
//   muted slate — unavailable
const STATUS_STYLE: Record<SlotStatus, { bg: string; border: string; text: string }> = {
    available: {
        bg: 'bg-[#1B2A4A]/15',
        border: 'border-[#1B2A4A]/40',
        text: 'text-[#1B2A4A] dark:text-blue-200',
    },
    held: {
        bg: 'bg-[#F5A623]/15',
        border: 'border-[#F5A623]/50',
        text: 'text-[#B5790F] dark:text-amber-200',
    },
    booked: {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/40',
        text: 'text-blue-300',
    },
    unavailable: {
        bg: 'bg-slate-800/60',
        border: 'border-slate-700/60',
        text: 'text-slate-500',
    },
};

function nextStatus(current: SlotStatus): SlotStatus {
    // Tap cycle: available → unavailable → available
    // (held / booked are not cycled by tap — those are server-driven.)
    if (current === 'available') return 'unavailable';
    return 'available';
}

export const SlotToggle: React.FC<SlotToggleProps> = ({
    slot,
    status,
    onChange,
    isTeam = false,
    crewAvailable = 1,
    crewMax = 1,
    onCrewChange,
    bookedLabel,
    disabled = false,
}) => {
    const meta = SLOT_META[slot];
    const style = STATUS_STYLE[status];
    const Icon = meta.Icon;

    const isLocked = status === 'booked' || status === 'held' || disabled;

    const handleClick = () => {
        if (isLocked) return;
        onChange(nextStatus(status));
    };

    return (
        <div
            className={`rounded-lg border ${style.bg} ${style.border} p-2 flex flex-col gap-1 transition-all ${
                isLocked ? '' : 'active:scale-[0.97] cursor-pointer'
            }`}
            onClick={handleClick}
            data-testid={`slot-${slot}-${status}`}
            role="button"
            aria-disabled={isLocked}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    {status === 'booked' ? (
                        <Lock size={12} className={style.text} />
                    ) : status === 'held' ? (
                        <Hourglass size={12} className={style.text} />
                    ) : (
                        <Icon size={12} className={style.text} />
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}>
                        {meta.label}
                    </span>
                </div>
                {status === 'available' && (
                    <span className="text-[9px] text-emerald-400 font-bold">ON</span>
                )}
                {status === 'unavailable' && (
                    <span className="text-[9px] text-slate-500 font-bold">OFF</span>
                )}
            </div>

            {status === 'booked' ? (
                <div className={`text-[10px] ${style.text} truncate`}>
                    {bookedLabel || 'Booked'}
                </div>
            ) : status === 'held' ? (
                <div className={`text-[10px] ${style.text}`}>Pending offer</div>
            ) : (
                <div className="text-[9px] text-slate-500">{meta.subLabel}</div>
            )}

            {/* Crew stepper — only when Team unit and slot is settable */}
            {isTeam && !isLocked && status === 'available' && onCrewChange && (
                <div className="flex items-center justify-between mt-1 bg-slate-900/60 rounded px-1 py-0.5">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (crewAvailable > 1) onCrewChange(crewAvailable - 1);
                        }}
                        className="p-0.5 text-slate-400 hover:text-white"
                        aria-label="Decrease crew"
                    >
                        <Minus size={10} />
                    </button>
                    <span className="text-[10px] font-bold text-slate-300">
                        {crewAvailable} / {crewMax}
                    </span>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (crewAvailable < crewMax) onCrewChange(crewAvailable + 1);
                        }}
                        className="p-0.5 text-slate-400 hover:text-white"
                        aria-label="Increase crew"
                    >
                        <Plus size={10} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default SlotToggle;
