import { useState, useEffect } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { isStripeConfigured } from '@/lib/stripe';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Loader2, AlertCircle, CheckCircle2, Mail } from 'lucide-react';

interface PaymentFormProps {
  amount: number; // Amount in pence (unused for deposit mode, used as fallback)
  customerName: string;
  customerEmail?: string;
  quoteId: string;
  selectedTier: string;
  selectedTierPrice: number;
  selectedExtras?: string[]; // Optional extras selected by customer
  paymentType?: 'full' | 'installments'; // Payment mode: full or 3 monthly payments
  mode?: 'deposit' | 'visit'; // NEW: Switch between deposit calculation and full visit payment
  slot?: { date: string, slot: string }; // Optional slot info for visit mode
  onSuccess: (paymentIntentId: string) => Promise<void>;
  onError?: (error: string) => void;
}

export function PaymentForm({
  amount,
  customerName,
  customerEmail,
  quoteId,
  selectedTier,
  selectedTierPrice,
  selectedExtras,
  paymentType = 'full',
  mode = 'deposit',
  slot,
  onSuccess,
  onError
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  // Email state with validation
  const [email, setEmail] = useState(customerEmail || '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverCalculatedAmount, setServerCalculatedAmount] = useState<number | null>(null);
  const [depositBreakdown, setDepositBreakdown] = useState<{
    totalMaterialsCost: number;
    labourDepositComponent: number;
  } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoadingIntent, setIsLoadingIntent] = useState(true);

  // Create stable reference for selectedExtras to avoid unnecessary re-fetches
  const extrasKey = JSON.stringify(selectedExtras || []);

  // Email validation helper
  const validateEmail = (emailValue: string): string | null => {
    if (!emailValue.trim()) {
      return 'Email is required for booking confirmation';
    }
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue)) {
      return 'Please enter a valid email address';
    }
    return null;
  };

  // Validate email on change
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);
    if (emailTouched) {
      setEmailError(validateEmail(newEmail));
    }
  };

  // Validate email on blur
  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(validateEmail(email));
  };

  // Check if email is valid for form submission
  const isEmailValid = !validateEmail(email);

  // Fetch payment intent when tier or extras change (re-calculate deposit)
  useEffect(() => {
    const abortController = new AbortController();
    const requestId = Date.now(); // Track this specific request
    let isCurrentRequest = true; // Flag to prevent stale updates

    const fetchPaymentIntent = async () => {
      try {
        setIsLoadingIntent(true);
        setError(null); // Clear any previous errors
        // Clear stale payment data to prevent submission with outdated intent
        setClientSecret(null);
        setPaymentIntentId(null);
        setServerCalculatedAmount(null);

        let url = '/api/create-payment-intent';
        let body: any = {
          customerName,
          customerEmail: email || customerEmail, // Use form email, fallback to prop
          quoteId,
          selectedTier,
          selectedTierPrice, // For validation only - server uses stored price
          selectedExtras, // Pass selected extras for deposit calculation
          paymentType, // Payment mode: 'full' or 'installments'
        };

        if (mode === 'visit') {
          url = '/api/create-visit-payment-intent';
          body = {
            customerName,
            customerEmail: email || customerEmail, // Use form email, fallback to prop
            quoteId,
            tierId: selectedTier,
            slot: slot ? { date: slot.date, slot: slot.slot } : undefined
          };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        // Only update state if this is still the current request
        if (!isCurrentRequest) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Server error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.clientSecret) {
          throw new Error('Failed to create payment intent');
        }

        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);

        // Set server-calculated amount
        if (mode === 'visit') {
          setServerCalculatedAmount(data.amount);
          setDepositBreakdown(null); // No breakdown for flat visit fee
        } else if (data.depositBreakdown?.total) {
          setServerCalculatedAmount(data.depositBreakdown.total);
          setDepositBreakdown({
            totalMaterialsCost: data.depositBreakdown.totalMaterialsCost || 0,
            labourDepositComponent: data.depositBreakdown.labourDepositComponent || 0,
          });
        }

        setIsLoadingIntent(false); // Only set loading false for successful current request
      } catch (err: any) {
        // Ignore aborted requests completely - don't update ANY state
        if (err.name === 'AbortError' || !isCurrentRequest) return;

        const errorMessage = err.message || 'Failed to initialize payment. Please try again.';
        setError(errorMessage);
        setIsLoadingIntent(false); // Only set loading false for actual errors
        if (onError) {
          onError(errorMessage);
        }
      }
    };

    fetchPaymentIntent();

    // Cleanup: mark this request as stale and abort
    return () => {
      isCurrentRequest = false; // Prevent any pending state updates
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerName, customerEmail, quoteId, selectedTier, selectedTierPrice, extrasKey, paymentType, mode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Validate email before submission
    const emailValidationError = validateEmail(email);
    if (emailValidationError) {
      setEmailError(emailValidationError);
      setEmailTouched(true);
      return;
    }

    if (!stripe || !elements || !clientSecret || !paymentIntentId) {
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Confirm the payment with the card details
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: customerName,
              email: email, // Use form email for billing details
            },
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (paymentIntent?.status === 'succeeded') {
        // Set confirmation email to show success message
        setConfirmationEmail(email);

        // Payment succeeded - call onSuccess but DON'T throw if it fails
        // The webhook will handle booking creation asynchronously
        try {
          await onSuccess(paymentIntentId);
        } catch (bookingError: any) {
          // Payment succeeded but booking call had issues - log but don't show error
          // The Stripe webhook will create the booking anyway
          console.warn('Payment succeeded but booking callback had issues:', bookingError);
          // Still call onSuccess path - payment is complete
        }
        // Don't throw - payment completed successfully
        return;
      } else {
        throw new Error('Payment failed');
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Payment failed. Please try again.';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      // Always reset processing state so form is usable again
      setIsProcessing(false);
    }
  };

  // Show loading state while fetching authoritative deposit amount
  if (isLoadingIntent) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <p className="text-sm text-center text-muted-foreground">
          Calculating secure deposit amount...
        </p>
      </div>
    );
  }

  // Show error if payment intent creation failed
  if (error && !clientSecret) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // Only render payment form once we have server-calculated amount
  if (!serverCalculatedAmount) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load payment details. Please refresh the page.</AlertDescription>
      </Alert>
    );
  }

  // Show success message after payment (brief display before redirect)
  if (confirmationEmail) {
    return (
      <div className="space-y-4 py-8">
        <div className="flex flex-col items-center justify-center gap-4">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div className="text-center">
            <h3 className="text-lg font-semibold text-white">Payment Successful!</h3>
            <p className="text-sm text-gray-400 mt-1">
              Confirmation sent to <span className="text-white font-medium">{confirmationEmail}</span>
            </p>
          </div>
        </div>
        <p className="text-xs text-center text-gray-400">
          Redirecting to your booking confirmation...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Configuration Warning */}
      {!isStripeConfigured && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Payment system is not configured (missing public key). You cannot make a payment at this time.
          </AlertDescription>
        </Alert>
      )}

      {/* Email Input Field */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-white flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Email for confirmation
        </label>
        <Input
          type="email"
          value={email}
          onChange={handleEmailChange}
          onBlur={handleEmailBlur}
          placeholder="your@email.com"
          className={`bg-gray-800/80 border-gray-600 text-white placeholder:text-gray-400 focus:border-[#e8b323] focus:ring-1 focus:ring-[#e8b323] ${
            emailError && emailTouched ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''
          }`}
          data-testid="input-email"
        />
        {emailError && emailTouched && (
          <p className="text-xs text-red-400">{emailError}</p>
        )}
        <p className="text-xs text-gray-400">We'll send your booking confirmation and receipt here</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-white">Card Details</label>
        <div className="border border-gray-600 rounded-lg p-4 bg-gray-800/80 backdrop-blur transition-all focus-within:border-[#e8b323] focus-within:ring-1 focus-within:ring-[#e8b323]">
          <CardElement
            options={{
              hidePostalCode: false,
              style: {
                base: {
                  fontSize: '16px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  color: '#ffffff',
                  backgroundColor: 'transparent',
                  iconColor: '#e8b323',
                  '::placeholder': {
                    color: '#9ca3af',
                  },
                  ':focus': {
                    color: '#ffffff',
                  },
                },
                invalid: {
                  color: '#f87171',
                  iconColor: '#f87171',
                },
                complete: {
                  color: '#4ade80',
                  iconColor: '#4ade80',
                },
              },
            }}
          />
        </div>
        <p className="text-xs text-gray-400">Secure payment powered by Stripe</p>
      </div>

      {error && (
        <Alert variant="destructive" className="bg-red-900/30 border-red-600 text-red-200">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        disabled={!stripe || isProcessing || isLoadingIntent || !!error || !clientSecret || !isStripeConfigured || !isEmailValid}
        className="w-full bg-[#e8b323] hover:bg-[#d1a01f] text-gray-900 font-bold text-lg py-6 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        size="lg"
        data-testid="button-submit-payment"
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing Payment...
          </>
        ) : isLoadingIntent ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading...
          </>
        ) : (
          `Pay £${Math.round(serverCalculatedAmount / 100)} Deposit`
        )}
      </Button>

      {depositBreakdown && (
        <div className="bg-gray-700/50 rounded-lg p-4 text-sm space-y-2 border border-gray-600">
          <div className="font-medium text-white mb-2">Deposit breakdown:</div>
          <div className="flex justify-between">
            <span className="text-gray-400">Materials (100% upfront):</span>
            <span className="font-medium text-white">£{Math.round(depositBreakdown.totalMaterialsCost / 100)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Labour booking fee (30%):</span>
            <span className="font-medium text-white">£{Math.round(depositBreakdown.labourDepositComponent / 100)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-600">
            <span className="font-semibold text-white">Total deposit:</span>
            <span className="font-semibold text-[#e8b323]">£{Math.round(serverCalculatedAmount / 100)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-center text-gray-400">
        Your payment is secured by Stripe. We'll charge £{Math.round(serverCalculatedAmount / 100)} to reserve your slot.
      </p>
    </form>
  );
}
