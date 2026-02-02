import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Sun, Sunset, Target, Moon } from 'lucide-react';

export type TimeSlotType = 'am' | 'pm' | 'exact' | 'out_of_hours';

interface TimeSlotOption {
    type: TimeSlotType;
    label: string;
    description: string;
    fee: number; // in pence
    icon: React.ElementType;
    isOutOfHours?: boolean;
}

interface TimeSlotSelectorProps {
    selectedDate: Date;
    onTimeSelect: (type: TimeSlotType, exactTime: string | null, fee: number) => void;
}

const TIME_SLOTS: TimeSlotOption[] = [
    {
        type: 'am',
        label: 'Morning',
        description: '8am - 12pm',
        fee: 0,
        icon: Sun
    },
    {
        type: 'pm',
        label: 'Afternoon',
        description: '12pm - 6pm',
        fee: 0,
        icon: Sunset
    },
    {
        type: 'exact',
        label: 'Exact Time',
        description: 'Specify precise arrival time',
        fee: 2000, // +£20
        icon: Target
    },
    {
        type: 'out_of_hours',
        label: 'Out of Hours',
        description: 'Before 8am or after 6pm',
        fee: 3000, // +£30
        icon: Moon,
        isOutOfHours: true
    },
];

const EXACT_TIME_OPTIONS = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
    '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    '17:00', '17:30',
];

const OUT_OF_HOURS_TIME_OPTIONS = [
    '06:00', '06:30', '07:00', '07:30', // Early morning
    '18:00', '18:30', '19:00', '19:30', '20:00', // Evening
];

const formatPrice = (pence: number): string => {
    if (pence === 0) return 'FREE';
    const pounds = pence / 100;
    return `+£${pounds.toFixed(0)}`;
};

export const TimeSlotSelector: React.FC<TimeSlotSelectorProps> = ({
    selectedDate,
    onTimeSelect,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<TimeSlotType>('am');
    const [exactTime, setExactTime] = useState<string>('10:00');

    const handleSlotSelect = (slot: TimeSlotOption) => {
        setSelectedSlot(slot.type);

        // For exact or out_of_hours, provide default time, otherwise null
        const time = slot.type === 'exact'
            ? exactTime
            : slot.type === 'out_of_hours'
                ? '06:00'
                : null;

        onTimeSelect(slot.type, time, slot.fee);
    };

    const handleExactTimeChange = (time: string) => {
        setExactTime(time);
        if (selectedSlot === 'exact') {
            const slot = TIME_SLOTS.find(s => s.type === 'exact')!;
            onTimeSelect('exact', time, slot.fee);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 space-y-4"
        >
            <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-[#7DB00E]" />
                <h4 className="text-lg font-bold text-slate-900">What time works best?</h4>
            </div>

            <div className="space-y-3">
                {TIME_SLOTS.map((slot) => {
                    const isSelected = selectedSlot === slot.type;
                    const Icon = slot.icon;

                    return (
                        <div key={slot.type} className="space-y-2">
                            <label
                                className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all border-2 ${isSelected
                                        ? 'bg-[#7DB00E]/10 border-[#7DB00E] shadow-lg'
                                        : 'bg-white border-slate-200 hover:border-slate-300'
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="timeSlot"
                                    checked={isSelected}
                                    onChange={() => handleSlotSelect(slot)}
                                    className="mt-1 w-5 h-5 text-[#7DB00E] focus:ring-[#7DB00E]"
                                />

                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <Icon className={`w-5 h-5 ${isSelected ? 'text-[#7DB00E]' : 'text-slate-500'}`} />
                                            <span className="font-bold text-base text-slate-900">
                                                {slot.label}
                                            </span>
                                        </div>

                                        <span className={`font-bold text-base ${slot.fee === 0 ? 'text-green-600' : 'text-[#7DB00E]'
                                            }`}>
                                            {formatPrice(slot.fee)}
                                        </span>
                                    </div>

                                    <p className="text-sm text-slate-600">{slot.description}</p>
                                </div>
                            </label>

                            {/* Exact Time Dropdown */}
                            {slot.type === 'exact' && isSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="ml-9 pl-4 border-l-2 border-[#7DB00E]/30"
                                >
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Select Exact Time:
                                    </label>
                                    <select
                                        value={exactTime}
                                        onChange={(e) => handleExactTimeChange(e.target.value)}
                                        className="w-full md:w-48 px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-[#7DB00E] focus:ring-2 focus:ring-[#7DB00E]/20 bg-white text-slate-900 font-medium"
                                    >
                                        {EXACT_TIME_OPTIONS.map((time) => (
                                            <option key={time} value={time}>
                                                {time}
                                            </option>
                                        ))}
                                    </select>
                                </motion.div>
                            )}

                            {/* Out of Hours Info */}
                            {slot.type === 'out_of_hours' && isSelected && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="ml-9 pl-4 border-l-2 border-amber-400/30"
                                >
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                        <p className="text-xs font-semibold text-amber-900 mb-1">
                                            ⚡ Premium Service Hours
                                        </p>
                                        <p className="text-xs text-amber-700">
                                            Out of hours service available 6am-8am and 6pm-8pm on weekdays
                                        </p>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Help Text */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
                <p className="font-semibold mb-1">💡 Flexibility Tip</p>
                <p>
                    Choosing AM/PM time windows (free) gives us flexibility to optimize routes
                    and may result in earlier availability than exact time slots.
                </p>
            </div>
        </motion.div>
    );
};
