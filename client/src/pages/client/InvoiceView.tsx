import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  Receipt, CreditCard, CheckCircle, AlertCircle, Loader2,
  Mail, Calendar, Repeat, Sparkles, MessageCircle, Users, Home,
  ExternalLink, Shield, Star, Phone, MapPin, Clock, FileText,
  Check, Lock, Wrench, ChevronRight, Zap, Camera, Building,
  ShieldCheck, ArrowRight, Paintbrush, Plug, Hammer, Droplets,
  Download,
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise, isStripeConfigured } from "@/lib/stripe";
import { Card, CardContent } from "@/components/ui/card";
import { NeonBadge } from "@/components/ui/neon-badge";
import { SectionWrapper } from "@/components/SectionWrapper";
import { HassleComparisonCard } from "@/components/quote/HassleComparisonCard";
import { SiVisa, SiMastercard, SiAmericanexpress, SiApplepay } from "react-icons/si";
import handyServicesLogo from "../../assets/handy-logo.webp";
import { generateBrandedInvoicePDF, generateSingleInvoicePDF, type BrandedInvoiceData } from "@/lib/invoice-pdf-branded";

// ==========================================
// Types
// ==========================================

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isPropertyHeader?: boolean;
  propertyAddress?: string;
  invoiceNumber?: string;
  sectionTotal?: number;
  sectionDeposit?: number;
  sectionBalance?: number;
}

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
  lineItems: LineItem[] | null;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface QuoteContext {
  jobDescription: string;
  address: string;
  customerName: string;
  segment: string | null;
  pricingLineItems: any;
}

interface JobEvidence {
  evidenceUrls: string[];
  completedAt: string | null;
  completionNotes: string | null;
}

interface InvoiceUpsell {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaAction: "whatsapp" | "quote_link" | "external_link";
  ctaValue: string;
  icon: "repeat" | "sparkles" | "message" | "calendar" | "users" | "home";
  priority: number;
}

interface PublicInvoiceResponse {
  invoice: Invoice;
  quoteContext: QuoteContext | null;
  jobEvidence: JobEvidence | null;
  upsells: InvoiceUpsell[];
  whatsappNumber: string;
}

// ==========================================
// Helpers
// ==========================================

const formatPence = (pence: number) => `\u00a3${(pence / 100).toFixed(2)}`;

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

function getUpsellIcon(icon: string) {
  const cls = "h-5 w-5";
  switch (icon) {
    case "repeat": return <Repeat className={cls} />;
    case "sparkles": return <Sparkles className={cls} />;
    case "message": return <MessageCircle className={cls} />;
    case "calendar": return <Calendar className={cls} />;
    case "users": return <Users className={cls} />;
    case "home": return <Home className={cls} />;
    default: return <Star className={cls} />;
  }
}

