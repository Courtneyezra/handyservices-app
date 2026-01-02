import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench, MapPin, Clock, Save, User, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Handyman {
    id: string;
    userId: string;
    bio: string;
    address: string;
    city: string;
    postcode: string;
    latitude: string;
    longitude: string;
    radiusMiles: number;
    skills: { serviceId: string }[];
    availability: { dayOfWeek: number; startTime: string; endTime: string }[];
}

interface SKU {
    id: string;
    name: string;
    category: string;
}

export default function HandymanDashboard() {
    const queryClient = useQueryClient();
    // For demo/prototype, we use a fixed handyman ID or get it from auth
    const handymanId = "1"; // This would come from auth in a real app

    const { data: profile, isLoading } = useQuery<Handyman>({
        queryKey: [`/api/handymen/${handymanId}`],
    });

    const { data: allSkus = [] } = useQuery<SKU[]>({
        queryKey: ["/api/skus"],
    });

    const [form, setForm] = useState({
        bio: "",
        address: "",
        city: "",
        radiusMiles: 10,
        selectedSkills: [] as string[]
    });

    const [availability, setAvailability] = useState<{ dayOfWeek: number; startTime: string; endTime: string }[]>([]);

    useEffect(() => {
        if (profile) {
            setForm({
                bio: profile.bio || "",
                address: profile.address || "",
                city: profile.city || "",
                radiusMiles: profile.radiusMiles || 10,
                selectedSkills: profile.skills.map(s => s.serviceId)
            });
            setAvailability(profile.availability || []);
        }
    }, [profile]);

    const updateProfile = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch(`/api/handymen/profile`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: profile?.userId || "user_1", ...data })
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/handymen/${handymanId}`] });
        }
    });

    const updateSkills = useMutation({
        mutationFn: async (serviceIds: string[]) => {
            const res = await fetch(`/api/handymen/${handymanId}/skills`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serviceIds })
            });
            return res.json();
        }
    });

    const updateAvailability = useMutation({
        mutationFn: async (availability: any[]) => {
            const res = await fetch(`/api/handymen/${handymanId}/availability`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ availability })
            });
            return res.json();
        },
        onSuccess: () => {
            alert("Handyman profile and settings updated successfully!");
        }
    });

    const handleSkillToggle = (id: string) => {
        setForm(prev => ({
            ...prev,
            selectedSkills: prev.selectedSkills.includes(id)
                ? prev.selectedSkills.filter(s => s !== id)
                : [...prev.selectedSkills, id]
        }));
    };

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    if (isLoading) return <div className="p-10 text-center text-slate-500">Loading profile...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">Handyman Profile</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage public bio & skills.</p>
                </div>
                <Button
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 py-6 sm:py-2"
                    onClick={() => {
                        updateProfile.mutate({
                            bio: form.bio,
                            address: form.address,
                            city: form.city,
                            radiusMiles: form.radiusMiles,
                            latitude: profile?.latitude || "52.9548",
                            longitude: profile?.longitude || "-1.1581"
                        });
                        updateSkills.mutate(form.selectedSkills);
                        updateAvailability.mutate(availability);
                    }}
                >
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                </Button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                {/* Left Column: Bio & Details */}
                <div className="lg:col-span-2 space-y-6">
                    <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                            <User className="w-5 h-5 text-blue-600" />
                            Professional Bio
                        </h3>
                        <textarea
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm min-h-[120px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                            placeholder="Tell customers about your experience and focus..."
                            value={form.bio}
                            onChange={(e) => setForm(prev => ({ ...prev, bio: e.target.value }))}
                        />
                    </section>

                    <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                            <MapPin className="w-5 h-5 text-blue-600" />
                            Service Area
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">City</label>
                                <input
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    value={form.city}
                                    onChange={(e) => setForm(prev => ({ ...prev, city: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Radius (Miles)</label>
                                <input
                                    type="number"
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    value={form.radiusMiles}
                                    onChange={(e) => setForm(prev => ({ ...prev, radiusMiles: parseInt(e.target.value) }))}
                                />
                            </div>
                        </div>
                    </section>

                    <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                            <Clock className="w-5 h-5 text-blue-600" />
                            Weekly Routine
                        </h3>
                        <div className="space-y-3">
                            {days.slice(1, 6).map((day, idx) => {
                                const dayNum = idx + 1;
                                const isAvailable = availability.some(a => a.dayOfWeek === dayNum);
                                return (
                                    <div key={day} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <span className="text-sm font-medium text-slate-700">{day}</span>
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="checkbox"
                                                checked={isAvailable}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setAvailability(prev => [...prev, { dayOfWeek: dayNum, startTime: "09:00", endTime: "17:00" }]);
                                                    } else {
                                                        setAvailability(prev => prev.filter(a => a.dayOfWeek !== dayNum));
                                                    }
                                                }}
                                                className="w-4 h-4 text-blue-600 rounded"
                                            />
                                            {isAvailable && (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="time"
                                                        className="text-xs p-1 border rounded"
                                                        value={availability.find(a => a.dayOfWeek === dayNum)?.startTime}
                                                        onChange={(e) => {
                                                            setAvailability(prev => prev.map(a =>
                                                                a.dayOfWeek === dayNum ? { ...a, startTime: e.target.value } : a
                                                            ));
                                                        }}
                                                    />
                                                    <span className="text-xs text-slate-400">to</span>
                                                    <input
                                                        type="time"
                                                        className="text-xs p-1 border rounded"
                                                        value={availability.find(a => a.dayOfWeek === dayNum)?.endTime}
                                                        onChange={(e) => {
                                                            setAvailability(prev => prev.map(a =>
                                                                a.dayOfWeek === dayNum ? { ...a, endTime: e.target.value } : a
                                                            ));
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>

                {/* Right Column: Skills */}
                <div className="space-y-6">
                    <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                            <Wrench className="w-5 h-5 text-blue-600" />
                            Core Skills
                        </h3>
                        <div className="space-y-2 max-h-[600px] overflow-auto pr-2">
                            {allSkus.map(sku => {
                                const isSelected = form.selectedSkills.includes(sku.id);
                                return (
                                    <div
                                        key={sku.id}
                                        onClick={() => handleSkillToggle(sku.id)}
                                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300"
                                            }`}
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold">{sku.name}</span>
                                            <span className="text-[10px] uppercase font-medium opacity-60">{sku.category}</span>
                                        </div>
                                        {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
