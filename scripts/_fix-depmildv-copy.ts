import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';

const [q] = await db
  .select()
  .from(personalizedQuotes)
  .where(eq(personalizedQuotes.shortSlug, 'depmildv'))
  .limit(1);

if (!q) {
  console.log('NOT FOUND');
  process.exit(1);
}

const copy = {
  jobDescription: 'Install 2 light fittings',
  contextualHeadline: 'Two New Lights, Fitted Right',
  contextualMessage:
    "We'll install both light fittings, make sure everything's working, and leave the room spotless. Quick, tidy, done in one visit.",
  jobTopLine: 'Two light fittings installed',
  proposalSummary:
    "We'll install your two light fittings, check everything's working safely, and clean up before we go. All done in a single visit.",
};

const breakdown = (q.pricingLayerBreakdown as Record<string, any>) || {};
const messaging = breakdown.messaging || {};

console.log('Before headline:', q.contextualHeadline);
console.log('Before topLine:', (q as any).jobTopLine);

const [updated] = await db
  .update(personalizedQuotes)
  .set({
    ...copy,
    pricingLayerBreakdown: {
      ...breakdown,
      jobTopLine: copy.jobTopLine,
      contextualHeadline: copy.contextualHeadline,
      contextualMessage: copy.contextualMessage,
      messaging: {
        ...messaging,
        jobTopLine: copy.jobTopLine,
        contextualHeadline: copy.contextualHeadline,
        contextualMessage: copy.contextualMessage,
        proposalSummary: copy.proposalSummary,
      },
    },
  })
  .where(eq(personalizedQuotes.id, q.id))
  .returning();

console.log('After headline:', updated.contextualHeadline);
console.log('After message:', updated.contextualMessage);
console.log('After topLine:', (updated as any).jobTopLine);
console.log('After summary:', (updated as any).proposalSummary);
console.log('After jobDescription:', updated.jobDescription);
const ab = (updated.pricingLayerBreakdown as Record<string, any>) || {};
console.log('Breakdown messaging headline:', ab.messaging?.contextualHeadline);
process.exit(0);
