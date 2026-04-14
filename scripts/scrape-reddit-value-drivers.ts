x**
 * Reddit Value Driver Research via Apify
 *
 * Scrapes UK subreddits for real customer sentiment on:
 * - What people value in handyman/tradesman services
 * - What they complain about (negative experiences = our positive differentiators)
 * - What they'd pay extra for
 * - Price expectations and reactions
 *
 * Uses Apify's Reddit Scraper actor (trudax/reddit-scraper)
 *
 * Usage: APIFY_API_TOKEN=your_token npx tsx scripts/scrape-reddit-value-drivers.ts
 */

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_API_TOKEN. Run with: APIFY_API_TOKEN=your_token npx tsx scripts/scrape-reddit-value-drivers.ts');
  process.exit(1);
}

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'trudax~reddit-scraper'; // trudax Reddit Scraper

// ============================================================================
// SEARCH QUERIES — designed to surface value driver data
// ============================================================================

interface SearchQuery {
  query: string;
  /** Which EVE value driver this maps to */
  valueDriver: string;
  /** Which segments this is relevant to */
  segments: string[];
  /** Which Hinterhuber dimension */
  dimension: string;
}

const SEARCH_QUERIES: SearchQuery[] = [
  // COST / FUNCTIONAL drivers
  {
    query: 'handyman quote price UK',
    valueDriver: 'reference_price',
    segments: ['ALL'],
    dimension: 'functional_economic',
  },
  {
    query: 'handyman expensive worth it UK',
    valueDriver: 'price_premium_justification',
    segments: ['ALL'],
    dimension: 'functional_economic',
  },
  {
    query: 'handyman no show ghosted UK',
    valueDriver: 'risk_avoidance',
    segments: ['ALL'],
    dimension: 'psychological',
  },
  {
    query: 'handyman bodge job UK rework',
    valueDriver: 'risk_avoidance_quality',
    segments: ['ALL'],
    dimension: 'functional_economic',
  },
  // LANDLORD / PROP_MGR specific
  {
    query: 'landlord handyman reliable tenant UK',
    valueDriver: 'tenant_coordination',
    segments: ['LANDLORD', 'PROP_MGR'],
    dimension: 'operational',
  },
  {
    query: 'landlord tradesman photos proof work',
    valueDriver: 'photo_proof',
    segments: ['LANDLORD', 'PROP_MGR'],
    dimension: 'psychological',
  },
  {
    query: 'property manager maintenance handyman UK',
    valueDriver: 'sla_response_time',
    segments: ['PROP_MGR'],
    dimension: 'functional_economic',
  },
  {
    query: 'rental property repairs invoice landlord',
    valueDriver: 'tax_invoice',
    segments: ['LANDLORD'],
    dimension: 'functional_economic',
  },
  // BUSY_PRO specific
  {
    query: 'handyman while at work key safe UK',
    valueDriver: 'hands_off_access',
    segments: ['BUSY_PRO'],
    dimension: 'operational',
  },
  {
    query: 'tradesman guarantee warranty UK',
    valueDriver: 'guarantee',
    segments: ['BUSY_PRO', 'DIY_DEFERRER'],
    dimension: 'psychological',
  },
  // SMALL_BIZ specific
  {
    query: 'shop office repairs after hours weekend UK',
    valueDriver: 'after_hours',
    segments: ['SMALL_BIZ'],
    dimension: 'functional_economic',
  },
  {
    query: 'business premises handyman disruption UK',
    valueDriver: 'zero_disruption',
    segments: ['SMALL_BIZ'],
    dimension: 'functional_economic',
  },
  // DIY_DEFERRER specific
  {
    query: 'handyman list of jobs batch UK',
    valueDriver: 'batch_efficiency',
    segments: ['DIY_DEFERRER'],
    dimension: 'functional_economic',
  },
  {
    query: 'putting off DIY finally getting done handyman',
    valueDriver: 'guilt_relief',
    segments: ['DIY_DEFERRER'],
    dimension: 'emotional',
  },
  // TRUST / PSYCHOLOGICAL
  {
    query: 'trustworthy handyman vetted insured UK',
    valueDriver: 'trust_vetting',
    segments: ['ALL'],
    dimension: 'psychological',
  },
  {
    query: 'checkatrade vs facebook handyman UK',
    valueDriver: 'platform_comparison',
    segments: ['ALL'],
    dimension: 'psychological',
  },
];

