/**
 * Internal-link block for the city landing pages → the server-rendered
 * /:city/:trade SEO pages. Fixes the orphan-page problem (GSC: trade pages
 * "Discovered – currently not indexed", never crawled) by giving them a real
 * crawlable path from the indexed landing.
 *
 * Uses plain <a href> (NOT wouter <Link>): the trade pages are server-rendered
 * outside the SPA, so they need a full-page navigation, and plain anchors are
 * exactly what Google crawls.
 */
import { ArrowRight } from "lucide-react";
import { publishedServices } from "@/lib/published-services";

export function CityServicesLinks({ city }: { city: string }) {
    const slug = city.toLowerCase();
    const services = publishedServices(slug);
    if (services.length === 0) return null;

    return (
        <section className="bg-slate-50 px-4 lg:px-8 py-16 lg:py-24 border-t border-slate-200">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10 lg:mb-12 max-w-2xl mx-auto">
                    <p className="text-amber-500 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-3">
                        Our services
                    </p>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 leading-[1.1] mb-4">
                        Handyman &amp; trade services across {city}
                    </h2>
                    <p className="text-slate-600 text-lg font-medium">
                        One trusted local team for the lot. Tap a service to see how it works in {city}.
                    </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {services.map((s) => (
                        <a
                            key={s.slug}
                            href={`/${slug}/${s.slug}`}
                            className="group flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-4 py-3.5 font-semibold text-slate-800 shadow-sm transition-all hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5"
                        >
                            <span>{s.label} in {city}</span>
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 transition-colors shrink-0" />
                        </a>
                    ))}
                </div>
            </div>
        </section>
    );
}
