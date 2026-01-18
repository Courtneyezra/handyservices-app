
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowRight } from "lucide-react";

import Autocomplete from "react-google-autocomplete";

export function DesktopLeadForm() {
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [formData, setFormData] = useState({
        jobDescription: "",
        postcode: "",
        phone: ""
    });
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.jobDescription || !formData.phone) {
            toast({
                title: "Missing details",
                description: "Please describe your job and provide a phone number.",
                variant: "destructive"
            });
            return;
        }

        setLoading(true);

        try {
            await apiRequest("POST", "/api/leads", {
                customerName: "Website Visitor", // Default
                phone: formData.phone,
                jobDescription: formData.jobDescription,
                postcode: formData.postcode, // Make sure backend handles this or adds to description
                source: "desktop_hero_flow",
                outcome: "new_lead"
            });

            setSuccess(true);
            toast({
                title: "Request Received!",
                description: "We'll be in touch shortly with your free quote.",
            });
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "Something went wrong. Please try calling us instead.",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="bg-slate-900/50 backdrop-blur-sm border border-emerald-500/30 p-8 rounded-2xl max-w-lg">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                        <ArrowRight className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-2xl font-bold text-white">Request Received!</h3>
                    <p className="text-slate-300">
                        Thanks! One of our team will review your request and contact you at <span className="text-emerald-400 font-mono">{formData.phone}</span> shortly.
                    </p>
                    <Button
                        onClick={() => {
                            setSuccess(false);
                            setFormData({ jobDescription: "", postcode: "", phone: "" });
                        }}
                        variant="outline"
                        className="mt-4 border-slate-600 text-slate-300 hover:text-white"
                    >
                        Send another request
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl max-w-lg w-full relative overflow-hidden group">
            {/* Glow effect */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

            <div className="mb-6 relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                    <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Available Now</span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Get a Fixed Price Quote</h3>
                <p className="text-slate-300 text-sm">Enter your details. We'll verify availability and call you back with a price.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
                <div>
                    <Textarea
                        placeholder="What needs doing? (e.g. leaking tap, TV mounting...)"
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 min-h-[100px] text-lg resize-none focus-visible:ring-emerald-500 rounded-xl"
                        value={formData.jobDescription}
                        onChange={(e) => setFormData({ ...formData, jobDescription: e.target.value })}
                        required
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Autocomplete
                        apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                        onPlaceSelected={(place) => {
                            if (place.address_components) {
                                // Try to extract postcode specifically
                                const postcodeComp = place.address_components.find((c: any) => c.types.includes('postal_code'));
                                const postcode = postcodeComp ? postcodeComp.long_name : place.formatted_address;
                                setFormData({ ...formData, postcode: postcode || "" });
                            } else if (place.formatted_address) {
                                setFormData({ ...formData, postcode: place.formatted_address });
                            }
                        }}
                        options={{
                            componentRestrictions: { country: "gb" },
                            types: ["postal_code"], // Restrict to postcodes
                        }}
                        defaultValue={formData.postcode}
                        placeholder="Postcode / Address"
                        className="flex h-12 w-full rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2 text-lg text-white ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        onChange={(e: any) => setFormData({ ...formData, postcode: e.target.value })}
                    />
                    <Input
                        placeholder="Phone Number"
                        type="tel"
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 h-12 text-lg focus-visible:ring-emerald-500 rounded-xl"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                </div>

                <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-14 text-xl font-bold rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-900 shadow-lg shadow-amber-400/20 transition-all hover:scale-[1.02] active:scale-95"
                >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Request Call Back"}
                </Button>

                <div className="text-center pt-4 border-t border-white/5 mt-4">
                    <p className="text-sm text-slate-400 mb-1">In a hurry? Call us directly:</p>
                    <a href="tel:+447449501762" className="text-xl font-bold text-white tracking-wide hover:text-emerald-400 transition-colors">
                        07449 501 762
                    </a>
                </div>
            </form>
        </div>
    );
}
