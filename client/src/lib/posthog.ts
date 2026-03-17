
import posthog from 'posthog-js';

export const initPostHog = () => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
            api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
            person_profiles: 'identified_only',
            capture_pageview: false, // We manually capture pageviews for better control

            // --- Heatmaps ---
            enable_heatmaps: true,

            // --- Session Recording ---
            // Records mouse movement, clicks, scrolls, DOM changes
            // Gives you full session replays in PostHog
            disable_session_recording: false,
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
            capture_dead_clicks: true,
        });
    } else {
        console.warn("PostHog not initialized: Missing API Key");
    }
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
