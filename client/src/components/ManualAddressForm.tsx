import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressOption } from '@/hooks/useRecentAddresses';
import { Check, X } from 'lucide-react';

interface ManualAddressFormProps {
    postcode: string;
    onSave: (address: AddressOption) => void;
    onCancel: () => void;
}

export function ManualAddressForm({ postcode, onSave, onCancel }: ManualAddressFormProps) {
    const [street, setStreet] = useState('');
    const [city, setCity] = useState(''); // Optional if we want full address
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!street) return;

        setIsLoading(true);

        // Create formatted address object
        const fullAddress = `${street}, ${city ? city + ', ' : ''}${postcode}, UK`;

        // Simulate "saving" or just pass it up
        // In real app, might want to geocode it here or just save as raw
        const newAddress: AddressOption = {
            formattedAddress: fullAddress,
            streetAddress: street,
            placeId: `manual_${Date.now()}`,
            coordinates: { lat: 0, lng: 0 } // Default for manual entry if not geocoded
        };

        onSave(newAddress);
        setIsLoading(false);
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-sm space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">Enter Address Manually</h3>
                <Button variant="ghost" size="icon" onClick={onCancel} className="h-6 w-6">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <div className="space-y-3">
                <div className="space-y-1">
                    <Label htmlFor="street" className="text-xs text-slate-400">Street Address</Label>
                    <Input
                        id="street"
                        value={street}
                        onChange={(e) => setStreet(e.target.value)}
                        placeholder="e.g. 42 Maple Street"
                        className="bg-slate-800 border-slate-700 focus-visible:ring-emerald-500"
                        autoFocus
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label htmlFor="postcode" className="text-xs text-slate-400">Postcode</Label>
                        <Input
                            id="postcode"
                            value={postcode}
                            disabled
                            className="bg-slate-800/50 border-slate-700"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="city" className="text-xs text-slate-400">City (Optional)</Label>
                        <Input
                            id="city"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="London"
                            className="bg-slate-800 border-slate-700"
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="text-slate-400">
                    Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!street || isLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Check className="w-4 h-4 mr-1" />
                    Confirm Address
                </Button>
            </div>
        </form>
    );
}
