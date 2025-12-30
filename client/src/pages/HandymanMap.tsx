import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { Wrench, MapPin, Search, Filter, Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

// Fix Leaflet marker icon issue
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

interface Handyman {
    id: string;
    bio: string;
    address: string;
    city: string;
    postcode: string;
    latitude: string;
    longitude: string;
    radiusMiles: number;
    user: {
        firstName: string;
        lastName: string;
        email: string;
    };
    skills: {
        id: string;
        service: {
            id: string;
            name: string;
            category: string;
        };
    }[];
}

export default function HandymanMap() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("All");

    const { data: handymen, isLoading } = useQuery<Handyman[]>({
        queryKey: ["/api/handymen"],
    });

    const filteredHandymen = handymen?.filter(h => {
        const matchesSearch =
            `${h.user.firstName} ${h.user.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
            h.bio?.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCategory = selectedCategory === "All" ||
            h.skills.some(s => s.service.category === selectedCategory);

        return matchesSearch && matchesCategory;
    });

    const categories = Array.from(new Set(handymen?.flatMap(h => h.skills.map(s => s.service.category)) || [])).filter(Boolean);

    return (
        <div className="h-screen flex bg-slate-900 text-white overflow-hidden">
            {/* Sidebar Filters */}
            <div className="w-80 flex flex-col gap-6 bg-slate-800 p-6 border-r border-slate-700 overflow-hidden">
                <div>
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white">
                        <Filter className="w-5 h-5 text-green-500" />
                        Filters
                    </h3>

                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search handymen..."
                                className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/20"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Category</label>
                            <select
                                className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500/20"
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                            >
                                <option value="All">All Categories</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto">
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
                        Nearby Pros ({filteredHandymen?.length || 0})
                    </h3>
                    <div className="space-y-3">
                        {filteredHandymen?.map(h => (
                            <div key={h.id} className="p-4 bg-slate-700 rounded-xl border border-slate-600 hover:border-green-500/50 hover:bg-slate-700/80 transition-all cursor-pointer group">
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white font-bold text-xs">
                                            {h.user.firstName[0]}{h.user.lastName[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-white">{h.user.firstName} {h.user.lastName}</p>
                                            <p className="text-xs text-slate-400 uppercase font-medium">{h.city}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 bg-slate-600 px-2 py-0.5 rounded-full">
                                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                        <span className="text-[10px] font-bold text-white">4.9</span>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {h.skills.slice(0, 3).map(s => (
                                        <span key={s.id} className="text-[10px] bg-slate-600 text-slate-300 px-2 py-0.5 rounded-md">
                                            {s.service.name}
                                        </span>
                                    ))}
                                    {h.skills.length > 3 && (
                                        <span className="text-[10px] bg-slate-700 text-slate-500 px-2 py-0.5 rounded-md">
                                            +{h.skills.length - 3} more
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative">
                {isLoading ? (
                    <div className="absolute inset-0 bg-slate-50 flex items-center justify-center z-[1000]">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm font-medium text-slate-500">Loading map...</p>
                        </div>
                    </div>
                ) : (
                    <MapContainer
                        center={[52.9548, -1.1581]} // Default Nottingham
                        zoom={11}
                        style={{ height: "100%", width: "100%" }}
                    >
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        {filteredHandymen?.map(h => (
                            <div key={h.id}>
                                <Marker position={[parseFloat(h.latitude), parseFloat(h.longitude)]}>
                                    <Popup className="handyman-popup">
                                        <div className="p-1 min-w-[200px]">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                                                    {h.user.firstName[0]}{h.user.lastName[0]}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-800 text-base leading-tight">
                                                        {h.user.firstName} {h.user.lastName}
                                                    </h4>
                                                    <p className="text-xs text-slate-500">Member since 2024</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2 mb-4">
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <MapPin className="w-3.5 h-3.5 text-blue-500" />
                                                    {h.address}, {h.postcode}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <Wrench className="w-3.5 h-3.5 text-blue-500" />
                                                    {h.radiusMiles} mile coverage radius
                                                </div>
                                            </div>

                                            <div className="border-t border-slate-100 pt-3">
                                                <Button className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700">
                                                    View Dashboard
                                                </Button>
                                            </div>
                                        </div>
                                    </Popup>
                                </Marker>
                                <Circle
                                    center={[parseFloat(h.latitude), parseFloat(h.longitude)]}
                                    pathOptions={{ fillColor: 'blue', color: 'blue', fillOpacity: 0.1, weight: 1 }}
                                    radius={h.radiusMiles * 1609.34} // Convert miles to meters
                                />
                            </div>
                        ))}
                    </MapContainer>
                )}
            </div>
        </div>
    );
}