function buildWhatsAppUrl(number: string, message: string) {
  const cleaned = number.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "50px" as const },
  transition: { duration: 0.5 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

// ==========================================
// Invoice Payment Form (Stripe CardElement)
// ==========================================

function InvoicePaymentForm({
  invoiceId,
  balanceDue,
  invoiceNumber,
  customerEmail,
  onSuccess,
}: {
  invoiceId: string;
  balanceDue: number;
  invoiceNumber: string;
  customerEmail: string | null;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [email, setEmail] = useState(customerEmail || "");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoadingIntent, setIsLoadingIntent] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  useEffect(() => {
    if (!isEmailValid) return;

    let cancelled = false;
    setIsLoadingIntent(true);
    setError(null);

    fetch(`/api/invoices/${invoiceId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payerEmail: email }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to initialize payment");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setClientSecret(data.clientSecret);
          setIsLoadingIntent(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoadingIntent(false);
        }
      });

    return () => { cancelled = true; };
  }, [invoiceId, email, isEmailValid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) return;

    setIsProcessing(true);
    setError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: { email },
          },
        }
      );

      if (stripeError) throw new Error(stripeError.message);
      if (paymentIntent?.status === "succeeded") {
        onSuccess();
      } else {
        throw new Error("Payment was not successful");
      }
    } catch (err: any) {
      setError(err.message || "Payment failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Email */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-white flex items-center gap-2">
          <Mail className="h-4 w-4 text-[#e8b323]" />
          Email for receipt
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="w-full px-4 py-3.5 bg-gray-800/80 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-[#7DB00E] focus:ring-1 focus:ring-[#7DB00E] transition-all"
        />
      </div>

      {/* Card Element */}
      {isEmailValid && (
        <>
          {isLoadingIntent ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#7DB00E]" />
              <span className="ml-3 text-sm text-gray-400">Preparing secure payment...</span>
            </div>
          ) : clientSecret ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[#e8b323]" />
                Card Details
              </label>
              <div className="border border-gray-600 rounded-xl p-4 bg-gray-800/80 backdrop-blur-sm transition-all focus-within:border-[#7DB00E] focus-within:ring-1 focus-within:ring-[#7DB00E] focus-within:shadow-[0_0_15px_rgba(125,176,14,0.15)]">
                <CardElement
                  options={{
                    hidePostalCode: false,
                    style: {
                      base: {
                        fontSize: "16px",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        color: "#ffffff",
                        backgroundColor: "transparent",
                        iconColor: "#7DB00E",
                        "::placeholder": { color: "#6b7280" },
                      },
                      invalid: { color: "#f87171", iconColor: "#f87171" },
                      complete: { color: "#4ade80", iconColor: "#4ade80" },
                    },
                  }}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Lock className="h-3 w-3" />
                <span>256-bit encrypted. Secured by Stripe.</span>
              </div>
            </div>
          ) : null}
        </>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Pay Button */}
      <button
        type="submit"
        disabled={!stripe || isProcessing || isLoadingIntent || !clientSecret || !isEmailValid || !isStripeConfigured}
        className="w-full h-14 bg-[#7DB00E] hover:bg-[#6da000] disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl shadow-lg shadow-[#7DB00E]/20 hover:shadow-[#7DB00E]/30 active:scale-[0.98] transition-all"
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing Payment...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Lock className="h-4 w-4" />
            Pay {formatPence(balanceDue)} Securely
          </span>
        )}
      </button>

      {/* Payment Methods Strip — real icons from quote page */}
      <div className="flex flex-col items-center gap-2 pt-3">
        <div className="flex items-center gap-3 opacity-60">
          <SiVisa className="w-7 h-7 text-[#1434CB]" />
          <SiMastercard className="w-7 h-7 text-[#EB001B]" />
          <SiAmericanexpress className="w-7 h-7 text-[#2E77BC]" />
          <SiApplepay className="w-7 h-7 text-white" />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Lock className="w-3 h-3" />
          Secure payments via Stripe {"\u00B7"} 256-bit SSL
        </div>
      </div>
    </form>
  );
}

// ==========================================
// Invoice Line Items — mobile-optimised with expandable rows
// Property sections get prominent visual separation
// ==========================================

function InvoiceLineItems({ lineItems, customerName, invoiceDate, dueDate }: { lineItems: LineItem[]; customerName: string; invoiceDate: string; dueDate?: string }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Check if this is a multi-property invoice
  const hasPropertyHeaders = lineItems.some(li => li.isPropertyHeader);

  // Group items into property sections
  if (hasPropertyHeaders) {
    const sections: Array<{ address: string; invoiceNumber?: string; sectionDeposit?: number; sectionBalance?: number; items: Array<LineItem & { originalIdx: number }> }> = [];
    let current: typeof sections[0] | null = null;

    lineItems.forEach((item, idx) => {
      if (item.isPropertyHeader) {
        current = { address: item.propertyAddress || "", invoiceNumber: item.invoiceNumber, sectionDeposit: item.sectionDeposit, sectionBalance: item.sectionBalance, items: [] };
        sections.push(current);
      } else if (current) {
        current.items.push({ ...item, originalIdx: idx });
      }
    });

    // Multi-property: render each property as its own card
    return (
      <div className="space-y-4 border-t border-gray-700/50 pt-4 -mx-5 sm:-mx-6 px-5 sm:px-6">
        {sections.map((section, sIdx) => {
          const subtotal = section.items.reduce((s, i) => s + (i.total || 0), 0);
          return (
            <div key={sIdx} className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden">
              {/* Property header with invoice number, deposit & balance */}
              <div className="bg-gradient-to-r from-[#7DB00E]/15 to-[#7DB00E]/5 px-4 sm:px-5 py-3.5 border-b border-[#7DB00E]/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#7DB00E]/20 border border-[#7DB00E]/30 flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-[#7DB00E]" />
                    </div>
                    <div>
                      <p className="text-[#7DB00E] text-sm font-bold">{section.address}</p>
                      {section.invoiceNumber && (
                        <p className="text-[10px] text-gray-500 font-mono">{section.invoiceNumber} {"\u00B7"} {section.items.length} items</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-white font-bold text-sm block">{formatPence(subtotal)}</span>
                      {section.sectionDeposit != null && section.sectionDeposit > 0 && (
                        <span className="text-green-400 text-[10px] block">Deposit paid: {formatPence(section.sectionDeposit)}</span>
                      )}
                    </div>
                    {/* Download PDF for this property */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        generateSingleInvoicePDF(
                          {
                            address: section.address,
                            invoiceNumber: section.invoiceNumber || "",
                            items: section.items.map(i => ({ description: i.description, quantity: i.quantity || 1, unitPrice: i.total, total: i.total })),
                            total: subtotal,
                            deposit: section.sectionDeposit || 0,
                            balance: (section.sectionBalance != null ? section.sectionBalance : subtotal),
                          },
                          customerName,
                          invoiceDate,
                          dueDate,
                        );
                      }}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0"
                      title="Download PDF"
                    >
                      <Download className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Line items */}
              {section.items.map((item, iIdx) => {
                const isExpanded = expandedRows.has(item.originalIdx);
                return (
                  <div key={iIdx} className={iIdx > 0 ? "border-t border-gray-700/30" : ""}>
                    {/* Mobile: single line with bullet, tap to expand */}
                    <div
                      className="sm:hidden flex items-center justify-between px-4 py-3 cursor-pointer active:bg-gray-700/20"
                      onClick={() => toggleRow(item.originalIdx)}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#7DB00E]/60 shrink-0" />
                        <span className="text-white text-sm truncate">{item.description}</span>
                      </div>
                      <span className="text-gray-300 text-sm font-medium shrink-0">{item.total > 0 ? formatPence(item.total) : ""}</span>
                    </div>
                    {isExpanded && (
                      <div className="sm:hidden px-4 pb-3 text-xs text-gray-400">
                        <p className="leading-relaxed">{item.description}</p>
                      </div>
                    )}
                    {/* Desktop: full row with bullet */}
                    <div className="hidden sm:grid grid-cols-[1fr_60px_90px] gap-2 px-5 py-3.5 hover:bg-gray-700/10 transition-colors">
                      <span className="text-white text-sm flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#7DB00E]/60 shrink-0" />
                        {item.description}
                      </span>
                      <span className="text-gray-400 text-sm text-center">{item.quantity || ""}</span>
                      <span className="text-white text-sm font-medium text-right">{item.total > 0 ? formatPence(item.total) : ""}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // Single property / non-grouped: render flat table
  return (
    <div className="border-t border-gray-700/50">
      <div className="hidden sm:grid grid-cols-[1fr_60px_90px] gap-2 px-6 py-3 bg-gray-700/30">
        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Description</span>
        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold text-center">Qty</span>
        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold text-right">Amount</span>
      </div>
      {lineItems.filter(i => !i.isPropertyHeader).map((item, idx) => {
        const isExpanded = expandedRows.has(idx);
        return (
          <div key={idx} className="border-t border-gray-700/30">
            <div
              className="sm:hidden flex items-center justify-between px-5 py-3.5 cursor-pointer active:bg-gray-700/20"
              onClick={() => toggleRow(idx)}
            >
              <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-3">
                <div className="w-1.5 h-1.5 rounded-full bg-[#7DB00E]/60 shrink-0" />
                <span className="text-white text-sm truncate">{item.description}</span>
              </div>
              <span className="text-white text-sm font-semibold shrink-0">{item.total > 0 ? formatPence(item.total) : ""}</span>
            </div>
            {isExpanded && (
              <div className="sm:hidden px-5 pb-3 text-xs text-gray-400">
                <p className="leading-relaxed">{item.description}</p>
              </div>
            )}
            <div className="hidden sm:grid grid-cols-[1fr_60px_90px] gap-2 px-6 py-4 hover:bg-gray-700/10 transition-colors">
              <span className="text-white text-sm font-medium flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7DB00E]/60 shrink-0" />
                {item.description}
              </span>
              <span className="text-gray-400 text-sm text-center">{item.quantity || ""}</span>
              <span className="text-white text-sm font-semibold text-right">{item.total > 0 ? formatPence(item.total) : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// Upsell Card (Premium styled)
// ==========================================

function UpsellCard({ upsell, whatsappNumber, index }: { upsell: InvoiceUpsell; whatsappNumber: string; index: number }) {
  const handleCta = () => {
    if (upsell.ctaAction === "whatsapp") {
      window.open(buildWhatsAppUrl(whatsappNumber, upsell.ctaValue), "_blank");
    } else if (upsell.ctaAction === "external_link") {
      window.open(upsell.ctaValue, "_blank");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="group bg-gradient-to-br from-gray-800/80 to-gray-800/40 border border-gray-700/50 rounded-2xl p-5 hover:border-[#7DB00E]/30 hover:shadow-lg hover:shadow-[#7DB00E]/5 transition-all duration-300 backdrop-blur-sm"
    >
      <div className="flex items-start gap-4">
        <div className="bg-[#7DB00E]/10 text-[#7DB00E] p-3 rounded-xl shrink-0 group-hover:bg-[#7DB00E]/20 transition-colors">
          {getUpsellIcon(upsell.icon)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white text-base mb-1.5">{upsell.title}</h3>
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">{upsell.description}</p>
          <button
            onClick={handleCta}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#7DB00E]/10 hover:bg-[#7DB00E]/20 text-[#7DB00E] font-semibold text-sm rounded-xl transition-all border border-[#7DB00E]/20 hover:border-[#7DB00E]/40 active:scale-[0.98]"
          >
            {upsell.ctaAction === "whatsapp" && <MessageCircle className="h-4 w-4" />}
            {upsell.ctaLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ==========================================
// Google Review Card — fetches real reviews from API
// Matches quote page GoogleReviewCard dark variant exactly
// ==========================================

function InvoiceGoogleReview({ postcode }: { postcode: string | null }) {
  const { data: reviewsData } = useQuery({
    queryKey: ["google-reviews", "invoice", postcode],
    queryFn: async () => {
      const location = postcode ? postcode.split(" ")[0] : "nottingham";
      const res = await fetch(`/api/google-reviews?location=${location}`);
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
    staleTime: 1000 * 60 * 60,
  });

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!reviewsData?.reviews?.length) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % reviewsData.reviews.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [reviewsData]);

  const reviews = reviewsData?.reviews || [];
  const currentReview = reviews[activeIndex];

  if (!currentReview) return null;

  return (
    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative shadow-md transition-all duration-500">
      <div className="absolute -top-3 -right-3 bg-white p-1.5 rounded-full shadow-sm border border-slate-100">
        <span className="text-[#4285F4] font-bold text-xs">G</span>
      </div>
      <div className="flex gap-1 text-[#F4B400] mb-3">
        {[...Array(5)].map((_, i) => (
          <Star key={i} className={`w-3.5 h-3.5 ${i < currentReview.rating ? "fill-current" : "text-slate-300"}`} />
        ))}
      </div>
      <div className="min-h-[80px]">
        <p className="text-slate-700 text-sm italic mb-4 leading-relaxed">
          "{currentReview.text.length > 120 ? currentReview.text.substring(0, 120) + "..." : currentReview.text}"
        </p>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-slate-200/50">
        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 overflow-hidden">
          {currentReview.profile_photo_url ? (
            <img src={currentReview.profile_photo_url} alt={currentReview.authorName} className="w-full h-full object-cover" />
          ) : (
            currentReview.authorName.charAt(0)
          )}
        </div>
        <div>
          <div className="text-xs font-bold text-[#1D2D3D]">{currentReview.authorName}</div>
          <div className="text-[9px] text-slate-400 font-medium">{currentReview.relativeTime}</div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Status Badge (Neon-style)
// ==========================================

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, "green" | "blue" | "pink" | "amber"> = {
    paid: "green",
    sent: "blue",
    overdue: "pink",
    draft: "amber",
  };

  const iconMap: Record<string, any> = {
    paid: Check,
    sent: FileText,
    overdue: AlertCircle,
    draft: Clock,
  };

  return (
    <NeonBadge
      text={status}
      color={colorMap[status] || "amber"}
      icon={iconMap[status]}
    />
  );
}

// ==========================================
// Main Invoice Page
// ==========================================

function InvoicePageContent() {
  const { token } = useParams<{ token: string }>();
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Try public endpoint first (direct invoice ID), fall back to token endpoint
  const publicQuery = useQuery<PublicInvoiceResponse>({
    queryKey: ["invoice-public", token],
    queryFn: () =>
      fetch(`/api/invoices/public/${token}`).then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      }),
    enabled: !!token,
    retry: false,
  });

  const tokenQuery = useQuery<{ invoice: Invoice; token: string }>({
    queryKey: ["invoice-token", token],
    queryFn: () =>
      fetch(`/api/client-portal/invoices/token/${token}`).then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      }),
    enabled: !!token && publicQuery.isError,
    retry: false,
  });

  const isLoading = publicQuery.isLoading || (publicQuery.isError && tokenQuery.isLoading);
  const isError = publicQuery.isError && tokenQuery.isError;

  const invoice = publicQuery.data?.invoice || tokenQuery.data?.invoice || null;
  const quoteContext = publicQuery.data?.quoteContext || null;
  const jobEvidence = publicQuery.data?.jobEvidence || null;
  const upsells = publicQuery.data?.upsells || [];
  const whatsappNumber = publicQuery.data?.whatsappNumber || "447123456789";

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-2 border-[#7DB00E]/20 rounded-full" />
          <div className="absolute inset-0 w-16 h-16 border-2 border-[#7DB00E] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-gray-400 text-sm">Loading your invoice...</p>
      </div>
    );
  }

  // Error
  if (isError || !invoice) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-10 max-w-md text-center"
        >
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Invoice Not Found</h1>
          <p className="text-gray-400 leading-relaxed">This invoice link may have expired or is no longer valid. Please contact us if you need assistance.</p>
        </motion.div>
      </div>
    );
  }

  const isPaid = paymentSuccess || invoice.status === "paid";
  const hasBalance = invoice.balanceDue > 0;

  return (
    <div className="min-h-screen bg-slate-900 font-sans selection:bg-[#7DB00E] selection:text-white relative">
      {/* Decorative background grid */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none bg-[linear-gradient(rgba(125,176,14,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(125,176,14,0.3)_1px,transparent_1px)] bg-[size:40px_40px]" />

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-lg border-b border-gray-800"
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Handy" className="w-10 h-10 object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg text-white">Handy</span>
              <span className="font-normal text-sm text-gray-400">Services</span>
            </div>
          </div>
          {/* Individual invoice numbers shown per property section instead */}
        </div>
      </motion.header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5 relative z-10">

        {/* ============================================ */}
        {/* PAID CONFIRMATION STATE */}
        {/* ============================================ */}
        {isPaid && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <Card className="border-green-500 bg-gradient-to-b from-green-900/50 to-gray-800 border-2 overflow-hidden">
              <CardContent className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500 rounded-full mb-4 shadow-lg shadow-green-500/30">
                  <Check className="h-10 w-10 text-white" />
                </div>
                <h2 className="text-3xl font-bold text-green-400 mb-2">Payment Complete</h2>
                <p className="text-xl text-gray-200 mb-4">
                  Thank you, {invoice.customerName}
                </p>
                <div className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 rounded-xl px-5 py-2.5">
                  <span className="text-gray-400 text-sm">Total paid:</span>
                  <span className="text-green-400 font-bold text-lg">{formatPence(invoice.totalAmount)}</span>
                </div>
                {invoice.paidAt && (
                  <p className="text-xs text-gray-500 mt-4">
                    Paid on {formatDate(invoice.paidAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Job Summary removed — the line items table below already shows the same info. */}

        {/* ============================================ */}
        {/* EVIDENCE PHOTOS */}
        {/* ============================================ */}
        {jobEvidence && jobEvidence.evidenceUrls.length > 0 && (
          <motion.div {...fadeInUp}>
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] text-[#e8b323] uppercase tracking-widest font-bold">Completion Photos</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {jobEvidence.evidenceUrls.slice(0, 4).map((url, idx) => (
                  <div key={idx} className="relative group overflow-hidden rounded-xl">
                    <img
                      src={url}
                      alt={`Completed work ${idx + 1}`}
                      className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ============================================ */}
        {/* LINE ITEMS & TOTALS */}
        {/* ============================================ */}
        <motion.div {...fadeInUp}>
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700/50 overflow-hidden">
            {/* Customer Info */}
            <div className="p-5 sm:p-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1.5">Billed To</p>
                  <p className="text-white font-semibold">{invoice.customerName}</p>
                  {invoice.customerEmail && (
                    <p className="text-gray-400 text-xs mt-1">{invoice.customerEmail}</p>
                  )}
                  {invoice.customerAddress && (
                    <p className="text-gray-400 text-xs mt-0.5">{invoice.customerAddress}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1.5">Invoice Date</p>
                  <p className="text-white font-medium">{formatDate(invoice.createdAt)}</p>
                  {invoice.dueDate && !isPaid && (
                    <>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1 mt-3">Due Date</p>
                      <p className="text-white font-medium">{formatDate(invoice.dueDate)}</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Line Items Table (supports grouped-by-property for consolidated invoices) */}
            {invoice.lineItems && invoice.lineItems.length > 0 && (
              <InvoiceLineItems lineItems={invoice.lineItems} customerName={invoice.customerName} invoiceDate={invoice.createdAt} dueDate={invoice.dueDate || undefined} />
            )}

            {/* Totals */}
            <div className="border-t border-gray-700/50 p-5 sm:p-6 bg-gradient-to-br from-gray-800/60 to-gray-900/60">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subtotal</span>
                  <span className="text-gray-300">{formatPence(invoice.totalAmount)}</span>
                </div>
                {invoice.depositPaid > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" /> Deposit Paid
                    </span>
                    <span className="text-green-400">-{formatPence(invoice.depositPaid)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-3 border-t border-gray-600/50">
                  <span className="text-xl font-bold text-white">
                    {isPaid ? "Total Paid" : "Balance Due"}
                  </span>
                  <span className={`text-2xl font-extrabold ${isPaid ? "text-green-400" : "text-[#e8b323]"}`}>
                    {isPaid ? formatPence(invoice.totalAmount) : formatPence(invoice.balanceDue)}
                  </span>
                </div>

                {/* Download All PDF button */}
                {invoice.lineItems && invoice.lineItems.some((li: any) => li.isPropertyHeader) && (
                  <button
                    onClick={() => {
                      // Build sections from line items
                      const sections: any[] = [];
                      let current: any = null;
                      for (const li of (invoice.lineItems || [])) {
                        if ((li as any).isPropertyHeader) {
                          current = {
                            address: (li as any).propertyAddress || "",
                            invoiceNumber: (li as any).invoiceNumber || "",
                            items: [],
                            total: (li as any).sectionTotal || 0,
                            deposit: (li as any).sectionDeposit || 0,
                            balance: (li as any).sectionBalance || 0,
                          };
                          sections.push(current);
                        } else if (current && (li as any).total > 0) {
                          current.items.push({ description: li.description, quantity: li.quantity || 1, unitPrice: li.total, total: li.total });
                        }
                      }
                      generateBrandedInvoicePDF({
                        customerName: invoice.customerName,
                        customerEmail: invoice.customerEmail || undefined,
                        invoiceDate: invoice.createdAt,
                        dueDate: invoice.dueDate || undefined,
                        sections,
                        grandTotal: invoice.totalAmount,
                        totalDeposits: invoice.depositPaid,
                        balanceDue: invoice.balanceDue,
                      });
                    }}
                    className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 border border-gray-600/50 rounded-xl text-sm text-gray-300 font-medium transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    Download All Invoices (PDF)
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ============================================ */}
        {/* PAYMENT SECTION */}
        {/* ============================================ */}
        {!isPaid && hasBalance && (
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="rounded-2xl p-6 sm:p-8 border border-gray-700/50 bg-gradient-to-br from-gray-800/70 to-gray-900/70 backdrop-blur-sm shadow-xl">
              {/* Amount display */}
              <div className="text-center mb-6">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-1">Amount Due</p>
                <p className="text-4xl font-extrabold text-[#e8b323]">{formatPence(invoice.balanceDue)}</p>
              </div>

              <InvoicePaymentForm
                invoiceId={invoice.id}
                balanceDue={invoice.balanceDue}
                invoiceNumber={invoice.invoiceNumber}
                customerEmail={invoice.customerEmail}
                onSuccess={() => setPaymentSuccess(true)}
              />
            </div>
          </motion.div>
        )}

        {/* Trust strip removed — covered by ValueGuarantee section and payment icons */}

        {/* ============================================ */}
        {/* CONTEXTUAL UPSELLS */}
        {/* ============================================ */}
        {upsells.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#7DB00E]/10 border border-[#7DB00E]/20 mb-3">
                <Sparkles className="h-3.5 w-3.5 text-[#7DB00E]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#7DB00E]">
                  {isPaid ? "Recommended" : "While You're Here"}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white">
                {isPaid ? "What's Next?" : "More Ways We Can Help"}
              </h2>
              <p className="text-sm text-gray-400 mt-1">Based on your recent job</p>
            </div>
            <div className="space-y-3">
              {upsells.map((upsell, idx) => (
                <UpsellCard key={upsell.id} upsell={upsell} whatsappNumber={whatsappNumber} index={idx} />
              ))}
            </div>
          </motion.div>
        )}

        {/* ============================================ */}
        {/* VALUE SOCIAL PROOF — white bg section like quote page */}
        {/* ============================================ */}
        <SectionWrapper className="bg-white text-slate-900 rounded-2xl -mx-4 sm:mx-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl w-full"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7DB00E]/10 text-[#7DB00E] text-xs font-bold uppercase tracking-wider mb-4">
              <Star className="w-3 h-3" />
              Proven Reliability
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1D2D3D] mb-3">
              Trusted by Nottingham homeowners
            </h2>
            <p className="text-slate-500 text-sm mb-8">Join hundreds of satisfied customers</p>

            {/* Stats row — matching quote page ValueSocialProof */}
            <div className="flex items-center justify-center gap-8 mb-8">
              {[
                { icon: Star, value: "4.9", label: "Google Rating" },
                { icon: Zap, value: "500+", label: "Completed Jobs" },
                { icon: Shield, value: "\u00A32M", label: "Insured" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="flex justify-center mb-1">
                    <div className="p-2 bg-[#7DB00E]/10 rounded-full">
                      <stat.icon className="w-4 h-4 text-[#7DB00E]" />
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold text-[#1D2D3D]">{stat.value}</div>
                  <div className="text-xs text-slate-500">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Google Review Card */}
            <InvoiceGoogleReview postcode={invoice.customerAddress} />
          </motion.div>
        </SectionWrapper>

        {/* ============================================ */}
        {/* VALUE GUARANTEE — dark section bg-[#1D2D3D] like quote page */}
        {/* ============================================ */}
        <SectionWrapper className="bg-[#1D2D3D] text-white rounded-2xl -mx-4 sm:mx-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "50px" }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl w-full"
          >
            <h2 className="text-[#7DB00E] text-xs font-bold uppercase tracking-[0.2em] mb-4">Our Guarantee</h2>
            <h3 className="text-4xl md:text-5xl font-light mb-8 text-white">
              <span className="font-bold block leading-tight">Not right? We return<br /> and fix it free.</span>
            </h3>
            <p className="text-slate-300 text-sm md:text-base mb-6">
              Quality workmanship, full cleanup, and photo report on every job. No questions asked.
            </p>

            {/* Guarantee Items — exact quote page ValueGuarantee pattern */}
            <div className="space-y-4 mb-10 text-left">
              {[
                { icon: ShieldCheck, title: "90-Day Workmanship Guarantee", text: "If anything we've done isn't right within 90 days, we return and fix it free." },
                { icon: Camera, title: "Photo Evidence on Every Job", text: "Before and after photos sent to you. Full transparency on what was done." },
                { icon: Zap, title: "48-Hour Response Time", text: "Report an issue and we'll have someone there within 48 hours. No waiting around." },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="group flex items-center gap-5 bg-gradient-to-br from-white/10 to-transparent border border-white/10 hover:border-[#7DB00E]/50 transition-all duration-300 rounded-xl p-6"
                >
                  <div className="shrink-0 p-3.5 bg-gradient-to-br from-[#7DB00E] to-[#6da000] rounded-full shadow-lg shadow-[#7DB00E]/20 group-hover:scale-110 transition-transform duration-300">
                    <item.icon className="w-6 h-6 text-[#1D2D3D]" />
                  </div>
                  <div>
                    <div className="text-white font-bold text-lg leading-tight mb-1">{item.title}</div>
                    <div className="text-slate-300 text-sm leading-relaxed">{item.text}</div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Guarantee box */}
            <div className="bg-[#7DB00E]/10 border border-[#7DB00E]/30 rounded-xl p-4 mb-10 text-center">
              <p className="text-[#7DB00E] font-medium text-sm">
                Quality guaranteed. No hidden fees.
              </p>
            </div>

            {/* Trust badges grid — exact quote page labels */}
            <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
              {[
                { icon: Shield, label: "Insured", value: "\u00A32M" },
                { icon: Star, label: "Vetted", value: "DBS Checked" },
                { icon: Lock, label: "Price", value: "Fixed" },
                { icon: ShieldCheck, label: "Quality", value: "Guaranteed" },
              ].map((item, i) => (
                <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/10 shadow-sm text-center hover:bg-white/10 transition-all">
                  <div className="flex justify-center mb-2 text-[#7DB00E]">
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{item.label}</div>
                  <div className="text-sm font-bold text-white">{item.value}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </SectionWrapper>

        {/* ============================================ */}
        {/* WHY CHOOSE US — HassleComparisonCard from quote page */}
        {/* ============================================ */}
        <SectionWrapper className="bg-white text-slate-900 rounded-2xl -mx-4 sm:mx-0">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl w-full"
          >
            <HassleComparisonCard
              contextualItems={{
                withoutUs: [
                  "Gamble on an unknown tradesman \u2014 hope for the best",
                  "Mess left behind for you to sort out",
                  "If something goes wrong, good luck getting them back",
                ],
                withUs: [
                  "Vetted professional with proven track record",
                  "Full cleanup included \u2014 we leave it spotless",
                  "90-day guarantee \u2014 we come back and fix it free",
                ],
              }}
            />
          </motion.div>
        </SectionWrapper>

        {/* ============================================ */}
        {/* LANDLORD PLATFORM PROMO */}
        {/* ============================================ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 rounded-2xl overflow-hidden border border-gray-700/50">
            <div className="bg-[#7DB00E] py-2 px-4 flex items-center justify-center gap-2">
              <Building className="h-4 w-4 text-[#1D2D3D]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#1D2D3D]">Landlord Platform</span>
              <span className="bg-[#1D2D3D] text-[#7DB00E] text-[10px] font-bold px-2 py-0.5 rounded-full">NEW</span>
            </div>
            <div className="p-6 sm:p-8">
              <div className="grid sm:grid-cols-2 gap-6 items-center">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2 leading-tight">
                    Manage All Your Properties.<br />
                    <span className="text-[#7DB00E]">One WhatsApp Message.</span>
                  </h3>
                  <p className="text-sm text-slate-300 mb-5 leading-relaxed">
                    Report issues, get instant quotes, track repairs — all from your phone. No more chasing contractors.
                  </p>
                  <ul className="space-y-2.5 mb-6">
                    {["WhatsApp job reporting", "Photo proof on every job", "Invoices sent automatically", "Recurring maintenance plans"].map((text) => (
                      <li key={text} className="flex items-start gap-2.5">
                        <div className="w-5 h-5 rounded-full bg-[#7DB00E]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check className="w-3 h-3 text-[#7DB00E]" />
                        </div>
                        <span className="text-sm text-slate-300">{text}</span>
                      </li>
                    ))}
                  </ul>
                  <a href="/landlord" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-4 px-6 bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg rounded-xl shadow-lg hover:shadow-xl transition-all">
                    Learn More <ArrowRight className="h-5 w-5" />
                  </a>
                </div>
                {/* WhatsApp chat mockup */}
                <div className="bg-slate-900 rounded-2xl p-4 border border-white/10">
                  <div className="flex items-center gap-2 pb-3 border-b border-white/10 mb-3">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center"><MessageCircle className="h-4 w-4 text-white" /></div>
                    <div><p className="text-white text-xs font-semibold">Handy Services</p><p className="text-[10px] text-green-400">Online</p></div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex justify-end"><div className="bg-green-700/30 border border-green-600/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]"><p className="text-xs text-gray-200">Leaking tap at 14 Lenton Blvd, tenant reported it this morning</p><p className="text-[9px] text-gray-500 text-right mt-1">09:14</p></div></div>
                    <div className="flex justify-start"><div className="bg-gray-800 border border-white/10 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]"><p className="text-xs text-gray-200">Got it! Job #4821 raised. Available tomorrow AM. Shall I book it?</p><p className="text-[9px] text-gray-500 mt-1">09:14</p></div></div>
                    <div className="flex justify-end"><div className="bg-green-700/30 border border-green-600/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]"><p className="text-xs text-gray-200">Yes please, tenant is home all day</p><p className="text-[9px] text-gray-500 text-right mt-1">09:15</p></div></div>
                    <div className="flex justify-start"><div className="bg-gray-800 border border-white/10 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]"><p className="text-xs text-green-400 font-medium">Booked! Mike arrives 9-12pm tomorrow. We'll send photos when done.</p><p className="text-[9px] text-gray-500 mt-1">09:15</p></div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ============================================ */}
        {/* CONTEXTUAL TRUST STRIP — exact quote page ContextualTrustStrip */}
        {/* ============================================ */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500 py-3">
            <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-slate-400" />{"\u00A3"}2M Insured</span>
            <span className="text-slate-300">{"\u00B7"}</span>
            <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />4.9 Google (127 reviews)</span>
            <span className="text-slate-300">{"\u00B7"}</span>
            <span className="flex items-center gap-1"><Lock className="w-3.5 h-3.5 text-slate-400" />Fixed Price</span>
          </div>
          <p className="text-xs text-center text-slate-500 italic">Not right? We return and fix it free. No questions.</p>
        </div>

        {/* ============================================ */}
        {/* FOOTER */}
        {/* ============================================ */}
        <motion.div {...fadeInUp} className="text-center py-8 space-y-4">
          <p className="text-sm text-gray-400">Questions about this invoice?</p>
          <a
            href={buildWhatsAppUrl(whatsappNumber, `Hi, I have a question about invoice ${invoice.invoiceNumber}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl shadow-lg shadow-green-600/20 hover:shadow-green-500/30 active:scale-[0.98] transition-all"
          >
            <Phone className="h-4 w-4" />
            WhatsApp Us
          </a>
          <p className="text-xs text-gray-700 mt-4">
            Handy Services {"\u00A9"} {new Date().getFullYear()}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// ==========================================
// Wrapper with Stripe Elements provider
// ==========================================

export default function InvoiceView() {
  if (!stripePromise) {
    return <InvoicePageContent />;
  }

  return (
    <Elements stripe={stripePromise}>
      <InvoicePageContent />
    </Elements>
  );
}
