import { loadStripe } from '@stripe/stripe-js';

// Get the Stripe publishable key from environment variables
// Use test key in development, live key in production
const rawStripeKey = import.meta.env.DEV
    ? import.meta.env.VITE_STRIPE_TEST_PUBLIC_KEY
    : import.meta.env.VITE_STRIPE_PUBLIC_KEY;

// Debug: log raw key format (masked)
console.log('[Stripe] Raw key from env:', rawStripeKey ? `${rawStripeKey.substring(0, 10)}...${rawStripeKey.substring(rawStripeKey.length - 5)}` : 'undefined');
console.log('[Stripe] Raw key length:', rawStripeKey?.length);

// Strip any surrounding quotes that may have been included in the .env file
const stripePublishableKey = rawStripeKey?.replace(/^["']|["']$/g, '').trim();

// Debug: log processed key format (masked)
console.log('[Stripe] Processed key:', stripePublishableKey ? `${stripePublishableKey.substring(0, 10)}...${stripePublishableKey.substring(stripePublishableKey.length - 5)}` : 'undefined');
console.log('[Stripe] Processed key length:', stripePublishableKey?.length);

if (!stripePublishableKey) {
    console.warn('[Stripe] Publishable key not found. Payment functionality will be disabled.');
} else if (!stripePublishableKey.startsWith('pk_')) {
    console.error('[Stripe] Invalid key format. Key should start with pk_live_ or pk_test_');
    console.error('[Stripe] First 20 chars:', stripePublishableKey.substring(0, 20));
}

// Initialize Stripe with the publishable key
export const stripePromise = stripePublishableKey && stripePublishableKey.startsWith('pk_')
    ? loadStripe(stripePublishableKey)
    : null;

console.log('[Stripe] stripePromise initialized:', stripePromise !== null);
