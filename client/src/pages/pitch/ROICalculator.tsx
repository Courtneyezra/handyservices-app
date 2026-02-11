import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  TrendingUp,
  AlertTriangle,
  PoundSterling,
  Users,
  Percent,
  Home,
  Calendar
} from "lucide-react";

export default function ROICalculator() {
  const [monthlyVisitors, setMonthlyVisitors] = useState(150);
  const [avgJobValue, setAvgJobValue] = useState(180);
  const [conversionRate, setConversionRate] = useState(4);

  // Calculations
  const potentialLeadsPerMonth = Math.round(monthlyVisitors * (conversionRate / 100));
  const lostRevenuePerMonth = potentialLeadsPerMonth * avgJobValue;
  const lostRevenuePerYear = lostRevenuePerMonth * 12;
  const lostRevenuePerDay = Math.round(lostRevenuePerMonth / 30);

  // Cost comparison
  const landingPageCost = 0; // Free tier
  const daysToPayback = landingPageCost > 0 ? Math.ceil(landingPageCost / lostRevenuePerDay) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/pitch/journey">
              <Button variant="ghost" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Customer Journey
              </Button>
            </Link>
            <Link href="/pitch/roadmap">
              <Button variant="outline" className="border-gray-600">
                Next: Growth Roadmap
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-full mb-4">
            <Calculator className="h-5 w-5" />
            <span className="font-medium">ROI Calculator</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Money Left on the Table
          </h1>
          <p className="text-xl text-gray-400">
            Adjust the numbers to see what a down website is costing you
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Inputs */}
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Your Numbers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-gray-300 flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" />
                  Monthly Website Visitors
                </Label>
                <Input
                  type="number"
                  value={monthlyVisitors}
                  onChange={(e) => setMonthlyVisitors(Number(e.target.value))}
                  className="bg-gray-900 border-gray-600 text-white"
                />
                <p className="text-xs text-gray-500">
                  Check Google Business Profile insights for estimate
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300 flex items-center gap-2">
                  <PoundSterling className="h-4 w-4 text-green-400" />
                  Average Job Value
                </Label>
                <Input
                  type="number"
                  value={avgJobValue}
                  onChange={(e) => setAvgJobValue(Number(e.target.value))}
                  className="bg-gray-900 border-gray-600 text-white"
                />
                <p className="text-xs text-gray-500">
                  Average invoice amount for a typical job
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300 flex items-center gap-2">
                  <Percent className="h-4 w-4 text-yellow-400" />
                  Conversion Rate (%)
                </Label>
                <Input
                  type="number"
                  value={conversionRate}
                  onChange={(e) => setConversionRate(Number(e.target.value))}
                  className="bg-gray-900 border-gray-600 text-white"
                  min={1}
                  max={20}
                />
                <p className="text-xs text-gray-500">
                  Industry average: 3-5% for trade services
                </p>
              </div>

              {/* Quick presets */}
              <div className="pt-4 border-t border-gray-700">
                <p className="text-sm text-gray-400 mb-3">Quick presets:</p>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300"
                    onClick={() => {
                      setMonthlyVisitors(100);
                      setAvgJobValue(150);
                      setConversionRate(3);
                    }}
                  >
                    Conservative
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300"
                    onClick={() => {
                      setMonthlyVisitors(200);
                      setAvgJobValue(200);
                      setConversionRate(5);
                    }}
                  >
                    Moderate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300"
                    onClick={() => {
                      setMonthlyVisitors(300);
                      setAvgJobValue(250);
                      setConversionRate(6);
                    }}
                  >
                    Optimistic
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-6">
            {/* Lost Revenue Card */}
            <Card className="bg-red-500/10 border-red-500/30">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-red-500/20 rounded-lg">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  </div>
                  <div>
                    <p className="text-red-400 text-sm font-medium mb-1">
                      You're Losing (Per Month)
                    </p>
                    <p className="text-4xl font-bold text-red-500">
                      £{lostRevenuePerMonth.toLocaleString()}
                    </p>
                    <p className="text-gray-400 text-sm mt-2">
                      {potentialLeadsPerMonth} potential jobs × £{avgJobValue} avg value
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Daily Loss */}
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-orange-400" />
                    <span className="text-gray-300">Every day without a site:</span>
                  </div>
                  <span className="text-2xl font-bold text-orange-400">
                    -£{lostRevenuePerDay}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Yearly Projection */}
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-5 w-5 text-red-400" />
                    <span className="text-gray-300">Lost revenue per year:</span>
                  </div>
                  <span className="text-2xl font-bold text-red-400">
                    £{lostRevenuePerYear.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* The Solution */}
            <Card className="bg-[#e8b323]/10 border-[#e8b323]/30">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">
                  The Fix: Get a Landing Page
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-300">Landing page cost:</span>
                    <span className="text-green-400 font-bold">FREE</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-300">Monthly cost:</span>
                    <span className="text-green-400 font-bold">£0</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-gray-300">Potential monthly revenue:</span>
                    <span className="text-[#e8b323] font-bold">+£{lostRevenuePerMonth.toLocaleString()}</span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
                  <p className="text-center text-gray-300">
                    <span className="text-white font-semibold">Bottom line:</span> A free landing page
                    could recover <span className="text-[#e8b323] font-bold">£{lostRevenuePerMonth.toLocaleString()}/month</span> in
                    lost leads
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <Card className="bg-gradient-to-r from-[#e8b323]/20 to-yellow-500/10 border-[#e8b323]/30">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold text-white mb-4">
                Stop Losing £{lostRevenuePerDay}/Day
              </h2>
              <p className="text-gray-300 mb-6">
                Get a professional landing page today - start capturing those leads
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/landing">
                  <Button size="lg" className="bg-[#e8b323] hover:bg-[#d4a520] text-black font-semibold">
                    See Demo Landing Page
                  </Button>
                </Link>
                <Link href="/pitch/roadmap">
                  <Button size="lg" variant="outline" className="border-gray-600">
                    View Growth Roadmap
                  </Button>
                </Link>
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
          <Link href="/pitch/roadmap">
            <Button className="bg-[#e8b323] hover:bg-[#d4a520] text-black">
              Next: Growth Roadmap
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
