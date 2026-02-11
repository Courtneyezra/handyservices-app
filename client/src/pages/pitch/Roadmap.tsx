import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  Rocket,
  Globe,
  Users,
  Bot,
  CheckCircle,
  Clock,
  Star,
  Phone,
  FileText,
  Calendar,
  MessageSquare,
  Zap,
  Home
} from "lucide-react";

export default function Roadmap() {
  const phases = [
    {
      phase: 1,
      title: "Free Landing Page",
      subtitle: "Get leads TODAY",
      status: "available",
      icon: Globe,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/30",
      cost: "FREE",
      timeline: "Live in 24 hours",
      features: [
        { text: "Professional landing page", included: true },
        { text: "Mobile-optimized design", included: true },
        { text: "Contact form captures leads", included: true },
        { text: "Click-to-call button", included: true },
        { text: "Google-ready (SEO basics)", included: true },
        { text: "Your branding & photos", included: true }
      ],
      benefits: [
        "Stop losing leads to dead website",
        "Look professional online",
        "Customers can find & contact you"
      ]
    },
    {
      phase: 2,
      title: "Bionic CRM",
      subtitle: "Run your business smarter",
      status: "coming",
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/30",
      cost: "From £49/mo",
      timeline: "When you're ready",
      features: [
        { text: "Lead tracking & follow-up", included: true },
        { text: "Instant quote generation", included: true },
        { text: "Online booking calendar", included: true },
        { text: "Invoice management", included: true },
        { text: "Job dispatch & scheduling", included: true },
        { text: "Customer history & notes", included: true }
      ],
      benefits: [
        "Never forget to follow up",
        "Send quotes in seconds, not hours",
        "Track every job from enquiry to payment"
      ]
    },
    {
      phase: 3,
      title: "AI Co-Pilot",
      subtitle: "Your 24/7 business partner",
      status: "future",
      icon: Bot,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/30",
      cost: "Premium add-on",
      timeline: "Future upgrade",
      features: [
        { text: "AI answers enquiries 24/7", included: true },
        { text: "Smart follow-up automation", included: true },
        { text: "Auto-generate quotes from calls", included: true },
        { text: "Predictive scheduling", included: true },
        { text: "Customer sentiment analysis", included: true },
        { text: "Business insights & reports", included: true }
      ],
      benefits: [
        "Capture leads while you sleep",
        "AI handles routine enquiries",
        "Focus on the work, not the admin"
      ]
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "available":
        return (
          <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
            Available Now
          </span>
        );
      case "coming":
        return (
          <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium">
            When You're Ready
          </span>
        );
      case "future":
        return (
          <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-sm font-medium">
            Future Upgrade
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/pitch/roi">
              <Button variant="ghost" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                ROI Calculator
              </Button>
            </Link>
            <Link href="/pitch/competitors">
              <Button variant="outline" className="border-gray-600">
                Next: Competitor Analysis
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-400 px-4 py-2 rounded-full mb-4">
            <Rocket className="h-5 w-5" />
            <span className="font-medium">Growth Path</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Start Free, Grow When Ready
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            No pressure to buy everything at once. Start with a free landing page,
            upgrade when your business is ready for more.
          </p>
        </div>

        {/* Phases */}
        <div className="space-y-6">
          {phases.map((phase, index) => (
            <div key={phase.phase}>
              <Card className={`${phase.bgColor} ${phase.borderColor} border-2 ${
                phase.status === "available" ? "ring-2 ring-green-500/50" : ""
              }`}>
                <CardHeader className="pb-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-xl ${phase.bgColor}`}>
                        <phase.icon className={`h-8 w-8 ${phase.color}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-sm text-gray-500">Phase {phase.phase}</span>
                          {getStatusBadge(phase.status)}
                        </div>
                        <CardTitle className="text-2xl text-white">
                          {phase.title}
                        </CardTitle>
                        <p className="text-gray-400">{phase.subtitle}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-3xl font-bold ${phase.color}`}>
                        {phase.cost}
                      </p>
                      <p className="text-sm text-gray-500 flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" />
                        {phase.timeline}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Features */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">
                        What's Included
                      </h4>
                      <ul className="space-y-2">
                        {phase.features.map((feature, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <CheckCircle className={`h-4 w-4 ${phase.color}`} />
                            <span className="text-gray-300">{feature.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Benefits */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">
                        Why It Matters
                      </h4>
                      <ul className="space-y-2">
                        {phase.benefits.map((benefit, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Star className="h-4 w-4 text-[#e8b323] mt-0.5" />
                            <span className="text-gray-300">{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {phase.status === "available" && (
                    <div className="mt-6 pt-6 border-t border-gray-700/50">
                      <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/landing">
                          <Button size="lg" className="bg-green-500 hover:bg-green-600 text-white font-semibold">
                            See Demo Landing Page
                          </Button>
                        </Link>
                        <Button size="lg" variant="outline" className="border-green-500/50 text-green-400 hover:bg-green-500/10">
                          Get Started Free
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {index < phases.length - 1 && (
                <div className="flex justify-center py-4">
                  <div className="flex flex-col items-center">
                    <ArrowDown className="h-6 w-6 text-gray-600" />
                    <span className="text-xs text-gray-500 mt-1">Upgrade anytime</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Summary Card */}
        <div className="mt-12">
          <Card className="bg-gradient-to-r from-[#e8b323]/20 to-yellow-500/10 border-[#e8b323]/30">
            <CardContent className="p-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-4">
                  The Smart Approach
                </h2>
                <div className="max-w-2xl mx-auto">
                  <div className="grid sm:grid-cols-3 gap-6 mb-8">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-green-400 mb-2">1</div>
                      <p className="text-gray-300">Start with a <strong>free landing page</strong></p>
                    </div>
                    <div className="text-center">
                      <div className="text-4xl font-bold text-blue-400 mb-2">2</div>
                      <p className="text-gray-300">See leads <strong>coming in</strong></p>
                    </div>
                    <div className="text-center">
                      <div className="text-4xl font-bold text-purple-400 mb-2">3</div>
                      <p className="text-gray-300">Upgrade <strong>when ready</strong></p>
                    </div>
                  </div>
                  <p className="text-gray-400 mb-6">
                    No commitment, no pressure. Prove the value first, then invest in growth tools.
                  </p>
                  <Link href="/landing">
                    <Button size="lg" className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-semibold">
                      See Demo Landing Page
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <Link href="/pitch">
            <Button variant="ghost" className="text-gray-400">
              <Home className="h-4 w-4 mr-2" />
              Overview
            </Button>
          </Link>
          <Link href="/pitch/competitors">
            <Button className="bg-[#e8b323] hover:bg-[#d4a520] text-black">
              Next: Competitors
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
