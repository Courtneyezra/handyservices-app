import { MessageCircle, CheckCircle, Clock, Shield, Phone, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesktopLeadForm } from "@/components/DesktopLeadForm";
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
  transparentBg?: boolean;
}

export function IntakeHero({ location, headline, subhead, ctaText, mobileCtaText, desktopCtaText, bannerText, heroImage, onConversion, transparentBg }: IntakeHeroProps) {

  // Simplified Hero - Direct to Call/WhatsApp


  // Job description step (initial) - Split layout on desktop
  return (
    <>
      {bannerText && (
        <div className="bg-amber-500 text-slate-900 text-center py-2 font-bold px-4">
          <span dangerouslySetInnerHTML={{ __html: bannerText.replace("{{location}}", location) }} />
        </div>
      )}

      <section id="hero" className={`relative px-4 lg:px-8 py-12 lg:py-20 font-poppins font-medium min-h-[600px] lg:min-h-[750px] flex items-center overflow-hidden ${transparentBg ? 'bg-transparent' : 'bg-slate-900'}`}>

        {/* Background Image & Overlay - Only show if not transparentBg */}
        {!transparentBg && (
          <div className="absolute inset-0 z-0">
            <img
              src={heroImage || defaultHeroImage}
              alt="Background"
              className="w-full h-full object-cover object-top"
              loading="eager"
            />
            <div className="absolute inset-0 bg-slate-900/80 backdrop-grayscale-[30%]"></div>
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/80 to-transparent"></div>
          </div>
        )}

        <div className="max-w-7xl mx-auto relative z-10 w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Column - Text */}
            <div className="text-center lg:text-left order-2 lg:order-1">
              <div className="flex items-center gap-2 bg-amber-400/20 px-4 py-2 rounded-full mb-6 backdrop-blur-sm border border-amber-400/10 w-fit mx-auto lg:mx-0">
                <CheckCircle className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 font-medium text-sm">Trusted by 300+ {location} Homeowners</span>
              </div>

              {/* Tick icon for mobile */}
              <div className="lg:hidden flex justify-center mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
                  <CheckCircle className="w-12 h-12 text-slate-900" strokeWidth={2.5} />
                </div>
              </div>

              {/* Dynamic H1: Supports both single-line and three-tier formats */}
              {(() => {
                // Parse headline for multi-tier support
                const parseHeadline = (text: string | undefined) => {
                  if (!text) {
                    return {
                      tier1: location,
                      tier2: "Handyman Service",
                      tier3: "Next-day slots • Fast & reliable"
                    };
                  }

                  // Replace location placeholder
                  const processed = text.replace(/\{\{location\}\}/g, location);

                  // Check for delimiter (||)
                  if (processed.includes("||")) {
                    const parts = processed.split("||").map(s => s.trim());
                    return {
                      tier1: parts[0] || location,
                      tier2: parts[1] || null,
                      tier3: parts[2] || null
                    };
                  }

                  // Single-line fallback (backward compatible)
                  return {
                    tier1: processed,
                    tier2: null,
                    tier3: null
                  };
                };

                const parsedHeadline = parseHeadline(headline);

                return (
                  <h1 className="font-poppins font-bold leading-[0.95] mb-6 max-w-3xl mx-auto lg:mx-0">
                    {parsedHeadline.tier2 ? (
                      // Three-tier mode
                      <>
                        {/* Tier 1: Location/Main (Biggest, White) */}
                        <span className="block text-5xl md:text-6xl lg:text-7xl xl:text-8xl text-white mb-2 drop-shadow-xl">
                          {parsedHeadline.tier1}
                        </span>

                        {/* Tier 2: Service (Large, Amber) */}
                        <span className="block text-3xl md:text-4xl lg:text-5xl xl:text-6xl text-amber-400 mb-4 drop-shadow-lg">
                          {parsedHeadline.tier2}
                        </span>

                        {/* Tier 3: Benefits (Medium, Muted) */}
                        {parsedHeadline.tier3 && (
                          <span className="block text-lg md:text-xl lg:text-2xl xl:text-3xl text-slate-200 font-medium drop-shadow-md">
                            {parsedHeadline.tier3}
                          </span>
                        )}
                      </>
                    ) : (
                      // Single-line mode (backward compatible)
                      <span className="block text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-white drop-shadow-xl">
                        {parsedHeadline.tier1}
                      </span>
                    )}
                  </h1>
                );
              })()}

              <p className="text-xl text-slate-200 font-medium mb-10 max-w-xl mx-auto lg:mx-0 drop-shadow-md">
                {subhead ? subhead.replace("{{location}}", location) : "Call or WhatsApp for an instant fixed-price quote"}
              </p>

              {/* Primary Actions: Call & WhatsApp (Mobile Only) */}
              <div className="lg:hidden flex flex-col sm:flex-row gap-4 max-w-xl mx-auto mb-10 text-xl md:text-2xl">
                <Button
                  type="button"
                  onClick={() => {
                    onConversion?.('hero_call');
                    window.location.href = "tel:+447449501762";
                  }}
                  className="flex-1 py-4 lg:py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full shadow-lg shadow-amber-400/20 transition-transform hover:scale-105"
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
                  className="flex-1 py-4 lg:py-6 bg-transparent border-[3px] border-white hover:bg-white/10 text-white font-bold rounded-full transition-transform hover:scale-105 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-6 h-6 lg:w-8 lg:h-8" />
                  WhatsApp Us
                </Button>
              </div>

              {/* Features List */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-white/80">
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

            {/* Right Column - Desktop Lead Form (Replaces Image) */}
            <div className="order-1 lg:order-2 hidden lg:flex justify-end animate-in fade-in slide-in-from-right-10 duration-700">
              <DesktopLeadForm />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
