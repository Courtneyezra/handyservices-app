/**
 * Google Business Profile local-post client.
 *
 * Posts ("What's New" updates) still live on the legacy My Business v4 API —
 * the newer Business Information / Performance APIs never got a posts
 * endpoint. Auth is the same GOOGLE_GBP_* OAuth credential set the metrics
 * pull uses (see server/seo-gmb-connector.ts): a plain API key does NOT work
 * here, localPosts requires the business.manage OAuth scope.
 */
import { readGbpEnv, getGbpAccessToken, type LocationConfig } from '../seo-gmb-connector';

const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';

export type GbpTopicType = 'STANDARD' | 'EVENT' | 'OFFER';
export type GbpCtaType = 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'SHOP' | 'SIGN_UP' | 'CALL';

export interface LocalPostInput {
    summary: string;                 // ≤1500 chars, Google truncates display ~higher up
    topicType?: GbpTopicType;
    cta?: { actionType: GbpCtaType; url?: string };  // CALL needs no url
    mediaSourceUrl?: string;         // publicly fetchable photo URL
    languageCode?: string;
}

export interface LocalPostResult {
    name: string;                    // accounts/{a}/locations/{l}/localPosts/{p}
    state?: string;                  // LIVE | PROCESSING | REJECTED
    searchUrl?: string;
}

/** Locations configured via GOOGLE_GBP_LOCATIONS, or [] when GBP is unset. */
export function configuredLocations(): LocationConfig[] {
    return readGbpEnv()?.locations ?? [];
}

/** Create a local post on one configured location. Throws on any API error. */
export async function createLocalPost(
    locationKey: string,
    post: LocalPostInput,
): Promise<LocalPostResult> {
    const env = readGbpEnv();
    if (!env) throw new Error('GBP not configured — set GOOGLE_GBP_* env vars');

    const loc = env.locations.find((l) => l.key === locationKey);
    if (!loc) throw new Error(`No GBP location configured for key "${locationKey}"`);

    const accessToken = await getGbpAccessToken(env);

    const body: Record<string, unknown> = {
        languageCode: post.languageCode ?? 'en-GB',
        summary: post.summary,
        topicType: post.topicType ?? 'STANDARD',
    };
    if (post.cta) {
        body.callToAction = post.cta.actionType === 'CALL'
            ? { actionType: 'CALL' }
            : { actionType: post.cta.actionType, url: post.cta.url };
    }
    if (post.mediaSourceUrl) {
        body.media = [{ mediaFormat: 'PHOTO', sourceUrl: post.mediaSourceUrl }];
    }

    const res = await fetch(`${MYBUSINESS_BASE}/${loc.resourceName}/localPosts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`localPosts create failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as { name?: string; state?: string; searchUrl?: string };
    if (!json.name) throw new Error('localPosts create returned no resource name');
    return { name: json.name, state: json.state, searchUrl: json.searchUrl };
}
