import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AddressDropdown } from './AddressDropdown';
import { ManualAddressForm } from './ManualAddressForm';
import { useRecentAddresses, AddressOption } from '@/hooks/useRecentAddresses';
import { useToast } from '@/hooks/use-toast';

interface PostcodeSelectorProps {
    detectedPostcode: string | null;
    onAddressSelect: (address: AddressOption) => void;
    onDismiss: () => void;
}

export function PostcodeSelector({ detectedPostcode, onAddressSelect, onDismiss }: PostcodeSelectorProps) {
    const [mode, setMode] = useState<'dropdown' | 'manual'>('dropdown');
    const [isLoading, setIsLoading] = useState(false);
    const [addresses, setAddresses] = useState<AddressOption[]>([]);
    const { recentAddresses, addRecentAddress } = useRecentAddresses(detectedPostcode);
    const { toast } = useToast();

    // Fetch addresses when postcode changes
    useEffect(() => {
        if (!detectedPostcode) return;

        const fetchAddresses = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/addresses/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ postcode: detectedPostcode })
                });

                const data = await res.json();

                if (data.error) {
                    // Fallback to manual if invalid or error
                    toast({
                        title: "Address Lookup Failed",
                        description: data.error,
                        variant: "destructive"
                    });
                    setMode('manual');
                } else {
                    setAddresses(data.addresses || []);
                    setMode('dropdown');
                }
            } catch (error) {
                console.error("Failed to fetch addresses:", error);
                setMode('manual'); // Auto-switch to manual on error
            } finally {
                setIsLoading(false);
            }
        };

        fetchAddresses();
    }, [detectedPostcode, toast]);

    const handleSelect = (address: AddressOption) => {
        addRecentAddress(address);
        onAddressSelect(address);
    };

    if (!detectedPostcode) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="absolute z-50 top-full left-0 mt-2 w-80 sm:w-96"
            >
                {mode === 'dropdown' ? (
                    <AddressDropdown
                        postcode={detectedPostcode}
                        addresses={addresses}
                        recentAddresses={recentAddresses}
                        isLoading={isLoading}
                        onSelect={handleSelect}
                        onManualEntry={() => setMode('manual')}
                    />
                ) : (
                    <ManualAddressForm
                        postcode={detectedPostcode}
                        onSave={handleSelect}
                        onCancel={() => setMode('dropdown')}
                    />
                )}
            </motion.div>
        </AnimatePresence>
    );
}
