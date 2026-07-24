
import posthog from 'posthog-js';

// Public marketing/landing routes where LCP matters most and there's no funnel
// worth full session replay yet. On these we skip the expensive session
// recording + heatmap machinery (both add main-thread work and network at
// startup). Quote/checkout/admin routes keep the full instrumentation.
const isLandingRoute = () => {
    const p = typeof window !== 'undefined' ? window.location.pathname : '';
    return p === '/' || p === '/v2' || p.startsWith('/v2/') || p === '/derby' || p === '/landing';
};

export const initPostHog = () => {
    if (!import.meta.env.VITE_POSTHOG_API_KEY) {
        console.warn("PostHog not initialized: Missing API Key");
        return;
    }

    // Init stays synchronous so the manual capturePageView() that landing pages
    // fire on mount is never dropped (posthog-js discards events sent before
    // init). We instead cut the heavy *runtime* machinery on landing routes:
    // session recording (rrweb) and heatmaps are the biggest startup cost, and
    // there's no replay-worth funnel on a marketing page.
    const landing = isLandingRoute();

    posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: false, // We manually capture pageviews for better control

        // --- Heatmaps --- (off on landing to save startup cost)
        enable_heatmaps: !landing,

        // --- Session Recording ---
        // Records mouse movement, clicks, scrolls, DOM changes. The rrweb
        // recorder is the heaviest startup cost, so it's disabled on landing
        // routes and kept on funnel (quote/checkout) pages.
        disable_session_recording: landing,
        session_recording: {
            // Mask all text inputs by default (GDPR safe)
            maskAllInputs: true,
        },

        // --- Autocapture ---
        // Automatically tracks clicks, form submissions, page leaves
        // Powers click heatmaps + rage click detection
        autocapture: true,
        capture_pageleave: true,

        // --- Scroll depth ---
        // Automatically captures $pageview scroll depth events
        capture_dead_clicks: !landing,
    });
};

/**
 * Manually capture a $pageview. Required for heatmaps and scroll depth
 * tracking since we disabled automatic pageview capture.
 */
export const capturePageView = (properties?: Record<string, any>) => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.capture('$pageview', properties);
    }
};

export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.capture(eventName, properties);
    }
    // Also log to console in dev
    if (import.meta.env.DEV) {
        console.log(`[PostHog] ${eventName}`, properties);
    }
};

/**
 * Register sticky properties (variant, city, etc.) so every subsequent
 * `capture` on this page automatically carries them. Used by the /landing,
 * /derby, /v2 and /v2/derby pages so dashboards can compare funnels apples-
 * to-apples without each event having to repeat the same tags.
 */
export const registerSuperProperties = (properties: Record<string, any>) => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.register(properties);
    }
    if (import.meta.env.DEV) {
        console.log(`[PostHog] register`, properties);
    }
};

export const getFeatureFlag = (key: string) => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        return posthog.getFeatureFlag(key);
    }
    return null;
};

/**
 * Identify a user by phone number (or other unique ID) and attach person properties.
 * Call this when a quote loads so all subsequent events tie to a customer profile.
 */
export const identifyUser = (distinctId: string, properties?: Record<string, any>) => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.identify(distinctId, properties);
    }
    if (import.meta.env.DEV) {
        console.log(`[PostHog] identify: ${distinctId}`, properties);
    }
};
