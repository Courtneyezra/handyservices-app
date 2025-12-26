import { MessageCircle, Zap, CheckCircle } from "lucide-react";

const STEPS = [
    {
        title: "1. Tell us what you need",
        description: "Send us a message on WhatsApp or call us. No complex forms to fill out.",
        icon: MessageCircle,
        color: "bg-green-500"
    },
    {
        title: "2. Get an instant quote",
        description: "We'll provide a fixed-price quote within minutes. Transparent and fair.",
        icon: Zap,
        color: "bg-amber-400"
    },
    {
        title: "3. Job Done",
        description: "One of our vetted handymen will come over and fix it perfectly.",
        icon: CheckCircle,
        color: "bg-indigo-600"
    }
];

export function HowItWorksSection() {
    return (
        <section className="py-20 px-4 bg-slate-900 text-white">
            <div className="max-w-7xl mx-auto text-center">
                <h2 className="text-3xl md:text-4xl font-bold mb-16">How It Works</h2>

                <div className="grid lg:grid-cols-3 gap-12 relative">
                    {/* Connecting line for desktop */}
                    <div className="hidden lg:block absolute top-1/3 left-0 w-full h-0.5 bg-white/10 -z-0" />

                    {STEPS.map((step, index) => (
                        <div key={index} className="relative z-10 flex flex-col items-center">
                            <div className={`w-20 h-20 ${step.color} rounded-full flex items-center justify-center mb-8 shadow-2xl`}>
                                <step.icon className="w-10 h-10 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold mb-4">{step.title}</h3>
                            <p className="text-white/60 text-lg leading-relaxed max-w-sm">
                                {step.description}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="mt-20">
                    <a href="https://wa.me/447508744402" className="inline-flex items-center gap-3 bg-green-500 hover:bg-green-600 text-white px-10 py-5 rounded-full font-bold text-xl transition-all hover:scale-105">
                        <MessageCircle className="w-6 h-6" />
                        Start Your Quote
                    </a>
                </div>
            </div>
        </section>
    );
}
