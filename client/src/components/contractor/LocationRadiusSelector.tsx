import React, { useState, useEffect } from 'react';
import ReactGoogleAutocomplete from 'react-google-autocomplete';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Slider } from "@/components/ui/slider";
import { MapPin, Pencil } from 'lucide-react';
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
    const centerLat = value.latitude || 52.9548;
    const centerLng = value.longitude || -1.1581;
    const isLocationSet = value.latitude !== 0 && value.longitude !== 0;
    const [isEditing, setIsEditing] = useState(!isLocationSet);

    const handlePlaceSelect = (place: google.maps.places.PlaceResult) => {
        if (!place.geometry || !place.geometry.location) return;

        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

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

        setIsEditing(false);
    };

    // PHASE 1: Address input (no map yet)
    if (!isLocationSet || isEditing) {
        return (
            <div className="space-y-4">
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-[#6C6CFF]/10 flex items-center justify-center">
                            <MapPin className="w-5 h-5 text-[#6C6CFF]" />
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-white">Enter your home address</div>
                            <div className="text-xs text-slate-400">We'll find jobs near you</div>
                        </div>
                    </div>

                    <ReactGoogleAutocomplete
                        apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                        onPlaceSelected={handlePlaceSelect}
                        options={{
                            types: ['address'],
                            componentRestrictions: { country: "uk" },
                        }}
                        className="w-full h-12 rounded-xl bg-slate-900 border border-slate-600 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#6C6CFF] focus:border-transparent"
                        defaultValue={value.address}
                        placeholder="Start typing your address..."
                    />
                </div>
            </div>
        );
    }

    // PHASE 2: Map + radius (address input gone)
    return (
        <div className="relative w-full" style={{ height: 'calc(100dvh - 500px)', minHeight: '220px' }}>
            {/* Full-bleed dark map */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden border border-slate-700">
                <MapContainer
                    center={[centerLat, centerLng]}
                    zoom={10}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                    zoomControl={false}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    <MapRecenter lat={centerLat} lng={centerLng} />
                    <Marker position={[centerLat, centerLng]} />
                    <Circle
                        center={[centerLat, centerLng]}
                        radius={value.radiusMiles * 1609.34}
                        pathOptions={{ fillColor: '#6C6CFF', fillOpacity: 0.15, color: '#6C6CFF', weight: 2 }}
                    />
                </MapContainer>
            </div>

            {/* Top overlay: address summary + edit button */}
            <div className="absolute top-3 left-3 right-3 z-[1000]">
                <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="w-full bg-slate-900/85 backdrop-blur-xl rounded-xl border border-slate-700/50 px-4 py-2.5 shadow-lg flex items-center justify-between"
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <MapPin className="w-4 h-4 text-[#6C6CFF] flex-shrink-0" />
                        <span className="text-sm text-white truncate">{value.address || value.postcode}</span>
                    </div>
                    <Pencil className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 ml-2" />
                </button>
            </div>

            {/* Bottom overlay: radius slider */}
            <div className="absolute bottom-3 left-3 right-3 z-[1000]">
                <div className="bg-slate-900/85 backdrop-blur-xl rounded-xl border border-slate-700/50 px-4 py-3 shadow-lg">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Service Radius
                        </span>
                        <span className="text-sm font-bold text-white">
                            {value.radiusMiles} miles
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
            </div>
        </div>
    );
}
