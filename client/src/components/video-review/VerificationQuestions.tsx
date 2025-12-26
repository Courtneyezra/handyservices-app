import React from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';

interface VerificationQuestionsProps {
    onVerify: (value: 'yes' | 'no' | 'more') => void;
    onLocationChange: (value: string) => void;
    onUrgencyChange: (value: string) => void;
    onNotesChange: (value: string) => void;
    verified: 'yes' | 'no' | 'more' | null;
}

export function VerificationQuestions({
    onVerify,
    onLocationChange,
    onUrgencyChange,
    onNotesChange,
    verified
}: VerificationQuestionsProps) {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">

            {/* 1. Validation */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-gray-900">
                    Is this the main issue?
                </Label>
                <RadioGroup onValueChange={(val) => onVerify(val as any)} className="space-y-3">
                    <div className={`flex items-center space-x-3 border p-4 rounded-xl transition-all cursor-pointer ${verified === 'yes' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                        <RadioGroupItem value="yes" id="verify-yes" />
                        <Label htmlFor="verify-yes" className="flex-1 cursor-pointer font-medium">Yes, that's exactly right</Label>
                    </div>
                    <div className={`flex items-center space-x-3 border p-4 rounded-xl transition-all cursor-pointer ${verified === 'no' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                        <RadioGroupItem value="no" id="verify-no" />
                        <Label htmlFor="verify-no" className="flex-1 cursor-pointer font-medium">No, it's something different</Label>
                    </div>
                    <div className={`flex items-center space-x-3 border p-4 rounded-xl transition-all cursor-pointer ${verified === 'more' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                        <RadioGroupItem value="more" id="verify-more" />
                        <Label htmlFor="verify-more" className="flex-1 cursor-pointer font-medium">Yes, but there are other issues too</Label>
                    </div>
                </RadioGroup>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 2. Location */}
                <div className="space-y-3">
                    <Label className="text-base font-semibold text-gray-900">Where is this job?</Label>
                    <Select onValueChange={onLocationChange}>
                        <SelectTrigger className="h-12 text-base rounded-xl border-gray-200 focus:ring-primary">
                            <SelectValue placeholder="Select room/area" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="bathroom">Bathroom</SelectItem>
                            <SelectItem value="kitchen">Kitchen</SelectItem>
                            <SelectItem value="bedroom">Bedroom</SelectItem>
                            <SelectItem value="living_room">Living Room</SelectItem>
                            <SelectItem value="hallway">Hallway/Stairs</SelectItem>
                            <SelectItem value="garden">Garden/Exterior</SelectItem>
                            <SelectItem value="office">Office/Study</SelectItem>
                            <SelectItem value="other">Other Area</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* 3. Urgency */}
                <div className="space-y-3">
                    <Label className="text-base font-semibold text-gray-900">When do you need this?</Label>
                    <Select onValueChange={onUrgencyChange}>
                        <SelectTrigger className="h-12 text-base rounded-xl border-gray-200 focus:ring-primary">
                            <SelectValue placeholder="Select timing" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="urgent">Parsed as Urgent (+10%)</SelectItem>
                            <SelectItem value="soon">Soon (Next 2 weeks)</SelectItem>
                            <SelectItem value="flexible">Flexible (Can wait)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* 4. Notes */}
            <motion.div
                className="space-y-3"
                initial={false}
                animate={verified === 'more' ? { height: 'auto', opacity: 1 } : { height: 'auto', opacity: 1 }}
            >
                <Label className="text-base font-semibold text-gray-900">
                    Anything else we should know? <span className="text-gray-400 font-normal text-sm ml-1">(Optional)</span>
                </Label>
                <Textarea
                    placeholder="E.g. Also check the shower head while you're here..."
                    className="min-h-[100px] text-base rounded-xl border-gray-200 focus:ring-primary resize-none"
                    onChange={(e) => onNotesChange(e.target.value)}
                />
            </motion.div>
        </div>
    );
}
