import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, MapPin, Search, Star, Edit2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AddressOption } from '@/hooks/useRecentAddresses';

interface AddressDropdownProps {
    postcode: string;
    addresses: AddressOption[];
    recentAddresses: AddressOption[];
    onSelect: (address: AddressOption) => void;
    onManualEntry: () => void;
    isLoading?: boolean;
}

export function AddressDropdown({
    postcode,
    addresses,
    recentAddresses,
    onSelect,
    onManualEntry,
    isLoading
}: AddressDropdownProps) {
    const [filter, setFilter] = useState('');

    const filteredAddresses = useMemo(() => {
        if (!filter) return addresses;
        return addresses.filter(addr =>
            addr.formattedAddress.toLowerCase().includes(filter.toLowerCase())
        );
    }, [addresses, filter]);

    // Separate logic for showing recent addresses to handle duplicates in view
    // We only show "Available Addresses" that are NOT in "Recent" if we want to be clean, 
    // but usually user just wants both lists.
    // For simplicity, we just list them.

    return (
        <div className="w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden text-sm">
            <div className="p-3 border-b border-slate-700">
                <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-0">
                        📍 {postcode}
                    </Badge>
                    <span className="text-slate-400 text-xs">
                        {addresses.length} addresses found
                    </span>
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                        placeholder="Filter by street or number..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="pl-9 h-9 bg-slate-800 border-slate-700 focus-visible:ring-emerald-500"
                        autoFocus
                    />
                </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto custom-scrollbar bg-slate-800">
                {isLoading ? (
                    <div className="p-4 space-y-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-8 bg-slate-700/50 rounded animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* Recent Addresses */}
                        {recentAddresses.length > 0 && !filter && (
                            <div className="mb-1">
                                <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-900/50 sticky top-0 backdrop-blur-sm z-10 flex items-center gap-1">
                                    <Star className="w-3 h-3 text-amber-500" /> RECENT
                                </div>
                                {recentAddresses.map((addr) => (
                                    <button
                                        key={`recent-${addr.placeId}`}
                                        onClick={() => onSelect(addr)}
                                        className="w-full text-left px-4 py-2 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors flex items-center gap-2 group"
                                    >
                                        <MapPin className="w-4 h-4 text-amber-500" />
                                        <div className="flex-1 truncate">
                                            <div className="font-medium truncate">{addr.streetAddress}</div>
                                            <div className="text-xs text-slate-500 truncate group-hover:text-emerald-500/70">{addr.formattedAddress}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* All Addresses */}
                        <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-900/50 sticky top-0 backdrop-blur-sm z-10">
                            ALL ADDRESSES
                        </div>

                        {filteredAddresses.length === 0 ? (
                            <div className="p-4 text-center text-slate-500">
                                No addresses match "{filter}"
                            </div>
                        ) : (
                            filteredAddresses.map((addr) => (
                                <button
                                    key={addr.placeId}
                                    onClick={() => onSelect(addr)}
                                    className="w-full text-left px-4 py-2 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors flex items-start gap-3 group border-b border-white/5 last:border-0"
                                >
                                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-600 group-hover:bg-emerald-500 transition-colors shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">{addr.streetAddress}</div>
                                        <div className="text-xs text-slate-500 truncate group-hover:text-emerald-500/70">{addr.formattedAddress}</div>
                                    </div>
                                </button>
                            ))
                        )}
                    </>
                )}
            </div>

            <div className="p-2 border-t border-slate-700 bg-slate-900">
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-slate-400 hover:text-white hover:bg-slate-800"
                    onClick={onManualEntry}
                >
                    <Edit2 className="w-4 h-4 mr-2" />
                    Not listed? Enter manually
                </Button>
            </div>
        </div>
    );
}
