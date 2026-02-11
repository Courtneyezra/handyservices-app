import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Receipt, CreditCard, CheckCircle, AlertCircle } from "lucide-react";
import { useState } from "react";

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  totalAmount: number;
  depositPaid: number;
  balanceDue: number;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }> | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

export default function InvoiceView() {
  const { token } = useParams<{ token: string }>();
  const [paymentEmail, setPaymentEmail] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const { data, isLoading, error } = useQuery<{ invoice: Invoice; token: string }>({
    queryKey: ["invoice-token", token],
    queryFn: () => fetch(`/api/client-portal/invoices/token/${token}`).then(r => {
      if (!r.ok) throw new Error("Invoice not found");
      return r.json();
    }),
    enabled: !!token,
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/invoices/${data?.invoice.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerEmail: paymentEmail }),
      });
      if (!res.ok) throw new Error("Payment failed");
      return res.json();
    },
    onSuccess: () => setPaymentSuccess(true),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading invoice...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Invoice Not Found</h1>
          <p className="text-gray-400">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  const { invoice } = data;

  if (paymentSuccess || invoice.status === "paid") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Payment Complete</h1>
          <p className="text-gray-400">Thank you for your payment.</p>
          <p className="text-sm text-gray-500 mt-4">Invoice #{invoice.invoiceNumber}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Receipt className="h-8 w-8 text-yellow-500" />
              <div>
                <h1 className="text-xl font-bold text-white">Invoice</h1>
                <p className="text-gray-400 font-mono">#{invoice.invoiceNumber}</p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              invoice.status === "paid" ? "bg-green-500/20 text-green-400" :
              invoice.status === "sent" ? "bg-blue-500/20 text-blue-400" :
              "bg-gray-500/20 text-gray-400"
            }`}>
              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm mb-6">
            <div>
              <p className="text-gray-500 mb-1">Billed To</p>
              <p className="text-white font-medium">{invoice.customerName}</p>
              {invoice.customerEmail && <p className="text-gray-400">{invoice.customerEmail}</p>}
            </div>
            <div className="text-right">
              <p className="text-gray-500 mb-1">Invoice Date</p>
              <p className="text-white">{new Date(invoice.createdAt).toLocaleDateString("en-GB")}</p>
            </div>
          </div>

          {invoice.lineItems && invoice.lineItems.length > 0 && (
            <table className="w-full mb-6">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm text-gray-300">Description</th>
                  <th className="px-4 py-2 text-center text-sm text-gray-300">Qty</th>
                  <th className="px-4 py-2 text-right text-sm text-gray-300">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 text-white">{item.description}</td>
                    <td className="px-4 py-3 text-center text-gray-300">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-white">£{(item.total / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="border-t border-gray-700 pt-4">
            <div className="flex justify-between text-gray-400 mb-2">
              <span>Subtotal</span>
              <span>£{(invoice.totalAmount / 100).toFixed(2)}</span>
            </div>
            {invoice.depositPaid > 0 && (
              <div className="flex justify-between text-green-400 mb-2">
                <span>Deposit Paid</span>
                <span>-£{(invoice.depositPaid / 100).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-semibold pt-2 border-t border-gray-600">
              <span className="text-white">Balance Due</span>
              <span className="text-yellow-500">£{(invoice.balanceDue / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {invoice.balanceDue > 0 && invoice.status !== "paid" && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mt-4">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-yellow-500" />
              Pay Now
            </h2>
            <div className="space-y-4">
              <input
                type="email"
                value={paymentEmail}
                onChange={(e) => setPaymentEmail(e.target.value)}
                placeholder="Email for receipt"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
              />
              <button
                onClick={() => payMutation.mutate()}
                disabled={payMutation.isPending || !paymentEmail}
                className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 text-black font-semibold rounded-lg transition-colors"
              >
                {payMutation.isPending ? "Processing..." : `Pay £${(invoice.balanceDue / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
