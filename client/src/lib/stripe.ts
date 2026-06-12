import { loadStripe, type Stripe } from '@stripe/stripe-js';

// Get the Stripe publishable key from environment variables.
// Use test key in development, live key in production.
const rawStripeKey = import.meta.env.DEV
    ? (import.meta.env.VITE_STRIPE_TEST_PUBLIC_KEY || import.meta.env.VITE_STRIPE_PUBLIC_KEY)
    : (import.meta.env.VITE_STRIPE_PUBLIC_KEY || import.meta.env.VITE_STRIPE_TEST_PUBLIC_KEY);

// Strip any surrounding quotes that may have been included in the .env file.
const stripePublishableKey = rawStripeKey?.replace(/^["']|["']$/g, '').trim();

export const isStripeConfigured = !!(stripePublishableKey && stripePublishableKey.startsWith('pk_'));

if (!isStripeConfigured) {
    if (!stripePublishableKey) {
        console.warn('[Stripe] Publishable key not found. Payment functionality will be disabled.');
        console.warn('[Stripe] Please check your .env file for VITE_STRIPE_PUBLIC_KEY or VITE_STRIPE_TEST_PUBLIC_KEY.');
    } else {
        console.error('[Stripe] Invalid key format. Key should start with pk_live_ or pk_test_');
    }
}

// loadStripe() injects the Stripe.js script and starts network work the instant
// it runs. Calling it at module-eval put that fetch on the quote page's initial
// critical path (competing with hero image + fonts during the skeleton gate).
// Instead, load lazily on first <Elements> render and memoize so every call site
// shares one stable promise.
let stripeInstance: Promise<Stripe | null> | null = null;
export function getStripe(): Promise<Stripe | null> | null {
    if (!isStripeConfigured) return null;
    if (!stripeInstance) {
        stripeInstance = loadStripe(stripePublishableKey as string);
    }
    return stripeInstance;
}
