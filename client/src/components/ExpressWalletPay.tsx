import { useEffect } from 'react';
import { Elements, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js';
import { getStripe, isStripeConfigured } from '@/lib/stripe';

/**
 * Apple Pay / Google Pay express-checkout buttons — the SAME mechanism the
 * contextual quote page uses (see UnifiedQuoteCard's InlineExpressPay).
 *
 * Stripe's ExpressCheckoutElement only renders the wallet sheet when its
 * <Elements> provider is created in deferred mode (`mode:'payment'` + amount +
 * currency), so it gets its OWN provider here — kept separate from any card
 * <Elements> so the two never conflict. The PaymentIntent is created lazily on
 * confirm (after elements.submit()), so no email/step is needed up front — the
 * wallet supplies the email.
 */
interface ExpressWalletPayProps {
    /** Amount in pence, for the wallet sheet display. The server re-derives the real charge. */
    amountPence: number;
    customerEmail?: string;
    /**
     * Create the PaymentIntent server-side and return its clientSecret. Called
     * after elements.submit() succeeds, with the wallet-provided email.
     */
    createIntent: (walletEmail: string) => Promise<{ clientSecret: string; paymentIntentId?: string }>;
    returnUrl: string;
    onSuccess: (paymentIntentId: string) => void | Promise<void>;
    onError?: (message: string) => void;
    /** Reports whether any wallet is actually available on this device/browser. */
    onAvailability?: (available: boolean) => void;
}

export function ExpressWalletPay(props: ExpressWalletPayProps) {
    const stripe = getStripe();
    if (!isStripeConfigured || !stripe) return null;
    return (
        <Elements stripe={stripe} options={{ mode: 'payment', amount: Math.max(props.amountPence, 30), currency: 'gbp' }}>
            <ExpressWalletInner {...props} />
        </Elements>
    );
}

function ExpressWalletInner({ amountPence, customerEmail, createIntent, returnUrl, onSuccess, onError, onAvailability }: ExpressWalletPayProps) {
    const stripe = useStripe();
    const elements = useElements();

    // Keep the wallet sheet's amount in sync with the selected fee/lane.
    useEffect(() => {
        if (!elements) return;
        try { elements.update({ amount: Math.max(amountPence, 30) }); }
        catch { /* provider still settling — mount amount stands until next sync */ }
    }, [elements, amountPence]);

    const handleConfirm = async (event: StripeExpressCheckoutElementConfirmEvent) => {
        if (!stripe || !elements) return;
        try {
            const { error: submitError } = await elements.submit();
            if (submitError) throw new Error(submitError.message);

            const walletEmail = (event as any)?.billingDetails?.email || customerEmail || '';
            const { clientSecret, paymentIntentId } = await createIntent(walletEmail);
            if (!clientSecret) throw new Error('Could not start payment');

            const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
                elements,
                clientSecret,
                confirmParams: { return_url: returnUrl },
                redirect: 'if_required',
            });
            if (stripeError) throw new Error(stripeError.message);

            if (paymentIntent?.status === 'succeeded') {
                await onSuccess(paymentIntentId || paymentIntent.id);
            } else {
                throw new Error('Payment not completed');
            }
        } catch (e: any) {
            onError?.(e?.message || 'Payment failed. Please try again.');
        }
    };

    return (
        <ExpressCheckoutElement
            onConfirm={handleConfirm}
            onReady={(e: any) => {
                const m = e?.availablePaymentMethods;
                onAvailability?.(!!m && Object.values(m).some(Boolean));
            }}
            onLoadError={() => onAvailability?.(false)}
            options={{
                emailRequired: !customerEmail,
                phoneNumberRequired: false,
                billingAddressRequired: false,
                shippingAddressRequired: false,
                paymentMethods: {
                    applePay: 'auto',
                    googlePay: 'auto',
                    link: 'never',
                    amazonPay: 'never',
                    paypal: 'never',
                    klarna: 'never',
                },
            }}
        />
    );
}
