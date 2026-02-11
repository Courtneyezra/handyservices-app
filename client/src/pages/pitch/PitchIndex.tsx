import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Users,
  TrendingDown,
  Calculator,
  Rocket,
  ExternalLink,
  Zap,
  AlertTriangle
} from "lucide-react";

export default function PitchIndex() {
  const pitchSections = [
    {
      title: "Customer Journey",
      description: "See exactly where leads are dropping off",
      icon: TrendingDown,
      href: "/pitch/journey",
      color: "text-red-500",
      bgColor: "bg-red-500/10"
    },
    {
      title: "ROI Calculator",
      description: "Calculate money left on the table",
      icon: Calculator,
      href: "/pitch/roi",
      color: "text-green-500",
      bgColor: "bg-green-500/10"
    },
    {
      title: "Growth Roadmap",
      description: "From landing page to full business system",
      icon: Rocket,
      href: "/pitch/roadmap",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10"
    },
    {
      title: "Competitor Analysis",
      description: "What other Nottingham electricians are doing",
      icon: Users,
      href: "/pitch/competitors",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Rooketrade Electrical</h1>
              <p className="text-gray-400">Sales Presentation</p>
            </div>
            <div className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg border border-red-500/30">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Website Currently DOWN</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero Message */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-yellow-500/20 text-yellow-400 px-4 py-2 rounded-full mb-6">
            <Zap className="h-5 w-5" />
            <span className="font-medium">Urgent: Leads Going to Competitors</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Your leads are clicking your Google listing
            <br />
            <span className="text-red-500">RIGHT NOW</span>
            <br />
            and hitting a dead website
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Every day without a working site = money going straight to your competitors
          </p>
        </div>

        {/* Section Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {pitchSections.map((section) => (
            <Link key={section.href} href={section.href}>
              <Card className="bg-gray-800/50 border-gray-700 hover:border-gray-600 transition-all cursor-pointer group h-full">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${section.bgColor}`}>
                      <section.icon className={`h-6 w-6 ${section.color}`} />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-white group-hover:text-[#e8b323] transition-colors flex items-center gap-2">
                        {section.title}
                        <ExternalLink className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </CardTitle>
                      <CardDescription className="text-gray-400 mt-1">
                        {section.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>

        {/* Live Demo CTA */}
        <Card className="bg-gradient-to-r from-[#e8b323]/20 to-yellow-500/10 border-[#e8b323]/30">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">
                  See What Your New Site Could Look Like
                </h3>
                <p className="text-gray-300">
                  Live demo of a working landing page with instant quote booking
                </p>
              </div>
              <Link href="/landing">
                <Button size="lg" className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-semibold">
                  View Live Demo
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Bottom Navigation */}
        <div className="mt-8 flex justify-center">
          <div className="flex gap-2 text-sm text-gray-500">
            <span>Navigate:</span>
            {pitchSections.map((section, i) => (
              <span key={section.href}>
                <Link href={section.href} className="text-gray-400 hover:text-white">
                  {section.title}
                </Link>
                {i < pitchSections.length - 1 && <span className="mx-2">|</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
