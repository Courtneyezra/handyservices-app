
import posthog from 'posthog-js';

export const initPostHog = () => {
    if (import.meta.env.VITE_POSTHOG_API_KEY) {
        posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
            api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
            person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
            capture_pageview: false, // We will manually capture pageviews for better control
        });
    } else {
        console.warn("PostHog not initialized: Missing API Key");
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
}
