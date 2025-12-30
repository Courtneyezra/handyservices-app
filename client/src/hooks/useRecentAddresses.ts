// F8: Recent Addresses Cache (Frontend)

import { useState, useEffect } from 'react';

export interface AddressOption {
    formattedAddress: string;
    placeId: string;
    streetAddress: string;
    coordinates: {
        lat: number;
        lng: number;
    };
    lastUsed?: number;
}

const STORAGE_KEY_PREFIX = 'recent_addresses_';
const MAX_RECENT_ADDRESSES = 5;
const EXPIRY_DAYS = 30;

export function useRecentAddresses(postcode: string | null) {
    const [recentAddresses, setRecentAddresses] = useState<AddressOption[]>([]);

    useEffect(() => {
        if (!postcode) {
            setRecentAddresses([]);
            return;
        }

        const normalizedPostcode = postcode.replace(/\s/g, '').toUpperCase();
        const key = `${STORAGE_KEY_PREFIX}${normalizedPostcode}`;

        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed: AddressOption[] = JSON.parse(stored);
                // Filter out expired (though we only check on load)
                // and sort by lastUsed desc
                const valid = parsed.filter(addr => {
                    if (!addr.lastUsed) return true; // Legacy support
                    const daysDiff = (Date.now() - addr.lastUsed) / (1000 * 60 * 60 * 24);
                    return daysDiff < EXPIRY_DAYS;
                }).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

                setRecentAddresses(valid);
            } else {
                setRecentAddresses([]);
            }
        } catch (e) {
            console.error('Failed to load recent addresses', e);
            setRecentAddresses([]);
        }
    }, [postcode]);

    const addRecentAddress = (address: AddressOption) => {
        if (!postcode) return;

        const normalizedPostcode = postcode.replace(/\s/g, '').toUpperCase();
        const key = `${STORAGE_KEY_PREFIX}${normalizedPostcode}`;

        // Add timestamp
        const newEntry = { ...address, lastUsed: Date.now() };

        setRecentAddresses(prev => {
            // Remove duplicates (by placeId)
            const filtered = prev.filter(a => a.placeId !== address.placeId);

            // Add new to top
            const updated = [newEntry, ...filtered].slice(0, MAX_RECENT_ADDRESSES);

            // Persist
            try {
                localStorage.setItem(key, JSON.stringify(updated));
            } catch (e) {
                console.error('Failed to save recent addresses', e);
            }

            return updated;
        });
    };

    return {
        recentAddresses,
        addRecentAddress
    };
}
