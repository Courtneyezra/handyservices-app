import { CheckCircle, AlertTriangle, Edit2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { ManualAddressForm } from './ManualAddressForm';

interface AddressValidation {
    raw: string;
    confidence: number;
    validated: boolean;
    placeId?: string;
    canonicalAddress?: string;
    suggestions?: Array<{
        formattedAddress: string;
        placeId: string;
        streetAddress: string;
        coordinates: { lat: number; lng: number };
    }>;
    coordinates?: {
        lat: number;
        lng: number;
    };
}

interface AddressValidatorProps {
    detectedAddress: string;
    validation: AddressValidation;
    onAddressConfirm: (address: string, placeId?: string) => void;
    onAddressEdit: () => void;
}

export function AddressValidator({
    detectedAddress,
    validation,
    onAddressConfirm,
    onAddressEdit
}: AddressValidatorProps) {
    const [showManualForm, setShowManualForm] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // High confidence (85%+) - Auto-accept with green checkmark
    if (validation.confidence >= 85 && validation.validated) {
        return (
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-green-800 uppercase tracking-wider">
                                Address Verified
                            </span>
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                                {validation.confidence}% Match
                            </span>
                        </div>
                        <div className="font-semibold text-slate-900 mb-1">
                            {validation.canonicalAddress || detectedAddress}
                        </div>
                        <div className="text-xs text-green-700">
                            Validated via Google Places
                        </div>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onAddressEdit}
                        className="text-green-700 hover:text-green-800 hover:bg-green-100"
                    >
                        <Edit2 className="w-3 h-3 mr-1" />
                        Edit
                    </Button>
                </div>
            </div>
        );
    }

    // Medium confidence (60-85%) - Show with suggestions
    if (validation.confidence >= 60) {
        return (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 mt-0.5">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                                Please Verify Address
                            </span>
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                                {validation.confidence}% Match
                            </span>
                        </div>
                        <div className="font-semibold text-slate-900">
                            {detectedAddress}
                        </div>
                    </div>
                </div>

                {/* Suggestions */}
                {validation.suggestions && validation.suggestions.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-xs font-semibold text-amber-800 mb-2">
                            Did you mean:
                        </div>
                        {validation.suggestions.slice(0, 3).map((suggestion, idx) => (
                            <button
                                key={suggestion.placeId}
                                onClick={() => {
                                    onAddressConfirm(suggestion.formattedAddress, suggestion.placeId);
                                }}
                                className={`w-full text-left p-3 rounded-lg border-2 transition-all hover:border-amber-400 hover:bg-amber-100 ${idx === 0
                                        ? 'border-amber-300 bg-white'
                                        : 'border-amber-100 bg-white/50'
                                    }`}
                            >
                                <div className="flex items-start gap-2">
                                    {idx === 0 && (
                                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold">
                                            ✓
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <div className="font-medium text-sm text-slate-900">
                                            {suggestion.streetAddress}
                                        </div>
                                        <div className="text-xs text-slate-600">
                                            {suggestion.formattedAddress}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        ))}
                        <button
                            onClick={() => setShowManualForm(true)}
                            className="w-full text-center p-2 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-100 rounded-lg transition-colors"
                        >
                            None of these - Enter manually
                        </button>
                    </div>
                )}

                {showManualForm && (
                    <div className="mt-3 pt-3 border-t border-amber-200">
                        <ManualAddressForm
                            initialAddress={detectedAddress}
                            onSubmit={(address) => {
                                onAddressConfirm(address);
                                setShowManualForm(false);
                            }}
                            onCancel={() => setShowManualForm(false)}
                        />
                    </div>
                )}
            </div>
        );
    }

    // Low confidence (<60%) - Show manual entry form
    return (
        <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3 mb-3">
                <div className="flex-shrink-0 mt-0.5">
                    <MapPin className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1">
                    <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                        Address Detected (Low Confidence)
                    </div>
                    <div className="font-medium text-slate-700 mb-1">
                        {detectedAddress}
                    </div>
                    <div className="text-xs text-slate-500">
                        Please verify or enter the correct address
                    </div>
                </div>
            </div>

            <ManualAddressForm
                initialAddress={detectedAddress}
                onSubmit={(address) => onAddressConfirm(address)}
                onCancel={() => { }}
            />
        </div>
    );
}