// Target subreddits
const SUBREDDITS = [
  'AskUK',
  'HousingUK',
  'UKPersonalFinance',
  'LegalAdviceUK',
  'nottingham',
  'Landlords',
  'UKProperty',
];

// ============================================================================
// APIFY API FUNCTIONS
// ============================================================================

async function runActor(input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to start actor: ${res.status} ${err}`);
  }

  const data = await res.json() as { data: { id: string } };
  return data.data.id;
}

async function waitForRun(runId: string, maxWaitMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await res.json() as { data: { status: string } };

    if (data.data.status === 'SUCCEEDED') return;
    if (data.data.status === 'FAILED' || data.data.status === 'ABORTED') {
      throw new Error(`Actor run ${runId} ended with status: ${data.data.status}`);
    }

    console.log(`  Waiting... (status: ${data.data.status})`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timeout waiting for run ${runId}`);
}

async function getDataset(runId: string): Promise<unknown[]> {
  const res = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&format=json&limit=50`
  );
  if (!res.ok) throw new Error(`Failed to get dataset: ${res.status}`);
  return res.json() as Promise<unknown[]>;
}

// ============================================================================
// MAIN SCRAPING FLOW
// ============================================================================

interface RedditPost {
  title?: string;
  body?: string;
  url?: string;
  numberOfComments?: number;
  score?: number;
  subreddit?: string;
  createdAt?: string;
  comments?: Array<{ body?: string; score?: number }>;
}

interface ScrapedResult {
  query: SearchQuery;
  posts: RedditPost[];
}

async function scrapeQuery(searchQuery: SearchQuery): Promise<ScrapedResult> {
  console.log(`\nScraping: "${searchQuery.query}" [${searchQuery.valueDriver}]`);

  const input = {
    type: 'search',
    searches: [searchQuery.query],
    maxItems: 20,
    maxComments: 10,
    sort: 'relevance',
    time: 'year', // Last year of posts
    proxy: {
      useApifyProxy: true,
    },
  };

  try {
    const runId = await runActor(input);
    console.log(`  Run started: ${runId}`);

    await waitForRun(runId);
    const items = await getDataset(runId) as RedditPost[];

    // Filter to UK subreddits where possible
    const ukPosts = items.filter(post => {
      const sub = (post.subreddit || '').toLowerCase();
      const isUkSub = SUBREDDITS.some(s => s.toLowerCase() === sub) ||
                       sub.includes('uk') || sub.includes('brit') || sub.includes('nottingham');
      // Also keep posts that mention UK/£ in title or body
      const mentionsUk = /\b(uk|£|pound|london|manchester|nottingham|birmingham|bristol|leeds|scotland|england|wales)\b/i
        .test((post.title || '') + ' ' + (post.body || ''));
      return isUkSub || mentionsUk;
    });

    console.log(`  Got ${items.length} posts, ${ukPosts.length} UK-relevant`);
    return { query: searchQuery, posts: ukPosts };
  } catch (err) {
    console.error(`  Error scraping "${searchQuery.query}": ${err}`);
    return { query: searchQuery, posts: [] };
  }
}

// ============================================================================
// ANALYSIS — Extract value driver insights
// ============================================================================

interface ValueInsight {
  valueDriver: string;
  dimension: string;
  segments: string[];
  postCount: number;
  /** Key quotes that indicate value / willingness to pay */
  keyQuotes: string[];
  /** Sentiment: positive mentions of paying for quality/features */
  positiveSignals: number;
  /** Sentiment: complaints about cheap/bad alternatives */
  negativeAltSignals: number;
  /** Any specific £ amounts mentioned */
  pricesMentioned: string[];
}

function analyzeResults(results: ScrapedResult[]): ValueInsight[] {
  const insights: ValueInsight[] = [];

  for (const result of results) {
    const { query, posts } = result;

    const keyQuotes: string[] = [];
    let positiveSignals = 0;
    let negativeAltSignals = 0;
    const pricesMentioned: string[] = [];

    for (const post of posts) {
      const text = `${post.title || ''} ${post.body || ''}`.toLowerCase();

      // Look for price mentions
      const priceMatches = text.match(/£\d+[\d,.]*/g);
      if (priceMatches) {
        pricesMentioned.push(...priceMatches);
      }

      // Positive signals — people valuing quality/features
      if (/worth (it|the|every|paying)|pay (more|extra)|happy to pay|good value/i.test(text)) {
        positiveSignals++;
        const sentence = extractRelevantSentence(text, /worth|pay more|pay extra|good value/i);
        if (sentence) keyQuotes.push(sentence);
      }

      // Negative alternative signals — complaints about cheap options
      if (/no.?show|ghost|bodge|cowboy|terrible|nightmare|avoid|never again|rip.?off/i.test(text)) {
        negativeAltSignals++;
        const sentence = extractRelevantSentence(text, /no.?show|ghost|bodge|cowboy|nightmare/i);
        if (sentence) keyQuotes.push(sentence);
      }

      // Value-specific signals
      if (/guarantee|warranty|insured|insurance/i.test(text)) {
        const sentence = extractRelevantSentence(text, /guarantee|warranty|insured/i);
        if (sentence) keyQuotes.push(sentence);
      }

      if (/photo|pictures|evidence|proof/i.test(text)) {
        const sentence = extractRelevantSentence(text, /photo|picture|evidence|proof/i);
        if (sentence) keyQuotes.push(sentence);
      }

      // Also scan top comments
      if (post.comments) {
        for (const comment of post.comments.slice(0, 5)) {
          const cText = (comment.body || '').toLowerCase();
          const cPrices = cText.match(/£\d+[\d,.]*/g);
          if (cPrices) pricesMentioned.push(...cPrices);

          if (/worth|pay more|pay extra|good value/i.test(cText)) {
            positiveSignals++;
            const sentence = extractRelevantSentence(cText, /worth|pay more|pay extra|good value/i);
            if (sentence) keyQuotes.push(sentence);
          }
          if (/no.?show|ghost|bodge|cowboy|nightmare/i.test(cText)) {
            negativeAltSignals++;
          }
        }
      }
    }

    insights.push({
      valueDriver: query.valueDriver,
      dimension: query.dimension,
      segments: query.segments,
      postCount: posts.length,
      keyQuotes: [...new Set(keyQuotes)].slice(0, 5), // Dedupe, limit to 5
      positiveSignals,
      negativeAltSignals,
      pricesMentioned: [...new Set(pricesMentioned)].slice(0, 10),
    });
  }

  return insights;
}

function extractRelevantSentence(text: string, pattern: RegExp): string | null {
  // Find the sentence containing the pattern match
  const sentences = text.split(/[.!?\n]+/);
  for (const sentence of sentences) {
    if (pattern.test(sentence) && sentence.trim().length > 20 && sentence.trim().length < 300) {
      return sentence.trim();
    }
  }
  return null;
}

// ============================================================================
// OUTPUT — Save results for analysis
// ============================================================================

async function saveResults(insights: ValueInsight[]): Promise<void> {
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = `scripts/output/reddit-value-drivers-${timestamp}.json`;

  // Ensure output dir exists
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync('scripts/output', { recursive: true });

  writeFileSync(outputPath, JSON.stringify(insights, null, 2));
  console.log(`\nRaw data saved to: ${outputPath}`);

  // Generate summary report
  console.log('\n' + '='.repeat(70));
  console.log('VALUE DRIVER RESEARCH SUMMARY');
  console.log('='.repeat(70));

  for (const insight of insights) {
    if (insight.postCount === 0) continue;

    console.log(`\n--- ${insight.valueDriver} (${insight.dimension}) ---`);
    console.log(`  Segments: ${insight.segments.join(', ')}`);
    console.log(`  Posts found: ${insight.postCount}`);
    console.log(`  Positive value signals: ${insight.positiveSignals}`);
    console.log(`  Negative alternative signals: ${insight.negativeAltSignals}`);

    if (insight.pricesMentioned.length > 0) {
      console.log(`  Prices mentioned: ${insight.pricesMentioned.join(', ')}`);
    }

    if (insight.keyQuotes.length > 0) {
      console.log(`  Key quotes:`);
      for (const quote of insight.keyQuotes) {
        console.log(`    > "${quote.substring(0, 150)}${quote.length > 150 ? '...' : ''}"`);
      }
    }
  }

  // Summary stats
  const totalPosts = insights.reduce((s, i) => s + i.postCount, 0);
  const totalPositive = insights.reduce((s, i) => s + i.positiveSignals, 0);
  const totalNegativeAlt = insights.reduce((s, i) => s + i.negativeAltSignals, 0);
  const allPrices = insights.flatMap(i => i.pricesMentioned);

  console.log('\n' + '='.repeat(70));
  console.log('TOTALS');
  console.log(`  Total UK-relevant posts: ${totalPosts}`);
  console.log(`  "Worth paying more" signals: ${totalPositive}`);
  console.log(`  "Bad alternative" signals: ${totalNegativeAlt}`);
  console.log(`  Price points mentioned: ${allPrices.length} (${[...new Set(allPrices)].join(', ')})`);
  console.log('='.repeat(70));

  // Save markdown report
  const mdReport = generateMarkdownReport(insights);
  const mdPath = `scripts/output/reddit-value-drivers-${timestamp}.md`;
  writeFileSync(mdPath, mdReport);
  console.log(`\nMarkdown report saved to: ${mdPath}`);
}

function generateMarkdownReport(insights: ValueInsight[]): string {
  let md = `# Reddit Value Driver Research\n\nDate: ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `## Purpose\n\nGround EVE pricing differentiator values in real customer sentiment from UK Reddit communities.\n\n`;
  md += `## Methodology\n\n- Scraped ${SEARCH_QUERIES.length} targeted queries across ${SUBREDDITS.length} UK subreddits\n`;
  md += `- Filtered for UK-relevant posts (subreddit + keyword matching)\n`;
  md += `- Extracted: price mentions, positive value signals, negative alternative signals, key quotes\n\n`;

  md += `## Results by Value Driver\n\n`;

  for (const insight of insights) {
    if (insight.postCount === 0) continue;

    md += `### ${insight.valueDriver}\n`;
    md += `- **Dimension**: ${insight.dimension}\n`;
    md += `- **Segments**: ${insight.segments.join(', ')}\n`;
    md += `- **Posts**: ${insight.postCount}\n`;
    md += `- **"Worth paying more" signals**: ${insight.positiveSignals}\n`;
    md += `- **"Bad alternative" signals**: ${insight.negativeAltSignals}\n`;

    if (insight.pricesMentioned.length > 0) {
      md += `- **Prices mentioned**: ${insight.pricesMentioned.join(', ')}\n`;
    }

    if (insight.keyQuotes.length > 0) {
      md += `\n**Key quotes:**\n`;
      for (const quote of insight.keyQuotes) {
        md += `> ${quote.substring(0, 200)}\n\n`;
      }
    }
    md += `---\n\n`;
  }

  return md;
}

// ============================================================================
// RUN
// ============================================================================

async function main() {
  console.log('Reddit Value Driver Research for EVE Pricing');
  console.log(`Running ${SEARCH_QUERIES.length} queries across UK subreddits`);
  console.log('This will take a few minutes...\n');

  const results: ScrapedResult[] = [];

  // Run queries sequentially to be kind to Apify rate limits
  for (const query of SEARCH_QUERIES) {
    const result = await scrapeQuery(query);
    results.push(result);

    // Small delay between queries
    await new Promise(r => setTimeout(r, 2000));
  }

  const insights = analyzeResults(results);
  await saveResults(insights);

  console.log('\nDone! Review the output and use it to calibrate EVE differentiator values.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
