/**
 * Preview the automated GMB posting voice — generates one sample post per
 * theme and prints them. NO Google calls, NO database writes: pure dry run.
 *
 *   npx tsx scripts/_gmb-post-preview.ts             # all themes
 *   npx tsx scripts/_gmb-post-preview.ts seasonal_tip # one theme
 */
import 'dotenv/config';
import { THEMES } from '../server/gmb-posts/themes';
import { generatePostBody } from '../server/gmb-posts/generator';

async function main() {
    const only = process.argv[2];
    const themes = only ? THEMES.filter((t) => t.key === only) : THEMES;
    if (themes.length === 0) {
        console.error(`Unknown theme "${only}". Themes: ${THEMES.map((t) => t.key).join(', ')}`);
        process.exit(1);
    }

    for (const theme of themes) {
        // Preview the first detail; the live cycle rotates through them.
        const detail = theme.details?.[0];
        const { summary } = await generatePostBody(theme, detail);
        console.log('─'.repeat(72));
        console.log(`THEME: ${theme.key}${detail ? `  ·  ${detail}` : ''}  ·  CTA: ${theme.ctaType}`);
        console.log('─'.repeat(72));
        console.log(summary);
        console.log(`(${summary.length} chars)\n`);
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
