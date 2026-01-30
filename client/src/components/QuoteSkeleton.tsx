/**
 * Skeleton loading screen for PersonalizedQuotePage
 * Shows a preview of the page structure while quote data is loading
 */
export function QuoteSkeleton() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 animate-pulse">
            {/* Hero Section Skeleton */}
            <div className="px-8 pt-20 pb-12 max-w-4xl mx-auto">
                {/* Header */}
                <div className="space-y-4 mb-12">
                    <div className="h-8 bg-gray-700 rounded-lg w-3/4 mx-auto"></div>
                    <div className="h-6 bg-gray-700 rounded-lg w-1/2 mx-auto"></div>
                </div>

                {/* Customer Info Card */}
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-8">
                    <div className="space-y-3">
                        <div className="h-5 bg-gray-700 rounded w-1/3"></div>
                        <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                        <div className="h-4 bg-gray-700 rounded w-2/3"></div>
                    </div>
                </div>

                {/* Packages Section Skeleton */}
                <div className="space-y-6 mt-12">
                    <div className="h-10 bg-gray-700 rounded-lg w-1/2 mx-auto mb-8"></div>

                    {/* Package Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                                {/* Package Header */}
                                <div className="space-y-3 mb-6">
                                    <div className="h-6 bg-gray-700 rounded w-3/4"></div>
                                    <div className="h-8 bg-gray-700 rounded w-1/2"></div>
                                </div>

                                {/* Package Features */}
                                <div className="space-y-2">
                                    {[1, 2, 3, 4].map((j) => (
                                        <div key={j} className="h-4 bg-gray-700 rounded w-full"></div>
                                    ))}
                                </div>

                                {/* CTA Button */}
                                <div className="mt-6 h-12 bg-gray-700 rounded-lg"></div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Additional Info Section */}
                <div className="mt-12 space-y-4">
                    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                        <div className="h-5 bg-gray-700 rounded w-1/4 mb-4"></div>
                        <div className="space-y-2">
                            <div className="h-4 bg-gray-700 rounded w-full"></div>
                            <div className="h-4 bg-gray-700 rounded w-5/6"></div>
                            <div className="h-4 bg-gray-700 rounded w-4/6"></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Subtle loading indicator */}
            <div className="fixed bottom-8 right-8 flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-full border border-gray-700">
                <div className="h-2 w-2 bg-[#e8b323] rounded-full animate-bounce"></div>
                <div className="h-2 w-2 bg-[#e8b323] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="h-2 w-2 bg-[#e8b323] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <span className="text-gray-400 text-sm ml-2">Loading quote...</span>
            </div>
        </div>
    );
}
