import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
    MapPin,
    Search,
    Loader2,
    ArrowRight
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

// Fix Leaflet marker icon
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIconRetina from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIconRetina,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

import { motion } from "framer-motion";
import { Home, Briefcase } from 'lucide-react';

// Animated explainer component
function ServiceAreaExplainer() {
    return (
        <div className="bg-slate-900/50 rounded-xl p-6 mb-6 border border-white/5 overflow-hidden relative group">
            <div className="flex items-center gap-4 relative z-10">
                <div className="relative shrink-0">
                    {/* Radar Pulse Animation */}
                    <motion.div
                        initial={{ opacity: 0.5, scale: 0.8 }}
                        animate={{ opacity: 0, scale: 1.5 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                        className="absolute inset-0 bg-amber-500/30 rounded-full"
                    />
                    <motion.div
                        initial={{ opacity: 0.5, scale: 0.8 }}
                        animate={{ opacity: 0, scale: 1.5 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
                        className="absolute inset-0 bg-amber-500/20 rounded-full"
                    />

                    {/* Home Icon */}
                    <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center border border-amber-500/30 relative z-20 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                        <Home className="w-5 h-5 text-amber-500" />
                    </div>

                    {/* Job Popups Animation */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                        animate={{ opacity: [0, 1, 1, 0], scale: [0, 1, 1, 0.5], x: 20, y: -20 }}
                        transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                        className="absolute top-0 right-0 z-30"
                    >
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center border border-white/20 shadow-lg">
                            <Briefcase className="w-3 h-3 text-white" />
                        </div>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                        animate={{ opacity: [0, 1, 1, 0], scale: [0, 1, 1, 0.5], x: -25, y: 10 }}
                        transition={{ duration: 2.5, repeat: Infinity, delay: 1.2 }}
                        className="absolute bottom-0 left-0 z-30"
                    >
                        <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center border border-white/20 shadow-lg">
                            <Briefcase className="w-2.5 h-2.5 text-white" />
                        </div>
                    </motion.div>
                </div>

                <div className="flex-1">
                    <h3 className="text-white font-medium text-sm mb-1">How it works</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                        We use your <span className="text-amber-400 font-medium">Home Address</span> as the center point. You'll only receive jobs within your set radius.
                    </p>
                </div>
            </div>

            {/* Background Grid */}
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_14px]"></div>
        </div>
    );
}

// Map updater component
function MapUpdater({ center, zoom }: { center: [number, number], zoom: number }) {
    const map = useMap();
    useEffect(() => {
        map.setView(center, zoom);
    }, [center, zoom, map]);
    return null;
}

interface AddressResult {
    formattedAddress: string;
    placeId: string;
    coordinates: {
        lat: number;
        lng: number;
    }
}

export default function ContractorServiceArea() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // State
    const [addressQuery, setAddressQuery] = useState('');
    const [searchResults, setSearchResults] = useState<AddressResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [latitude, setLatitude] = useState<number>(51.5074); // Default London
    const [longitude, setLongitude] = useState<number>(-0.1278);
    const [radiusMiles, setRadiusMiles] = useState<number>(10);
    const [selectedAddress, setSelectedAddress] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [mode, setMode] = useState<'suggested' | 'custom'>('custom');

    // Initial data fetch
    const { data: profileData, isLoading: isLoadingProfile } = useQuery({
        queryKey: ['contractor-profile'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            if (!token) throw new Error('No token found');

            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                if (res.status === 401) {
                    setLocation('/contractor/login');
                    throw new Error('Unauthorized');
                }
                throw new Error('Failed to fetch profile');
            }
            return res.json();
        },
    });

    useEffect(() => {
        if (profileData?.profile) {
            setRadiusMiles(profileData.profile.radiusMiles || 10);
            if (profileData.profile.latitude && profileData.profile.longitude) {
                setLatitude(parseFloat(profileData.profile.latitude));
                setLongitude(parseFloat(profileData.profile.longitude));
            } else if (profileData.profile.postcode) {
                setAddressQuery(profileData.profile.postcode);
                handleSearch(profileData.profile.postcode);
            }

            if (profileData.profile.address) {
                setSelectedAddress(profileData.profile.address);
                if (!addressQuery) setAddressQuery(profileData.profile.address);
            }
        }
    }, [profileData]);

    // Search addresses
    const handleSearch = async (query: string) => {
        if (!query || query.length < 3) return;

        setIsSearching(true);
        try {
            console.log(`Fetching: /api/places/search?query=${encodeURIComponent(query)}`);
            const res = await fetch(`/api/places/search?query=${encodeURIComponent(query)}`);

            const text = await res.text();
            console.log('Search response:', text.substring(0, 100)); // Log first 100 chars

            if (!res.ok) {
                console.error('Search failed:', res.status, res.statusText, text);
                throw new Error(`Search failed: ${res.status}`);
            }

            try {
                const data = JSON.parse(text);
                if (data.results) {
                    setSearchResults(data.results);
                    setShowResults(true);
                }
            } catch (jsonError) {
                console.error('JSON Parse Error:', jsonError, 'Raw text:', text);
                throw new Error('Invalid server response');
            }

        } catch (error) {
            console.error('Search error details:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (addressQuery && addressQuery !== selectedAddress) {
                handleSearch(addressQuery);
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [addressQuery, selectedAddress]);

    // Select address
    const handleSelectAddress = (result: AddressResult) => {
        setLatitude(result.coordinates.lat);
        setLongitude(result.coordinates.lng);
        setSelectedAddress(result.formattedAddress);
        setAddressQuery(result.formattedAddress);
        setShowResults(false);
    };

    // Save mutation
    const updateProfileMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    latitude,
                    longitude,
                    radiusMiles: mode === 'suggested' ? 5 : radiusMiles, // Default small radius if suggest
                    address: selectedAddress
                }),
            });
            if (!res.ok) throw new Error('Failed to update service area');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-profile'] });
            toast({
                title: "Location Saved",
                description: "Your service area has been updated.",
            });
            setTimeout(() => setLocation('/contractor'), 1000);
        },
        onError: () => {
            toast({
                title: "Update Failed",
                description: "Could not save settings. Please try again.",
                variant: "destructive",
            });
        }
    });

    if (isLoadingProfile) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Header */}
            <header className="bg-slate-800/50 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 w-full">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-3">
                            <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain" />
                            <span className="text-white font-semibold">Service Area</span>
                        </div>

                        <button
                            onClick={() => setLocation('/contractor')}
                            className="text-slate-400 text-sm hover:text-white transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-8 w-full flex flex-col lg:flex-row gap-8">
                {/* Controls - Left Side */}
                <div className="hidden lg:flex w-80 flex-col gap-6 shrink-0 h-[calc(100vh-140px)] min-h-[500px]">
                    <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 flex flex-col h-full">
                        <h2 className="text-xl font-bold text-white mb-2">Set Location</h2>
                        <p className="text-slate-400 text-sm mb-6">
                            Enter your <strong className="text-white">permanent home address</strong>. This will be the center of your service radius for job allocation.
                        </p>

                        <ServiceAreaExplainer />

                        {/* Search */}
                        <div className="relative mb-6">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Home Address</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={addressQuery}
                                    onChange={(e) => setAddressQuery(e.target.value)}
                                    onFocus={() => {
                                        if (searchResults.length > 0) setShowResults(true);
                                    }}
                                    placeholder="Enter home address"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-amber-500/50 transition-all placeholder:text-slate-600 text-sm"
                                />
                                {isSearching && (
                                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 animate-spin" />
                                )}
                            </div>

                            {/* Search Results */}
                            {showResults && searchResults.length > 0 && (
                                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                    {searchResults.map((result) => (
                                        <button
                                            key={result.placeId}
                                            onClick={() => handleSelectAddress(result)}
                                            className="w-full text-left px-4 py-3 hover:bg-slate-700/50 transition-colors flex items-center gap-3 border-b border-white/5 last:border-0"
                                        >
                                            <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-sm text-white font-medium truncate">{result.formattedAddress.split(',')[0]}</p>
                                                <p className="text-xs text-slate-400 truncate">{result.formattedAddress}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Radius Controls */}
                        <div className="space-y-6">
                            <RadioGroup
                                value={mode}
                                onValueChange={(v) => setMode(v as 'suggested' | 'custom')}
                                className="space-y-4"
                            >
                                <div className={`border rounded-xl p-4 transition-all cursor-pointer ${mode === 'suggested' ? 'border-amber-500/50 bg-amber-500/10' : 'border-white/10 bg-slate-900/20 hover:border-white/20'}`}>
                                    <div className="flex items-start justify-between">
                                        <Label htmlFor="suggested" className="cursor-pointer">
                                            <div className="font-semibold text-white mb-1">Standard Radius</div>
                                            <p className="text-xs text-slate-400">Local area only (5 miles)</p>
                                        </Label>
                                        <RadioGroupItem value="suggested" id="suggested" className="text-amber-500 border-slate-500" />
                                    </div>
                                </div>

                                <div className={`border rounded-xl p-4 transition-all cursor-pointer ${mode === 'custom' ? 'border-amber-500/50 bg-amber-500/10' : 'border-white/10 bg-slate-900/20 hover:border-white/20'}`}>
                                    <div className="flex items-start justify-between mb-4">
                                        <Label htmlFor="custom" className="cursor-pointer">
                                            <div className="font-semibold text-white mb-1">Custom Radius</div>
                                            <p className="text-xs text-slate-400">Set specific distance</p>
                                        </Label>
                                        <RadioGroupItem value="custom" id="custom" className="text-amber-500 border-slate-500" />
                                    </div>

                                    {mode === 'custom' && (
                                        <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                                            <div className="flex items-center justify-between mb-4 text-xs font-medium text-amber-500">
                                                <span>{radiusMiles} miles</span>
                                            </div>
                                            <Slider
                                                defaultValue={[radiusMiles]}
                                                min={1}
                                                max={50}
                                                step={1}
                                                onValueChange={(val) => setRadiusMiles(val[0])}
                                                className="py-2"
                                            />
                                            <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                                                <span>1mi</span>
                                                <span>50mi</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </RadioGroup>
                        </div>

                        <div className="mt-auto pt-6">
                            <button
                                onClick={() => updateProfileMutation.mutate()}
                                disabled={updateProfileMutation.isPending}
                                className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
                            >
                                {updateProfileMutation.isPending ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        Save Changes
                                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile Controls (Drawer style) can be implemented here if needed, but for now stacking map + sidebar */}

                {/* Map Area */}
                <div className="flex-1 relative bg-slate-900 overflow-hidden shadow-2xl h-[calc(100vh-100px)] lg:h-[calc(100vh-140px)] rounded-2xl border border-white/10 lg:rounded-2xl"><div className="absolute inset-0 z-0">






                    <MapContainer
                        center={[latitude, longitude]}
                        zoom={11}
                        style={{ height: "100%", width: "100%" }}
                        zoomControl={false}
                    >
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <MapUpdater center={[latitude, longitude]} zoom={profileData?.profile?.radiusMiles > 20 ? 9 : 11} />

                        <Marker position={[latitude, longitude]} />

                        <Circle
                            center={[latitude, longitude]}
                            pathOptions={{
                                fillColor: '#f59e0b', // Amber to match app
                                color: '#d97706',
                                fillOpacity: 0.2,
                                weight: 2
                            }}
                            radius={(mode === 'suggested' ? 5 : radiusMiles) * 1609.34}
                        />
                    </MapContainer>
                </div>

                    {/* Mobile Only: Top Explainer Overlay */}
                    <div className="lg:hidden absolute top-4 left-4 right-4 z-[500] pointer-events-none">
                        <div className="pointer-events-auto">
                            <ServiceAreaExplainer />
                        </div>
                    </div>

                    {/* Mobile Only: Bottom Controls Overlay */}
                    <div className="lg:hidden absolute bottom-4 left-4 right-4 z-[500]">
                        <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl">
                            <div className="flex flex-col gap-4">
                                {/* Address Input */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Home Address</label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={addressQuery}
                                            onChange={(e) => setAddressQuery(e.target.value)}
                                            onFocus={() => {
                                                if (searchResults.length > 0) setShowResults(true);
                                            }}
                                            placeholder="Enter permanent home address"
                                            className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-amber-500/50 placeholder:text-slate-600 transition-all shadow-inner"
                                        />
                                        {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 animate-spin" />}
                                    </div>

                                    {/* Dropdown Results */}
                                    {showResults && searchResults.length > 0 && (
                                        <div className="absolute bottom-full mb-2 left-0 right-0 bg-slate-800 border border-white/10 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-[600]">
                                            {searchResults.map((result) => (
                                                <button
                                                    key={result.placeId}
                                                    onClick={() => handleSelectAddress(result)}
                                                    className="w-full text-left px-4 py-3 hover:bg-slate-700/50 transition-colors flex items-center gap-3 border-b border-white/5 last:border-0"
                                                >
                                                    <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                                                    <div className="min-w-0">
                                                        <p className="text-sm text-white font-medium truncate">{result.formattedAddress.split(',')[0]}</p>
                                                        <p className="text-xs text-slate-400 truncate">{result.formattedAddress}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Radius Slider */}
                                <div>
                                    <div className="flex justify-between items-center mb-2 px-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Service Radius</span>
                                        <span className="text-sm font-bold text-amber-500">{radiusMiles} miles</span>
                                    </div>
                                    <Slider
                                        defaultValue={[radiusMiles]}
                                        min={1}
                                        max={50}
                                        step={1}
                                        onValueChange={(val) => setRadiusMiles(val[0])}
                                        className="py-1 [&>span[data-orientation=horizontal]]:bg-slate-700 [&>span[data-orientation=horizontal]>.bg-primary]:bg-amber-500 [&>span[role=slider]]:!bg-white [&>span[role=slider]]:!border-0 [&>span[role=slider]]:!w-6 [&>span[role=slider]]:!h-6 shadow-lg"
                                    />
                                </div>

                                {/* Save Button */}
                                <button
                                    onClick={() => updateProfileMutation.mutate()}
                                    className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                >
                                    {updateProfileMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Location"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
