import React, { useState, useEffect } from 'react';
import ReactGoogleAutocomplete from 'react-google-autocomplete';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Slider } from "@/components/ui/slider";
import { MapPin } from 'lucide-react';
import L from 'leaflet';

// Fix for default Leaflet marker icon
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface LocationData {
    address: string;
    city: string;
    postcode: string;
    latitude: number;
    longitude: number;
    radiusMiles: number;
}

interface LocationRadiusSelectorProps {
    value: LocationData;
    onChange: (data: LocationData) => void;
}

// Component to recenter map when coords change
function MapRecenter({ lat, lng }: { lat: number, lng: number }) {
    const map = useMap();
    useEffect(() => {
        map.setView([lat, lng], map.getZoom());
    }, [lat, lng, map]);
    return null;
}

export function LocationRadiusSelector({ value, onChange }: LocationRadiusSelectorProps) {
    // Default to Nottingham if no coords provided
    const centerLat = value.latitude || 52.9548;
    const centerLng = value.longitude || -1.1581;
    const isLocationSet = value.latitude !== 0 && value.longitude !== 0;

    const handlePlaceSelect = (place: google.maps.places.PlaceResult) => {
        if (!place.geometry || !place.geometry.location) return;

        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        // Extract address components
        let postcode = '';
        let city = '';

        place.address_components?.forEach(comp => {
            if (comp.types.includes('postal_code')) postcode = comp.long_name;
            if (comp.types.includes('postal_town') || comp.types.includes('locality')) city = comp.long_name;
        });

        onChange({
            ...value,
            address: place.formatted_address || '',
            latitude: lat,
            longitude: lng,
            postcode: postcode,
            city: city
        });
    };

    return (
        <div className="relative w-full" style={{ height: 'calc(100dvh - 500px)', minHeight: '220px' }}>
            {/* Full-bleed map background */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden border border-slate-700">
                <MapContainer
                    center={[centerLat, centerLng]}
                    zoom={isLocationSet ? 10 : 8}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                    zoomControl={false}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    <MapRecenter lat={centerLat} lng={centerLng} />

                    {isLocationSet && (
                        <>
                            <Marker position={[centerLat, centerLng]} />
                            <Circle
                                center={[centerLat, centerLng]}
                                radius={value.radiusMiles * 1609.34}
                                pathOptions={{ fillColor: '#6C6CFF', fillOpacity: 0.15, color: '#6C6CFF', weight: 2 }}
                            />
                        </>
                    )}
                </MapContainer>
            </div>

            {/* Glass overlay controls — pinned to top */}
            <div className="absolute top-4 left-4 right-4 z-[1000]">
                <div className="bg-slate-900/85 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-4 shadow-2xl space-y-4">
                    {/* Address input */}
                    <div>
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                            Your home address
                        </label>
                        <div className="relative">
                            <ReactGoogleAutocomplete
                                apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                                onPlaceSelected={handlePlaceSelect}
                                options={{
                                    types: ['address'],
                                    componentRestrictions: { country: "uk" },
                                }}
                                className="w-full h-12 rounded-xl bg-slate-800 border border-slate-600 px-4 pr-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6C6CFF] focus:border-transparent"
                                defaultValue={value.address}
                                placeholder="Start typing your address..."
                            />
                            <MapPin className="absolute right-3 top-3.5 h-5 w-5 text-slate-500" />
                        </div>
                    </div>

                    {/* Radius slider — only show after location is set */}
                    {isLocationSet && (
                        <div className="animate-in fade-in duration-300">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                    Service Radius
                                </label>
                                <span className="text-sm font-bold text-white">
                                    {value.radiusMiles} miles
                                    <span className="text-slate-500 font-normal ml-1">
                                        (~{(value.radiusMiles * 1.609).toFixed(0)} km)
                                    </span>
                                </span>
                            </div>
                            <Slider
                                value={[value.radiusMiles]}
                                max={30}
                                step={1}
                                min={3}
                                onValueChange={(vals) => onChange({ ...value, radiusMiles: vals[0] })}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Subtle gradient at bottom for depth */}
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#0F172A] to-transparent rounded-b-2xl pointer-events-none z-[999]" />
        </div>
    );
}
