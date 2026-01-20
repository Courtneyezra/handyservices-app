import React, { useState, useEffect } from 'react';
import ReactGoogleAutocomplete from 'react-google-autocomplete';
import { MapContainer, TileLayer, Circle, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
    // Default to London if no coords provided
    const centerLat = value.latitude || 51.505;
    const centerLng = value.longitude || -0.09;
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
        <div className="space-y-6">
            <div className="space-y-2">
                <Label className="text-base font-semibold">Enter your home address</Label>
                <div className="relative">
                    <ReactGoogleAutocomplete
                        apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                        onPlaceSelected={handlePlaceSelect}
                        options={{
                            types: ['address'],
                            componentRestrictions: { country: "uk" },
                        }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        defaultValue={value.address}
                        placeholder="Enter your base address"
                    />
                    <MapPin className="absolute right-3 top-2.5 h-5 w-5 text-gray-400" />
                </div>
            </div>

            {isLocationSet && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <Label>Service Radius: {value.radiusMiles} miles</Label>
                            <span className="text-sm text-gray-500">
                                (~{(value.radiusMiles * 1.609).toFixed(1)} km)
                            </span>
                        </div>
                        <Slider
                            value={[value.radiusMiles]}
                            max={50}
                            step={1}
                            min={1}
                            onValueChange={(vals) => onChange({ ...value, radiusMiles: vals[0] })}
                        />
                    </div>

                    <Card className="h-[300px] overflow-hidden rounded-lg border-2 border-gray-100">
                        {/* Key forces remount on visual toggling if needed, but simple coord update usually works */}
                        <MapContainer
                            center={[centerLat, centerLng]}
                            zoom={10}
                            style={{ height: '100%', width: '100%' }}
                            scrollWheelZoom={false}
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                            />
                            <MapRecenter lat={centerLat} lng={centerLng} />

                            <Marker position={[centerLat, centerLng]} />
                            <Circle
                                center={[centerLat, centerLng]}
                                radius={value.radiusMiles * 1609.34} // Convert miles to meters
                                pathOptions={{ fillColor: 'blue', fillOpacity: 0.1, color: 'blue', weight: 1 }}
                            />
                        </MapContainer>
                    </Card>
                </div>
            )}
        </div>
    );
}
