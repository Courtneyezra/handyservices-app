import { useQuery } from '@tanstack/react-query';
import { Star, Loader2 } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';
import { Card, CardContent } from '@/components/ui/card';

interface GoogleReview {
  authorName: string;
  authorPhoto?: string;
  rating: number;
  text: string;
  relativeTime: string;
  time: number;
}

interface GoogleReviewsData {
  businessName: string;
  rating: number;
  totalReviews: number;
  reviews: GoogleReview[];
}

interface GoogleReviewsSectionProps {
  location?: 'nottingham' | 'derby';
  darkMode?: boolean;
}

export function GoogleReviewsSection({ location = 'nottingham', darkMode = false }: GoogleReviewsSectionProps) {
  const { data: reviewsData, isLoading, error } = useQuery<GoogleReviewsData>({
    queryKey: ['/api/google-reviews', location],
    queryFn: async () => {
      const res = await fetch(`/api/google-reviews?location=${location}`);
      if (!res.ok) throw new Error('Failed to fetch reviews');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <section className={`py-16 px-4 ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
        <div className="max-w-4xl mx-auto text-center">
          <Loader2 className={`w-8 h-8 animate-spin mx-auto ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        </div>
      </section>
    );
  }

  if (error || !reviewsData || reviewsData.reviews.length === 0) {
    return null;
  }

  return (
    <section className={`py-16 px-4 font-poppins font-medium ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-4">
            <SiGoogle className="w-6 h-6 text-[#4285F4]" />
            <span className={`text-lg font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Google Reviews</span>
          </div>
          <h2 className={`text-3xl font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            What Our Customers Say
          </h2>
          <div className="flex items-center justify-center gap-2">
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={`w-5 h-5 ${i < Math.round(reviewsData.rating) ? 'text-yellow-400 fill-current' : 'text-gray-300'}`}
                />
              ))}
            </div>
            <span className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{reviewsData.rating.toFixed(1)}</span>
            <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>({reviewsData.totalReviews} reviews)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviewsData.reviews.slice(0, 5).map((review, index) => (
            <Card
              key={index}
              className={`border hover:shadow-lg transition-shadow ${darkMode ? 'bg-slate-700 border-slate-600' : 'border-gray-200'}`}
              data-testid={`review-card-${index}`}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  {review.authorPhoto ? (
                    <img
                      src={review.authorPhoto}
                      alt={review.authorName}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${darkMode ? 'bg-slate-600' : 'bg-gray-200'}`}>
                      <span className={`font-semibold text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {review.authorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{review.authorName}</p>
                    <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{review.relativeTime}</p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 mb-3">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${i < review.rating ? 'text-yellow-400 fill-current' : 'text-gray-300'}`}
                    />
                  ))}
                </div>
                <p className={`text-sm leading-relaxed line-clamp-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  "{review.text}"
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-8">
          <a
            href="https://www.google.com/maps/search/?api=1&query=Handy+Services"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-blue-500 hover:text-blue-400 font-medium"
            data-testid="view-all-reviews-link"
          >
            <SiGoogle className="w-4 h-4" />
            View all reviews on Google
          </a>
        </div>
      </div>
    </section>
  );
}
