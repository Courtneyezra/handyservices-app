import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
  Phone,
  Calendar,
  Star,
  MessageSquare,
  CreditCard,
  Camera,
  Home,
  Search,
  MapPin,
  ExternalLink
} from "lucide-react";

export default function CompetitorAnalysis() {
  // Example competitors - replace with real research
  const competitors = [
    {
      name: "Nottingham Electricians Ltd",
      rank: 1,
      hasWebsite: true,
      features: {
        onlineBooking: true,
        quoteForm: true,
        reviews: true,
        pricing: false,
        photos: true,
        mobileOptimized: true
      },
      strengths: ["Professional site", "Online booking", "Good reviews displayed"],
      weaknesses: ["No instant pricing", "Generic design"]
    },
    {
      name: "Spark Electrical Services",
      rank: 2,
      hasWebsite: true,
      features: {
        onlineBooking: false,
        quoteForm: true,
        reviews: true,
        pricing: false,
        photos: true,
        mobileOptimized: true
      },
      strengths: ["Local focus", "Quick contact form"],
      weaknesses: ["No online booking", "Outdated design"]
    },
    {
      name: "PowerUp Electricians",
      rank: 3,
      hasWebsite: true,
      features: {
        onlineBooking: true,
        quoteForm: true,
        reviews: false,
        pricing: true,
        photos: false,
        mobileOptimized: false
      },
      strengths: ["Shows pricing", "Has booking"],
      weaknesses: ["Not mobile-friendly", "No reviews shown"]
    },
    {
      name: "Rooketrade Electrical",
      rank: "High",
      isClient: true,
      hasWebsite: false,
      features: {
        onlineBooking: false,
        quoteForm: false,
        reviews: false,
        pricing: false,
        photos: false,
        mobileOptimized: false
      },
      strengths: ["Good GMB ranking", "Good reviews on GMB"],
      weaknesses: ["WEBSITE DOWN", "No way for customers to learn more", "Losing leads to competitors"]
    }
  ];

  const featureList = [
    { key: "onlineBooking", label: "Online Booking", icon: Calendar },
    { key: "quoteForm", label: "Quote Form", icon: MessageSquare },
    { key: "reviews", label: "Reviews Displayed", icon: Star },
    { key: "pricing", label: "Pricing Info", icon: CreditCard },
    { key: "photos", label: "Work Photos", icon: Camera },
    { key: "mobileOptimized", label: "Mobile Friendly", icon: Phone }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/pitch/roadmap">
              <Button variant="ghost" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Growth Roadmap
              </Button>
            </Link>
            <Link href="/pitch">
              <Button variant="outline" className="border-gray-600">
                Back to Overview
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-purple-500/20 text-purple-400 px-4 py-2 rounded-full mb-4">
            <Search className="h-5 w-5" />
            <span className="font-medium">Competitor Analysis</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            What Your Competitors Are Doing
          </h1>
          <p className="text-xl text-gray-400">
            See how other Nottingham electricians are capturing online leads
          </p>
        </div>

        {/* Search Result Preview */}
        <Card className="bg-gray-800/50 border-gray-700 mb-8">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <MapPin className="h-5 w-5 text-blue-400" />
              "Electrician Nottingham" - Google Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-400 mb-4">
              When someone searches for an electrician in Nottingham, here's what they see:
            </p>
            <div className="space-y-3">
              {competitors.map((comp) => (
                <div
                  key={comp.name}
                  className={`p-4 rounded-lg border ${
                    comp.isClient
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-gray-900/50 border-gray-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium px-2 py-1 rounded ${
                        comp.isClient
                          ? "bg-red-500/20 text-red-400"
                          : "bg-gray-700 text-gray-300"
                      }`}>
                        #{comp.rank}
                      </span>
                      <div>
                        <p className={`font-medium ${comp.isClient ? "text-red-400" : "text-white"}`}>
                          {comp.name}
                          {comp.isClient && " (YOU)"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {comp.hasWebsite ? (
                        <span className="flex items-center gap-1 text-green-400 text-sm">
                          <Globe className="h-4 w-4" />
                          Website Live
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-sm">
                          <XCircle className="h-4 w-4" />
                          Website DOWN
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Feature Comparison */}
        <Card className="bg-gray-800/50 border-gray-700 mb-8">
          <CardHeader>
            <CardTitle className="text-white">Feature Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Feature</th>
                    {competitors.map((comp) => (
                      <th
                        key={comp.name}
                        className={`text-center py-3 px-4 font-medium ${
                          comp.isClient ? "text-red-400" : "text-gray-400"
                        }`}
                      >
                        {comp.name.split(" ")[0]}
                        {comp.isClient && " (You)"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {featureList.map((feature) => (
                    <tr key={feature.key} className="border-b border-gray-700/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 text-gray-300">
                          <feature.icon className="h-4 w-4 text-gray-500" />
                          {feature.label}
                        </div>
                      </td>
                      {competitors.map((comp) => (
                        <td key={comp.name} className="text-center py-3 px-4">
                          {comp.features[feature.key as keyof typeof comp.features] ? (
                            <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className={`h-5 w-5 mx-auto ${
                              comp.isClient ? "text-red-500" : "text-gray-600"
                            }`} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* The Gap */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card className="bg-red-500/10 border-red-500/30">
            <CardHeader>
              <CardTitle className="text-red-400 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Your Current Situation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex items-start gap-2">
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <span className="text-gray-300">Website is completely down</span>
                </li>
                <li className="flex items-start gap-2">
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <span className="text-gray-300">No way for customers to learn about you</span>
                </li>
                <li className="flex items-start gap-2">
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <span className="text-gray-300">Can't capture leads online</span>
                </li>
                <li className="flex items-start gap-2">
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <span className="text-gray-300">Losing to competitors with working sites</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-green-500/10 border-green-500/30">
            <CardHeader>
              <CardTitle className="text-green-400 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                With a Landing Page
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <span className="text-gray-300">Professional online presence</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <span className="text-gray-300">Showcase your work & reviews</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <span className="text-gray-300">Contact form captures leads 24/7</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <span className="text-gray-300">Compete with (and beat) other electricians</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Opportunity */}
        <Card className="bg-[#e8b323]/10 border-[#e8b323]/30 mb-8">
          <CardContent className="p-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-4">
                The Opportunity
              </h2>
              <p className="text-gray-300 mb-6 max-w-2xl mx-auto">
                You already have <strong>good GMB ranking</strong> and <strong>good reviews</strong>.
                The only thing missing is a working website to convert those searchers into customers.
              </p>
              <div className="grid sm:grid-cols-3 gap-4 max-w-xl mx-auto mb-8">
                <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Good GMB Ranking</p>
                </div>
                <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Good Reviews</p>
                </div>
                <div className="text-center p-4 bg-red-500/20 rounded-lg border border-red-500/30">
                  <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                  <p className="text-sm text-red-300">Website Down</p>
                </div>
              </div>
              <p className="text-xl text-white mb-6">
                Fix the website = <span className="text-[#e8b323] font-bold">Complete the funnel</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/landing">
                  <Button size="lg" className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-semibold">
                    See Demo Landing Page
                    <ExternalLink className="h-4 w-4 ml-2" />
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

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <Link href="/pitch">
            <Button variant="ghost" className="text-gray-400">
              <Home className="h-4 w-4 mr-2" />
              Overview
            </Button>
          </Link>
          <Link href="/landing">
            <Button className="bg-[#e8b323] hover:bg-[#d4a520] text-black">
              View Demo
              <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
