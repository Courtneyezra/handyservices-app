import { useState, useEffect } from "react";
import {
  Phone,
  Star,
  Sparkles,
  Home,
  Building2,
  Shield,
  Clock,
  CheckCircle,
  ChevronDown,
  SprayCan,
  Flame,
  Blinds,
  Droplets,
  Users,
  BadgeCheck,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiWhatsapp } from "react-icons/si";
import { GoogleReviewsSection } from "@/components/GoogleReviewsSection";
import { StickyCTA } from "@/components/StickyCTA";
import { LandingHeader } from "@/components/LandingHeader";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent(
  "Hi, I'm interested in your cleaning services"
);
const PHONE_NUMBER = "+447449501762";

const whatsappLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;
const phoneLink = `tel:${PHONE_NUMBER}`;

/* ───────────────────────── Hero ───────────────────────── */

function HeroSection() {
  return (
    <section className="relative bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 px-4 lg:px-8 py-20 lg:py-32 overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

      <div className="max-w-5xl mx-auto text-center relative z-10">
        <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-full px-4 py-1.5 mb-6">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-amber-400 text-sm font-medium">
            Professional Cleaning Services
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 leading-tight">
          Spotless Spaces.{" "}
          <span className="text-amber-400">Zero Hassle.</span>
        </h1>

        <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto mb-8 font-medium">
          Residential, commercial &amp; specialist cleaning across Nottingham
          &amp; Derby. Insured, vetted, guaranteed.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
            <Button
              size="lg"
              className="bg-green-600 hover:bg-green-700 text-white gap-2 text-lg px-8 py-6 w-full sm:w-auto"
            >
              <SiWhatsapp className="w-5 h-5" />
              WhatsApp Us
            </Button>
          </a>
          <a href={phoneLink}>
            <Button
              size="lg"
              variant="outline"
              className="border-amber-400/50 text-amber-400 hover:bg-amber-400/10 gap-2 text-lg px-8 py-6 w-full sm:w-auto"
            >
              <Phone className="w-5 h-5" />
              Call Now
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── Trust Strip ────────────────────── */

function TrustStrip() {
  const badges = [
    { icon: <Shield className="w-5 h-5" />, text: "£2M Insured" },
    {
      icon: <Star className="w-5 h-5" />,
      text: "4.9★ Google (127+ reviews)",
    },
    { icon: <BadgeCheck className="w-5 h-5" />, text: "Vetted & DBS-Checked" },
    { icon: <Clock className="w-5 h-5" />, text: "Same-Week Availability" },
  ];

  return (
    <section className="bg-slate-800 border-y border-slate-700/50 px-4 py-5">
      <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-x-8 gap-y-3">
        {badges.map((badge, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-amber-400 text-sm font-medium"
          >
            {badge.icon}
            <span>{badge.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────── Services Grid ───────────────────── */

interface ServiceCategory {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  services: { name: string; detail: string }[];
}

const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    title: "Residential Cleaning",
    description: "Homes that sparkle, hassle-free",
    icon: <Home className="w-7 h-7" />,
    color: "from-blue-500/20 to-blue-600/5",
    services: [
      {
        name: "End-of-Tenancy Clean",
        detail: "Deep clean to deposit-return standard",
      },
      {
        name: "Deep Clean",
        detail: "Top-to-bottom intensive clean",
      },
      {
        name: "Regular Domestic Clean",
        detail: "Weekly or fortnightly maintenance",
      },
      {
        name: "Spring Clean",
        detail: "Seasonal refresh for your entire home",
      },
    ],
  },
  {
    title: "Commercial Cleaning",
    description: "Professional spaces, professional results",
    icon: <Building2 className="w-7 h-7" />,
    color: "from-emerald-500/20 to-emerald-600/5",
    services: [
      {
        name: "Office Cleaning",
        detail: "Daily, weekly, or one-off office cleans",
      },
      {
        name: "Retail Space",
        detail: "Shopfloor and stockroom cleaning",
      },
      {
        name: "Post-Construction",
        detail: "Builders' clean to handover standard",
      },
      {
        name: "Communal Areas",
        detail: "Hallways, stairwells, shared spaces",
      },
    ],
  },
  {
    title: "Specialist Cleaning",
    description: "Targeted services for tough jobs",
    icon: <SprayCan className="w-7 h-7" />,
    color: "from-amber-500/20 to-amber-600/5",
    services: [
      {
        name: "Oven Cleaning",
        detail: "Professional degreasing and restore",
      },
      {
        name: "Carpet Cleaning",
        detail: "Hot-water extraction deep clean",
      },
      {
        name: "Window Cleaning",
        detail: "Interior and exterior, any access",
      },
      {
        name: "Pressure Washing",
        detail: "Driveways, patios, decking, fencing",
      },
    ],
  },
];

function ServicesSection() {
  return (
    <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            Our <span className="text-amber-400">Cleaning Services</span>
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            From a quick domestic clean to full post-construction site clearance
            — we cover it all.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {SERVICE_CATEGORIES.map((cat, idx) => (
            <div
              key={idx}
              className={`bg-gradient-to-b ${cat.color} rounded-2xl border border-slate-700/50 p-6 hover:border-amber-400/30 transition-colors`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="text-amber-400">{cat.icon}</div>
                <div>
                  <h3 className="text-xl font-bold text-white">{cat.title}</h3>
                  <p className="text-white/50 text-sm">{cat.description}</p>
                </div>
              </div>

              <ul className="space-y-3">
                {cat.services.map((svc, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-white font-medium">{svc.name}</p>
                      <p className="text-white/50 text-sm">{svc.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="w-full bg-slate-700 hover:bg-slate-600 text-white gap-2">
                    <SiWhatsapp className="w-4 h-4" />
                    Get a Quote
                  </Button>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────── How It Works ────────────────────── */

function HowItWorks() {
  const steps = [
    {
      number: "1",
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Text or Call",
      description:
        "Tell us what you need — WhatsApp a photo or give us a quick call.",
    },
    {
      number: "2",
      icon: <CheckCircle className="w-6 h-6" />,
      title: "We Quote",
      description:
        "Get a clear, fixed price — no hidden fees, no hourly surprises.",
    },
    {
      number: "3",
      icon: <Sparkles className="w-6 h-6" />,
      title: "We Clean",
      description:
        "Our vetted team arrives on time and leaves your space spotless.",
    },
  ];

  return (
    <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            How It <span className="text-amber-400">Works</span>
          </h2>
          <p className="text-white/60 text-lg">
            Three simple steps to a spotless space
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, idx) => (
            <div key={idx} className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400 mb-4">
                {step.icon}
              </div>
              <div className="text-amber-400 text-sm font-bold mb-1">
                Step {step.number}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                {step.title}
              </h3>
              <p className="text-white/60">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────── Why Choose Us ───────────────────── */

function WhyChooseUs() {
  const reasons = [
    {
      icon: <Shield className="w-6 h-6" />,
      title: "£2M Public Liability",
      description: "Fully insured for your peace of mind",
    },
    {
      icon: <BadgeCheck className="w-6 h-6" />,
      title: "Vetted & DBS-Checked",
      description: "Every cleaner background-checked and referenced",
    },
    {
      icon: <Star className="w-6 h-6" />,
      title: "4.9★ on Google",
      description: "127+ five-star reviews from real customers",
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: "Same-Week Booking",
      description: "Fast turnaround when you need it",
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Consistent Teams",
      description: "The same trusted faces each visit",
    },
    {
      icon: <Sparkles className="w-6 h-6" />,
      title: "Satisfaction Guaranteed",
      description: "Not happy? We come back and fix it — free",
    },
  ];

  return (
    <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            Why <span className="text-amber-400">Choose Us</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-8">
          {reasons.map((reason, idx) => (
            <div
              key={idx}
              className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 md:p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-400/10 text-amber-400 mb-3">
                {reason.icon}
              </div>
              <h3 className="text-white font-bold mb-1 text-sm md:text-base">
                {reason.title}
              </h3>
              <p className="text-white/50 text-xs md:text-sm">
                {reason.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── FAQ ─────────────────────────── */

const FAQ_ITEMS = [
  {
    q: "What areas do you cover?",
    a: "We cover Nottingham, Derby, and surrounding areas within a 20-mile radius.",
  },
  {
    q: "Do you bring your own equipment and products?",
    a: "Yes — our teams arrive fully equipped with professional-grade products and equipment. No need to provide anything.",
  },
  {
    q: "How much does a clean cost?",
    a: "Pricing depends on the type and size of clean. WhatsApp us a few details and we'll send a fixed quote within minutes — no hidden fees.",
  },
  {
    q: "Are your cleaners insured?",
    a: "Absolutely. We carry £2M public liability insurance and all team members are vetted and DBS-checked.",
  },
  {
    q: "Can I book a one-off clean or do I need a contract?",
    a: "Both! We're happy to do one-off cleans or set up a regular schedule — whatever suits you.",
  },
  {
    q: "What if I'm not happy with the clean?",
    a: "We guarantee our work. If anything isn't right, let us know within 24 hours and we'll come back to fix it — free of charge.",
  },
];

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Frequently Asked{" "}
            <span className="text-amber-400">Questions</span>
          </h2>
        </div>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => (
            <div
              key={idx}
              className="bg-slate-700/30 rounded-xl border border-slate-700/50 overflow-hidden"
            >
              <button
                onClick={() =>
                  setOpenIndex(openIndex === idx ? null : idx)
                }
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <span className="text-white font-medium pr-4">{item.q}</span>
                <ChevronDown
                  className={`w-5 h-5 text-amber-400 flex-shrink-0 transition-transform ${
                    openIndex === idx ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIndex === idx && (
                <div className="px-5 pb-4">
                  <p className="text-white/60">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── Final CTA ──────────────────────── */

function FinalCTA() {
  return (
    <section className="bg-gradient-to-b from-slate-900 to-slate-800 px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-3xl mx-auto text-center">
        <Sparkles className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          Ready for a <span className="text-amber-400">Spotless Space</span>?
        </h2>
        <p className="text-white/60 text-lg mb-8">
          Get a free, no-obligation quote in minutes. Just text us what you need.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
            <Button
              size="lg"
              className="bg-green-600 hover:bg-green-700 text-white gap-2 text-lg px-8 py-6 w-full sm:w-auto"
            >
              <SiWhatsapp className="w-5 h-5" />
              WhatsApp Us
            </Button>
          </a>
          <a href={phoneLink}>
            <Button
              size="lg"
              variant="outline"
              className="border-amber-400/50 text-amber-400 hover:bg-amber-400/10 gap-2 text-lg px-8 py-6 w-full sm:w-auto"
            >
              <Phone className="w-5 h-5" />
              Call 07449 501762
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── Footer ─────────────────────────── */

function Footer() {
  return (
    <footer className="bg-slate-900 border-t border-slate-700/50 px-4 py-8">
      <div className="max-w-5xl mx-auto text-center text-white/40 text-sm">
        <p>&copy; {new Date().getFullYear()} Handy Services. All rights reserved.</p>
        <p className="mt-1">Nottingham &amp; Derby | £2M Insured | 4.9★ Google</p>
      </div>
    </footer>
  );
}

/* ═══════════════════ Main Page ═════════════════════════ */

export default function CleaningLanding() {
  const [showSticky, setShowSticky] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowSticky(window.scrollY > 600);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleConversion = (source: string) => {
    window.location.href = phoneLink;
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <LandingHeader />
      <HeroSection />
      <TrustStrip />
      <ServicesSection />
      <HowItWorks />
      <WhyChooseUs />
      <GoogleReviewsSection darkMode />
      <FAQSection />
      <FinalCTA />
      <Footer />
      <StickyCTA isVisible={showSticky} onConversion={handleConversion} />
    </div>
  );
}
