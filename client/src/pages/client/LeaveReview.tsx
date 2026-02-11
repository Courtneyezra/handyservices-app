import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Star, CheckCircle, AlertCircle } from "lucide-react";
import { useState } from "react";

interface ReviewData {
  id: string;
  customerName: string;
  isVerified: boolean;
  contractor: { businessName: string; profileImageUrl: string | null } | null;
}

export default function LeaveReview() {
  const { token } = useParams<{ token: string }>();
  const [overallRating, setOverallRating] = useState(0);
  const [qualityRating, setQualityRating] = useState(0);
  const [timelinessRating, setTimelinessRating] = useState(0);
  const [communicationRating, setCommunicationRating] = useState(0);
  const [valueRating, setValueRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery<ReviewData>({
    queryKey: ["review-token", token],
    queryFn: () => fetch(`/api/client-portal/reviews/token/${token}`).then(r => {
      if (!r.ok) throw new Error("Review link not found");
      return r.json();
    }),
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/client-portal/reviews/token/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overallRating,
          qualityRating: qualityRating || undefined,
          timelinessRating: timelinessRating || undefined,
          communicationRating: communicationRating || undefined,
          valueRating: valueRating || undefined,
          reviewText: reviewText || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Link Invalid</h1>
          <p className="text-gray-400">This review link may have already been used or has expired.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Thank You!</h1>
          <p className="text-gray-400">Your review has been submitted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <Star className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Leave a Review</h1>
          <p className="text-gray-400">Hi {data.customerName}, how was your experience?</p>
          {data.contractor?.businessName && (
            <p className="text-gray-500 mt-2">for {data.contractor.businessName}</p>
          )}
          {data.isVerified && (
            <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs">
              <CheckCircle className="h-3 w-3" />
              Verified Customer
            </span>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-white mb-3">Overall Rating *</label>
            <StarRating value={overallRating} onChange={setOverallRating} size="lg" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Quality of Work</label>
              <StarRating value={qualityRating} onChange={setQualityRating} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Timeliness</label>
              <StarRating value={timelinessRating} onChange={setTimelinessRating} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Communication</label>
              <StarRating value={communicationRating} onChange={setCommunicationRating} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Value for Money</label>
              <StarRating value={valueRating} onChange={setValueRating} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Your Review</label>
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Tell others about your experience..."
              rows={4}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 resize-none"
            />
          </div>

          <button
            onClick={() => submitMutation.mutate()}
            disabled={overallRating === 0 || submitMutation.isPending}
            className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Review"}
          </button>

          {submitMutation.isError && (
            <p className="text-red-400 text-sm text-center">Failed to submit review</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StarRating({ value, onChange, size = "md" }: { value: number; onChange: (v: number) => void; size?: "md" | "lg" }) {
  const [hover, setHover] = useState(0);
  const starSize = size === "lg" ? "h-10 w-10" : "h-6 w-6";

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(star)}
          className="focus:outline-none"
        >
          <Star
            className={`${starSize} transition-colors ${
              star <= (hover || value) ? "text-yellow-500 fill-yellow-500" : "text-gray-600"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
