import { MessageCircle, CheckCircle, Clock, Shield, Phone, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import defaultHeroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";

interface IntakeHeroProps {
  location: string;
  headline?: string;
  subhead?: string;
  ctaText?: string;
  mobileCtaText?: string;
  desktopCtaText?: string;
  bannerText?: string;
  heroImage?: string;
  onConversion?: (source: string) => void;
}

export function IntakeHero({ location, headline, subhead, ctaText, mobileCtaText, desktopCtaText, bannerText, heroImage, onConversion }: IntakeHeroProps) {

  // Simplified Hero - Direct to Call/WhatsApp


  // Job description step (initial) - Split layout on desktop
  return (
    <>
      {bannerText && (
        <div className="bg-amber-500 text-slate-900 text-center py-2 font-bold px-4">
          <span dangerouslySetInnerHTML={{ __html: bannerText.replace("{{location}}", location) }} />
        </div>
      )}

      <section id="hero" className="bg-slate-800 px-4 lg:px-8 py-12 lg:py-20 font-poppins font-medium">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Column - Text and Form */}
            <div className="text-center lg:text-left order-2 lg:order-1">
              <div className="inline-flex items-center gap-2 bg-amber-400/20 px-4 py-2 rounded-full mb-6">
                <CheckCircle className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 font-medium text-sm">Trusted by 300+ {location} Homeowners</span>
              </div>

              {/* Tick icon for mobile */}
              <div className="lg:hidden flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
                  <CheckCircle className="w-12 h-12 text-slate-900" strokeWidth={2.5} />
                </div>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight font-poppins">
                {headline ?
                  headline.replace("{{location}}", location).split(location).map((part, i, arr) => (
                    <span key={i}>
                      {part}
                      {i < arr.length - 1 && <span className="text-amber-400">{location}</span>}
                    </span>
                  ))
                  :
                  <>The Easiest Way to Book a Handyman in <span className="text-amber-400">{location}</span></>
                }
              </h1>

              <p className="text-xl text-white font-bold mb-10 max-w-xl mx-auto lg:mx-0">
                {subhead ? subhead.replace("{{location}}", location) : "Call or WhatsApp for an instant fixed quote."}
              </p>

              {/* Primary Actions: Call & WhatsApp */}
              <div className="flex flex-col sm:flex-row gap-4 max-w-xl mx-auto lg:mx-0 mb-10 text-base md:text-lg">
                <Button
                  type="button"
                  onClick={() => {
                    onConversion?.('hero_call');
                    window.location.href = "tel:+447449501762";
                  }}
                  className="flex-1 py-4 lg:py-8 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full shadow-lg shadow-amber-400/20 transition-transform hover:scale-105"
                >
                  <span className="lg:hidden">{mobileCtaText || ctaText || "Call Now"}</span>
                  <span className="hidden lg:inline">{desktopCtaText || ctaText || "Call Now"}</span>
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    onConversion?.('hero_whatsapp');
                    window.open("https://wa.me/447508744402", "_blank");
                  }}
                  className="flex-1 py-4 lg:py-8 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-full shadow-lg shadow-green-500/20 transition-transform hover:scale-105 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5 lg:w-6 lg:h-6" />
                  WhatsApp Us
                </Button>
              </div>

              {/* Features List */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-white/60">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  <span>Next-day service</span>
                </div>
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-amber-400" />
                  <span>Quick response</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-amber-400" />
                  <span>Fully insured</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-amber-400" />
                  <span>DBS checked</span>
                </div>
              </div>
            </div>

            {/* Right Column - Hero Image */}
            <div className="order-1 lg:order-2 hidden lg:block">
              <div className="relative rounded-3xl overflow-hidden max-w-lg mx-auto shadow-2xl">
                <img
                  src={heroImage || defaultHeroImage}
                  alt="Handy Services handyman at customer door"
                  className="w-full h-auto object-cover"
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
