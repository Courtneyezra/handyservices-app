import { personalizedQuotes } from "@shared/schema";

type PersonalizedQuote = typeof personalizedQuotes.$inferSelect;

export function getExpertNoteText(quote: PersonalizedQuote): string {
    // 1. Determine Summary
    // Use jobs array summary/description first, fallback to top-level jobDescription
    const summary = quote.jobs?.[0]?.summary || quote.jobs?.[0]?.description || quote.jobDescription;

    // 2. Determine Deliverables
    let deliverables: string[] = [];

    // Extract deliverables from structured jobs tasks
    if (quote.jobs && quote.jobs.length > 0) {
        quote.jobs.forEach((job: any) => {
            if (job.tasks) {
                job.tasks.forEach((t: any) => {
                    // Try to get deliverable, fallback to description
                    const d = t.deliverable || t.description;
                    if (d) deliverables.push(d);
                });
            }
        });
    } else if (quote.coreDeliverables) {
        // Fallback to legacy coreDeliverables
        deliverables = quote.coreDeliverables as string[];
    }

    // 3. Construct Text
    // Use assessmentReason as base if no structured jobs/data, otherwise build the "Job Sheet" format
    const hasStructuredData = (summary && summary.trim().length > 0) || deliverables.length > 0;

    // If we have structured data, format it nicely
    if (hasStructuredData) {
        const parts = [];
        if (summary) parts.push(summary);
        if (deliverables.length > 0) {
            parts.push(deliverables.map(d => `• ${d}`).join('\n'));
        }
        return parts.join('\n\n');
    }

    // Fallback: Use standard text fields
    // assessmentReason is preferred for Diagnostic/Visit quotes
    // jobDescription is the ultimate fallback
    return quote.assessmentReason || quote.jobDescription || "No details provided.";
}
