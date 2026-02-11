import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { CreditCard, CheckCircle, AlertCircle, Lock } from "lucide-react";
import { useState } from "react";

interface PaymentLink {
  id: string;
  shortCode: string;
  amountPence: number;
  description: string | null;
  status: string;
  expiresAt: string | null;
  contractor: { businessName: string; profileImageUrl: string | null } | null;
}

export default function PaymentPage() {
  const { shortCode } = useParams<{ shortCode: string }>();
  const [email, setEmail] = useState("");
  const [paid, setPaid] = useState(false);

  const { data, isLoading, error } = useQuery<PaymentLink>({
    queryKey: ["payment-link", shortCode],
    queryFn: () => fetch(`/api/pay/${shortCode}`).then(r => {
      if (!r.ok) throw new Error("Payment link not found");
      return r.json();
    }),
    enabled: !!shortCode,
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pay/${shortCode}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerEmail: email }),
      });
      if (!res.ok) throw new Error("Payment failed");
      return res.json();
    },
    onSuccess: () => setPaid(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading payment...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Payment Link Invalid</h1>
          <p className="text-gray-400">This payment link may have expired or already been used.</p>
        </div>
      </div>
    );
  }

  if (paid || data.status === "paid") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Payment Complete</h1>
          <p className="text-gray-400">Thank you for your payment of £{(data.amountPence / 100).toFixed(2)}.</p>
          {data.description && (
            <p className="text-sm text-gray-500 mt-4">{data.description}</p>
          )}
        </div>
      </div>
    );
  }

  if (data.status === "expired") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Payment Link Expired</h1>
          <p className="text-gray-400">This payment link has expired. Please contact the business for a new link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="h-16 w-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <CreditCard className="h-8 w-8 text-black" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Payment Request</h1>
          {data.contractor?.businessName && (
            <p className="text-gray-400">from {data.contractor.businessName}</p>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-6">
          {data.description && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <p className="text-white">{data.description}</p>
            </div>
          )}

          <div className="text-center py-4 border-y border-gray-700">
            <p className="text-sm text-gray-400 mb-1">Amount Due</p>
            <p className="text-4xl font-bold text-yellow-500">
              £{(data.amountPence / 100).toFixed(2)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Email for Receipt
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
            />
          </div>

          <button
            onClick={() => payMutation.mutate()}
            disabled={payMutation.isPending || !email}
            className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {payMutation.isPending ? (
              "Processing..."
            ) : (
              <>
                <Lock className="h-4 w-4" />
                Pay £{(data.amountPence / 100).toFixed(2)}
              </>
            )}
          </button>

          {payMutation.isError && (
            <p className="text-red-400 text-sm text-center">
              Payment failed. Please try again.
            </p>
          )}

          <p className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
            <Lock className="h-3 w-3" />
            Secure payment powered by Stripe
          </p>
        </div>
      </div>
    </div>
  );
}
