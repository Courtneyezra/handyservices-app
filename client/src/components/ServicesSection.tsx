import { Wrench, Droplets, Zap, Paintbrush, Hammer, Ruler } from "lucide-react";

const SERVICES = [
    { name: "Plumbing", icon: Droplets, description: "Tap replacements, leak repairs, and shower installations." },
    { name: "Electrical", icon: Zap, description: "Light fixtures, socket replacements, and minor repairs." },
    { name: "General Repairs", icon: Wrench, description: "Furniture assembly, TV mounting, and door adjustments." },
    { name: "Painting", icon: Paintbrush, description: "Room painting, touch-ups, and wallpapering." },
    { name: "Carpentry", icon: Hammer, description: "Shelving, door hanging, and flooring repairs." },
    { name: "Maintenance", icon: Ruler, description: "Gutter cleaning, pressure washing, and more." }
];

export function ServicesSection() {
    return (
        <section className="py-20 px-4 bg-white">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Our Services</h2>
                    <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                        We handle a wide range of tasks to keep your home in perfect shape. No job is too small.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {SERVICES.map((service, index) => (
                        <div key={index} className="p-8 bg-slate-50 rounded-3xl border border-slate-100 hover:shadow-xl transition-all group">
                            <div className="w-14 h-14 bg-amber-400 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <service.icon className="w-7 h-7 text-slate-900" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-3">{service.name}</h3>
                            <p className="text-slate-600 leading-relaxed">{service.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
