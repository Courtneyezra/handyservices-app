/**
 * URL Utilities
 *
 * Properly derives base URLs from requests instead of hardcoding.
 */

import { Request } from 'express';

// Production domain - single source of truth
const PRODUCTION_DOMAIN = 'https://handyservices.app';

/**
 * Get the base URL from a request.
 *
 * Priority:
 * 1. X-Forwarded-Proto + X-Forwarded-Host (behind proxy/load balancer)
 * 2. Origin header (from browser requests)
 * 3. Host header with protocol detection
 * 4. BASE_URL env var
 * 5. Production fallback
 */
export function getBaseUrl(req: Request): string {
    // 1. Check env var first (explicitly set = highest priority in production)
    if (process.env.BASE_URL) {
        return process.env.BASE_URL.replace(/\/$/, ''); // Remove trailing slash
    }

    // 2. X-Forwarded headers (behind reverse proxy like Cloudflare, nginx, etc.)
    const forwardedProto = req.headers['x-forwarded-proto'] as string;
    const forwardedHost = req.headers['x-forwarded-host'] as string;
    if (forwardedProto && forwardedHost) {
        return `${forwardedProto}://${forwardedHost}`;
    }

    // 3. Origin header (from browser CORS requests)
    const origin = req.headers.origin as string;
    if (origin) {
        return origin;
    }

    // 4. Host header with protocol detection
    const host = req.headers.host;
    if (host) {
        // Detect protocol from request or common patterns
        const isSecure = req.secure ||
            req.headers['x-forwarded-proto'] === 'https' ||
            host.includes('handyservices.app') ||
            host.includes('replit.app') ||
            host.includes('railway.app') ||
            host.includes('vercel.app') ||
            host.includes('render.com');

        const protocol = isSecure ? 'https' : 'http';
        return `${protocol}://${host}`;
    }

    // 5. Production fallback
    return PRODUCTION_DOMAIN;
}

/**
 * Get the base URL without a request context (for emails, background jobs, etc.)
 * Uses BASE_URL env var if set, otherwise falls back to production domain.
 */
export function getBaseUrlFromEnv(): string {
    if (process.env.BASE_URL) {
        return process.env.BASE_URL.replace(/\/$/, '');
    }
    return PRODUCTION_DOMAIN;
}

/**
 * Build a quote URL from a short slug (long form: /quote/...)
 */
export function getQuoteUrl(req: Request, shortSlug: string): string {
    return `${getBaseUrl(req)}/quote/${shortSlug}`;
}

/**
 * Build a short quote URL from a short slug (short form: /q/...)
 */
export function getShortQuoteUrl(req: Request, shortSlug: string): string {
    return `${getBaseUrl(req)}/q/${shortSlug}`;
}

/**
 * Build a book visit URL
 */
export function getBookVisitUrl(req: Request, leadId: string): string {
    return `${getBaseUrl(req)}/book-visit?lead=${leadId}`;
}

/**
 * Build a video upload URL from a token
 */
export function getVideoUploadUrl(req: Request, token: string): string {
    return `${getBaseUrl(req)}/upload-video/${token}`;
}

/**
 * Build a booking confirmation URL
 */
export function getBookingConfirmedUrl(req: Request, bookingId: string): string {
    return `${getBaseUrl(req)}/booking-confirmed/${bookingId}`;
}

/**
 * Build a visit cancelled URL
 */
export function getVisitCancelledUrl(req: Request, bookingId: string): string {
    return `${getBaseUrl(req)}/visit-cancelled/${bookingId}`;
}
