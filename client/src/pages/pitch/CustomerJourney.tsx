import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Search,
  MapPin,
  Globe,
  XCircle,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  CheckCircle,
  AlertTriangle,
  Zap,
  Phone,
  Home
} from "lucide-react";

export default function CustomerJourney() {
  const journeySteps = [
    {
      step: 1,
      title: "Customer Has Problem",
      description: "Socket sparking, light not working, need rewiring",
      icon: Zap,
      status: "normal",
      detail: "They need an electrician TODAY"
    },
    {
      step: 2,
      title: "Google Search",
      description: "\"electrician near me\" or \"electrician nottingham\"",
      icon: Search,
      status: "normal",
      detail: "92% of people start with Google"
    },
    {
      step: 3,
      title: "Sees GMB Results",
      description: "Rooketrade appears HIGH in results!",
      icon: MapPin,
      status: "success",
      detail: "Good ranking, good reviews"
    },
    {
      step: 4,
      title: "Clicks 'Website' Button",
      description: "Wants to see your work, prices, book online",
      icon: Globe,
      status: "warning",
      detail: "This is YOUR moment to convert"
    },
    {
      step: 5,
      title: "DEAD END",
      description: "Site is DOWN - nothing loads",
      icon: XCircle,
      status: "danger",
      detail: "Customer loses trust instantly"
    },
    {
      step: 6,
      title: "Goes Back to Google",
      description: "Clicks the NEXT electrician instead",
      icon: ArrowLeft,
      status: "danger",
      detail: "You LOST the lead"
    },
    {
      step: 7,
      title: "Competitor Gets Job",
      description: "They had a working website with booking",
      icon: CheckCircle,
      status: "competitor",
      detail: "Could've been YOUR job"
    }
  ];

  const getStatusStyles = (status: string) => {
    switch (status) {
      case "success":
        return "border-green-500/50 bg-green-500/10";
      case "warning":
        return "border-yellow-500/50 bg-yellow-500/10";
      case "danger":
        return "border-red-500/50 bg-red-500/10 animate-pulse";
      case "competitor":
        return "border-purple-500/50 bg-purple-500/10";
      default:
        return "border-gray-700 bg-gray-800/50";
    }
  };

  const getIconColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
      case "danger":
        return "text-red-500";
      case "competitor":
        return "text-purple-500";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/pitch">
              <Button variant="ghost" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Overview
              </Button>
            </Link>
            <Link href="/pitch/roi">
              <Button variant="outline" className="border-gray-600">
                Next: ROI Calculator
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Where Your Leads Are Going
          </h1>
          <p className="text-xl text-gray-400">
            Follow a customer's journey from problem to booking
          </p>
        </div>

        {/* Journey Funnel */}
        <div className="space-y-4">
          {journeySteps.map((step, index) => (
            <div key={step.step}>
              <Card className={`${getStatusStyles(step.status)} border transition-all`}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Step Number */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                      step.status === "danger"
                        ? "bg-red-500 text-white"
                        : step.status === "success"
                        ? "bg-green-500 text-white"
                        : step.status === "competitor"
                        ? "bg-purple-500 text-white"
                        : "bg-gray-700 text-gray-300"
                    }`}>
                      {step.step}
                    </div>

                    {/* Icon */}
                    <div className={`p-3 rounded-lg bg-gray-800/50 ${getIconColor(step.status)}`}>
                      <step.icon className="h-6 w-6" />
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-white mb-1">
                        {step.title}
                      </h3>
                      <p className="text-gray-300 mb-2">{step.description}</p>
                      <p className="text-sm text-gray-500">{step.detail}</p>
                    </div>

                    {/* Status Badge */}
                    {step.status === "danger" && (
                      <div className="flex items-center gap-2 bg-red-500/20 text-red-400 px-3 py-1 rounded-full">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="text-sm font-medium">LEAK POINT</span>
                      </div>
                    )}
                    {step.status === "success" && (
                      <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-3 py-1 rounded-full">
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">GOOD</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Arrow between steps */}
              {index < journeySteps.length - 1 && (
                <div className="flex justify-center py-2">
                  <ArrowDown className={`h-6 w-6 ${
                    step.status === "danger" ? "text-red-500" : "text-gray-600"
                  }`} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* The Fix */}
        <div className="mt-12">
          <Card className="border-[#e8b323]/50 bg-[#e8b323]/10">
            <CardContent className="p-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-4">
                  The Fix: A Working Landing Page
                </h2>
                <p className="text-gray-300 mb-6 max-w-xl mx-auto">
                  Instead of a dead end, customers land on a professional page where they can
                  see your work, read reviews, and book instantly
                </p>

                {/* Fixed Journey Preview */}
                <div className="flex items-center justify-center gap-4 flex-wrap mb-8">
                  <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg">
                    <Search className="h-5 w-5 text-blue-400" />
                    <span className="text-gray-300">Search</span>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-600 hidden md:block" />
                  <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg">
                    <MapPin className="h-5 w-5 text-green-400" />
                    <span className="text-gray-300">Find You</span>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-600 hidden md:block" />
                  <div className="flex items-center gap-2 bg-green-500/20 border border-green-500/50 px-4 py-2 rounded-lg">
                    <Globe className="h-5 w-5 text-green-400" />
                    <span className="text-green-300">Landing Page</span>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-600 hidden md:block" />
                  <div className="flex items-center gap-2 bg-[#e8b323]/20 border border-[#e8b323]/50 px-4 py-2 rounded-lg">
                    <Phone className="h-5 w-5 text-[#e8b323]" />
                    <span className="text-[#e8b323]">BOOK</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/landing">
                    <Button size="lg" className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-semibold">
                      See Demo Landing Page
                    </Button>
                  </Link>
                  <Link href="/pitch/roi">
                    <Button size="lg" variant="outline" className="border-gray-600">
                      Calculate Lost Revenue
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
          <Link href="/pitch/roi">
            <Button className="bg-[#e8b323] hover:bg-[#d4a520] text-black">
              Next: Calculate ROI
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
