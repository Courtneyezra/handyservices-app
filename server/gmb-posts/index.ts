/**
 * Automated GMB posting — the cycle the cron runs.
 *
 * One cycle = for each configured GBP location: pick the least-recently-used
 * theme (and detail within it), write the post in the brand voice, publish it
 * via the v4 localPosts API, and log the whole thing to gmb_posts. Failures
 * are logged rows, not crashes — the next scheduled run just tries again.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { gmbPosts } from '@shared/schema';
import { THEMES, serviceImage, type PostTheme } from './themes';
import { generatePostBody } from './generator';
import { createLocalPost, configuredLocations } from './gbp-client';

const HISTORY_WINDOW = 40;

interface ThemePick {
    theme: PostTheme;
    detail?: string;
}

/** Least-recently-used theme for this location; within it, the LRU detail. */
export async function pickTheme(location: string): Promise<ThemePick> {
    const recent = await db
        .select({ theme: gmbPosts.theme, themeDetail: gmbPosts.themeDetail })
        .from(gmbPosts)
        .where(eq(gmbPosts.location, location))
        .orderBy(desc(gmbPosts.createdAt))
        .limit(HISTORY_WINDOW);

    const lastSeenTheme = new Map<string, number>();   // theme -> recency index (0 = newest)
    const lastSeenDetail = new Map<string, number>();
    recent.forEach((row, i) => {
        if (!lastSeenTheme.has(row.theme)) lastSeenTheme.set(row.theme, i);
        if (row.themeDetail) {
            const key = `${row.theme}::${row.themeDetail}`;
            if (!lastSeenDetail.has(key)) lastSeenDetail.set(key, i);
        }
    });

    // Never-used themes first, then the one used longest ago.
    const theme = [...THEMES].sort((a, b) => {
        const ra = lastSeenTheme.has(a.key) ? lastSeenTheme.get(a.key)! : Infinity;
        const rb = lastSeenTheme.has(b.key) ? lastSeenTheme.get(b.key)! : Infinity;
        return rb - ra;
    })[0];

    let detail: string | undefined;
    if (theme.details?.length) {
        detail = [...theme.details].sort((a, b) => {
            const ra = lastSeenDetail.has(`${theme.key}::${a}`) ? lastSeenDetail.get(`${theme.key}::${a}`)! : Infinity;
            const rb = lastSeenDetail.has(`${theme.key}::${b}`) ? lastSeenDetail.get(`${theme.key}::${b}`)! : Infinity;
            return rb - ra;
        })[0];
    }

    return { theme, detail };
}

function mediaFor(theme: PostTheme, detail?: string): string | undefined {
    if (theme.key === 'service_spotlight' && detail) return serviceImage(detail);
    return theme.images?.[0];
}

export interface CycleResult {
    location: string;
    status: 'posted' | 'failed';
    theme: string;
    summary?: string;
    error?: string;
}

export async function runGmbPostCycle(trigger: 'cron' | 'manual'): Promise<CycleResult[]> {
    const locations = configuredLocations();
    if (locations.length === 0) {
        console.warn('[gmb-posts] no GBP locations configured — nothing to post.');
        return [];
    }

    const results: CycleResult[] = [];
    for (const loc of locations) {
        const { theme, detail } = await pickTheme(loc.key);
        console.log(`[gmb-posts] (${trigger}) ${loc.key}: theme=${theme.key}${detail ? ` detail="${detail}"` : ''}`);

        let summary: string, model: string;
        try {
            ({ summary, model } = await generatePostBody(theme, detail));
        } catch (err: any) {
            console.error(`[gmb-posts] generation failed for ${loc.key}: ${err.message}`);
            results.push({ location: loc.key, status: 'failed', theme: theme.key, error: `generation: ${err.message}` });
            continue;
        }

        const mediaUrl = mediaFor(theme, detail);
        const [row] = await db.insert(gmbPosts).values({
            location: loc.key,
            topicType: 'STANDARD',
            theme: theme.key,
            themeDetail: detail ?? null,
            summary,
            ctaType: theme.ctaType,
            ctaUrl: theme.ctaUrl ?? null,
            mediaUrl: mediaUrl ?? null,
            status: 'draft',
            model,
        }).returning({ id: gmbPosts.id });

        try {
            let result;
            try {
                result = await createLocalPost(loc.key, {
                    summary,
                    cta: { actionType: theme.ctaType, url: theme.ctaUrl },
                    mediaSourceUrl: mediaUrl,
                });
            } catch (err: any) {
                // Media is the flaky part (format/fetch rejections) — a text
                // post on schedule beats a perfect post that never went out.
                if (!mediaUrl) throw err;
                console.warn(`[gmb-posts] ${loc.key}: retrying without media — ${err.message}`);
                result = await createLocalPost(loc.key, {
                    summary,
                    cta: { actionType: theme.ctaType, url: theme.ctaUrl },
                });
                await db.update(gmbPosts).set({ mediaUrl: null }).where(eq(gmbPosts.id, row.id));
            }
            await db.update(gmbPosts).set({
                status: 'posted',
                googleName: result.name,
                searchUrl: result.searchUrl ?? null,
                postedAt: new Date(),
            }).where(eq(gmbPosts.id, row.id));
            console.log(`[gmb-posts] ${loc.key}: posted (${result.name})`);
            results.push({ location: loc.key, status: 'posted', theme: theme.key, summary });
        } catch (err: any) {
            await db.update(gmbPosts).set({ status: 'failed', error: err.message }).where(eq(gmbPosts.id, row.id));
            console.error(`[gmb-posts] ${loc.key}: post failed — ${err.message}`);
            results.push({ location: loc.key, status: 'failed', theme: theme.key, summary, error: err.message });
        }
    }
    return results;
}
