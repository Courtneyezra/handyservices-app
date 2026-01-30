import { useState, useEffect } from "react";
import { MapPin, Star, Truck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import derbyMapImage from "../assets/derby_map.png";
import nottinghamMapImage from "../assets/nottingham_map.png";

interface ReviewPoint {
    id: string;
    x: number; // Percentage position 0-100
    y: number; // Percentage position 0-100
    location: string;
    service: string;
    rating: number;
}

// Derby area review locations (percentage positioning)
const DERBY_REVIEWS: ReviewPoint[] = [
    { id: "1", x: 50, y: 45, location: "Derby City", service: "Plumbing Repair", rating: 5 },
    { id: "2", x: 25, y: 30, location: "Littleover", service: "Joinery", rating: 5 },
    { id: "3", x: 75, y: 35, location: "Chaddesden", service: "Painting", rating: 4 },
    { id: "4", x: 15, y: 25, location: "Mickleover", service: "Electrical", rating: 5 },
    { id: "5", x: 80, y: 60, location: "Alvaston", service: "Gardening", rating: 5 },
    { id: "6", x: 85, y: 45, location: "Spondon", service: "TV Mounting", rating: 5 },
    { id: "7", x: 35, y: 20, location: "Allestree", service: "Bathroom Fix", rating: 5 },
    { id: "8", x: 90, y: 55, location: "Oakwood", service: "Shelf Installation", rating: 5 },
];

// Nottingham area review locations
const NOTTINGHAM_REVIEWS: ReviewPoint[] = [
    { id: "9", x: 50, y: 50, location: "Nottingham", service: "Furniture Assembly", rating: 5 },
    { id: "10", x: 30, y: 70, location: "Beeston", service: "Door Repair", rating: 5 },
    { id: "11", x: 65, y: 25, location: "Arnold", service: "Plumbing Repair", rating: 5 },
    { id: "12", x: 55, y: 75, location: "West Bridgford", service: "Electrical", rating: 5 },
    { id: "13", x: 75, y: 50, location: "Carlton", service: "Painting", rating: 4 },
    { id: "14", x: 40, y: 35, location: "Sherwood", service: "TV Mounting", rating: 5 },
];

interface AnimatedMapProps {
    location?: "derby" | "nottingham";
}

export function AnimatedMap({ location = "derby" }: AnimatedMapProps) {
    const reviews = location === "derby" ? DERBY_REVIEWS : NOTTINGHAM_REVIEWS;
    const mapImage = location === "derby" ? derbyMapImage : nottinghamMapImage;
    const [activeReviewId, setActiveReviewId] = useState<string | null>(null);

    useEffect(() => {
        const cycleReviews = () => {
            const random = reviews[Math.floor(Math.random() * reviews.length)];
            setActiveReviewId(random.id);
            setTimeout(() => setActiveReviewId(null), 4000);
        };
        const interval = setInterval(cycleReviews, 5000);
        setTimeout(cycleReviews, 1000);
        return () => clearInterval(interval);
    }, [reviews]);

    return (
        <div className="relative w-full aspect-square md:aspect-[4/3] max-w-3xl mx-auto" style={{ perspective: "1000px" }}>
            <div
                className="relative w-full h-full transition-transform duration-700 ease-out hover:scale-105"
                style={{
                    transform: "rotateX(20deg) rotateY(-10deg) rotateZ(5deg)",
                    transformStyle: "preserve-3d",
                }}
            >
                {/* The Blob Container - Background & Image Only (Clipped) */}
                <div
                    className="w-full h-full overflow-hidden bg-slate-100 relative z-0 shadow-2xl"
                    style={{
                        borderRadius: "30% 70% 70% 30% / 30% 30% 70% 70%",
                        isolation: "isolate",
                        boxShadow: "20px 20px 60px -10px rgba(0,0,0,0.5), inset -10px -10px 40px -10px rgba(0,0,0,0.2)",
                    }}
                >
                    {/* Static Map Background Image */}
                    <img
                        src={mapImage}
                        alt={`${location} map`}
                        className="absolute inset-0 w-full h-full object-cover opacity-90"
                    />
                </div>

                {/* Markers Container - Placed ON TOP of blob, NO overflow hidden */}
                <div className="absolute inset-0 z-10 w-full h-full pointer-events-none" style={{ transform: "translateZ(20px)" }}>
                    {reviews.map((review) => (
                        <div
                            key={review.id}
                            className="absolute pointer-events-auto"
                            style={{
                                left: `${review.x}%`,
                                top: `${review.y}%`,
                                transform: "translate(-50%, -50%)",
                                zIndex: activeReviewId === review.id ? 20 : 10,
                            }}
                        >
                            {/* Van Icon */}
                            <div
                                className={`bg-amber-500 text-white p-1.5 rounded-lg shadow-lg transition-all duration-300 ${activeReviewId === review.id ? "animate-bounce scale-110" : "opacity-70"
                                    }`}
                                style={{ animationDuration: "2s" }}
                            >
                                <Truck className="w-5 h-5" />
                            </div>

                            {/* Review Popup */}
                            <AnimatePresence>
                                {activeReviewId === review.id && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.8 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -10, scale: 0.8 }}
                                        transition={{ duration: 0.3 }}
                                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2"
                                        style={{ zIndex: 30 }}
                                    >
                                        <div className="bg-white/95 backdrop-blur-md border border-slate-200 p-3 rounded-xl shadow-xl w-48 text-left">
                                            <div className="flex items-center gap-1 mb-1">
                                                {[...Array(5)].map((_, i) => (
                                                    <Star
                                                        key={i}
                                                        className={`w-3 h-3 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"
                                                            }`}
                                                    />
                                                ))}
                                            </div>
                                            <div className="font-bold text-slate-900 text-sm">{review.service}</div>
                                            <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                                                <MapPin className="w-3 h-3" />
                                                {review.location}
                                            </div>
                                        </div>
                                        {/* Popup Arrow */}
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-white border-l border-t border-slate-200 rotate-45" />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>

                {/* Decorative Ring */}
                <div
                    className="absolute inset-0 border-4 border-amber-400/20 pointer-events-none z-20"
                    style={{
                        borderRadius: "30% 70% 70% 30% / 30% 30% 70% 70%",
                        transform: "translateZ(-10px) scale(1.05)",
                    }}
                />
            </div>
        </div>
    );
}

interface LocalTrustSectionProps {
    location?: "derby" | "nottingham";
}

export function LocalTrustSection({ location = "derby" }: LocalTrustSectionProps) {
    const cityName = location === "derby" ? "Derby" : "Nottingham";

    return (
        <section className="bg-transparent px-4 lg:px-8 pb-16 lg:pb-24 pt-0 -mt-1 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-1/2 h-full bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-1/2 h-full bg-amber-500/5 blur-[120px] rounded-full pointer-events-none" />

            <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative z-10">
                {/* Map on Desktop - Hidden on mobile, shown on left for desktop */}
                <div className="hidden lg:block relative p-4">
                    <AnimatedMap location={location} />
                </div>

                {/* Text Content - Flex column for mobile reordering */}
                <div className="flex flex-col text-center lg:text-right">
                    {/* Headline */}
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                        {cityName}'s Hardest Working <span className="text-amber-400">Handy Team</span>
                    </h2>

                    {/* Map on Mobile Only - Between headline and description */}
                    <div className="lg:hidden mb-8 relative p-4">
                        <AnimatedMap location={location} />
                    </div>

                    {/* Description */}
                    <p className="text-slate-400 text-lg mb-8 max-w-lg mx-auto lg:ml-auto lg:mr-0">
                        We're active across {cityName} & the surrounding areas every single day. From neighborhoods to city center, our team is busy helping neighbors just like you.
                    </p>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <p className="text-4xl font-bold text-white mb-1">15+</p>
                            <p className="text-slate-500 text-sm uppercase tracking-wider">Jobs Today</p>
                        </div>
                        <div>
                            <p className="text-4xl font-bold text-white mb-1">28m</p>
                            <p className="text-slate-500 text-sm uppercase tracking-wider">Avg Response</p>
                        </div>
                        <div>
                            <p className="text-4xl font-bold text-white mb-1">4.9</p>
                            <p className="text-slate-500 text-sm uppercase tracking-wider">Avg Rating</p>
                        </div>
                        <div>
                            <p className="text-4xl font-bold text-white mb-1">98%</p>
                            <p className="text-slate-500 text-sm uppercase tracking-wider">On Time</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
