/**
 * GMB post copywriter — turns a theme brief into an on-brand post body.
 *
 * The brand voice is NOT in this file. It lives in brand-voice/*.md at the
 * repo root (beliefs, tone, vocabulary, humour), human-editable, loaded fresh
 * on every generation so edits take effect without a deploy. This file only
 * supplies the mechanical constraints of the GBP post format.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { claudeText } from '../llm';
import type { PostTheme } from './themes';

// Opus, not the haiku default: three posts a week is nothing in cost, and
// voice fidelity is the entire point of this system.
const POST_MODEL = 'claude-opus-5';

const VOICE_DIR = join(process.cwd(), 'brand-voice');
const VOICE_FILES = ['beliefs.md', 'tone.md', 'vocabulary.md', 'humour.md'] as const;

export function loadVoiceFiles(): string {
    const parts: string[] = [];
    for (const file of VOICE_FILES) {
        try {
            parts.push(readFileSync(join(VOICE_DIR, file), 'utf-8').trim());
        } catch {
            // Missing file = that dimension just isn't specified yet.
        }
    }
    if (parts.length === 0) {
        throw new Error(`No brand voice files found in ${VOICE_DIR} — the generator refuses to guess the voice.`);
    }
    return parts.join('\n\n---\n\n');
}

export interface GeneratedPost {
    summary: string;
    model: string;
}

export async function generatePostBody(
    theme: PostTheme,
    detail: string | undefined,
    opts?: { city?: string },
): Promise<GeneratedPost> {
    const voice = loadVoiceFiles();
    const city = opts?.city ?? 'Nottingham';
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const system = [
        'You write Google Business Profile posts for Handy Services, a handyman business. You ARE this brand — the voice guide below is who you are, not a reference you consult.',
        '',
        voice,
        '',
        '--- FORMAT RULES (Google Business Profile post) ---',
        '- 40 to 120 words. One post, plain text only: no markdown, no headings, no bullet lists.',
        '- No hashtags. No links in the body (the post has a separate button). No phone numbers.',
        '- Never invent specific jobs, customers, reviews or numbers that are not in the voice files.',
        '- Do not mention Google, posting, or that this is a post.',
        'Reply with ONLY the post body.',
    ].join('\n');

    const user = [
        `City: ${city}. Today: ${today}.`,
        `Post angle: ${theme.brief}`,
        detail ? `This post's specific subject: ${detail}` : '',
    ].filter(Boolean).join('\n');

    const summary = (await claudeText({ system, user, model: POST_MODEL, maxTokens: 400 })).trim();
    if (summary.length < 30) throw new Error(`Generated post suspiciously short: "${summary}"`);
    if (summary.length > 1450) throw new Error(`Generated post exceeds GBP limit (${summary.length} chars)`);
    return { summary, model: POST_MODEL };
}
