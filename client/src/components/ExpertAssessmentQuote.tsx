import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, User, ArrowRight } from 'lucide-react';
import type { PersonalizedQuote } from '@/pages/PersonalizedQuotePage';

interface ExpertAssessmentQuoteProps {
    quote: PersonalizedQuote;
}

export function ExpertAssessmentQuote({ quote }: ExpertAssessmentQuoteProps) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl shadow-lg border-l-4 border-l-blue-600">
                <CardHeader className="p-6">
                    <Badge className="w-fit mb-4 bg-blue-100 text-blue-800 hover:bg-blue-100">Expert Assessment</Badge>
                    <CardTitle className="text-3xl font-bold text-gray-900">
                        Consultation Required
                    </CardTitle>
                    <p className="text-gray-500 mt-2 text-lg">
                        {quote.assessmentReason || "To give you an accurate price, we need a quick expert assessment."}
                    </p>
                </CardHeader>
                <CardContent className="p-6 pt-0 space-y-8">
                    <div className="bg-white border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                            <User className="w-5 h-5 text-blue-600" />
                            Your Expert
                        </h3>
                        {quote.contractor ? (
                            <div className="flex items-center gap-4">
                                {quote.contractor.profilePhotoUrl ? (
                                    <img
                                        src={quote.contractor.profilePhotoUrl}
                                        alt={quote.contractor.name}
                                        className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-md"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xl font-bold">
                                        {quote.contractor.name.charAt(0)}
                                    </div>
                                )}
                                <div>
                                    <div className="font-bold text-lg">{quote.contractor.name}</div>
                                    <div className="text-blue-600 font-medium">{quote.contractor.companyName}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-gray-500 italic">An expert from our team will be assigned.</div>
                        )}
                    </div>

                    <Button className="w-full text-xl h-14 bg-blue-600 hover:bg-blue-700 gap-2">
                        <Calendar className="w-5 h-5" />
                        Schedule Assessment
                        <ArrowRight className="w-5 h-5 ml-auto" />
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
