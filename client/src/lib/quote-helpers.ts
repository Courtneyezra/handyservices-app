import { personalizedQuotes } from "@shared/schema";

type PersonalizedQuote = typeof personalizedQuotes.$inferSelect;

export interface LineItem {
    description: string;
    pricePence?: number;
    quantity?: number;
}

/**
 * Extract line items from quote jobs array (excludes add-ons)
 * Handles both flat structure (live call popup) and nested tasks structure
 */
export function getLineItems(quote: PersonalizedQuote): LineItem[] {
    const lineItems: LineItem[] = [];

    if (quote.jobs && Array.isArray(quote.jobs) && quote.jobs.length > 0) {
        (quote.jobs as any[]).forEach((job: any) => {
            // Handle flat job structure (from live call popup)
            if (job.description && !job.tasks) {
                // Skip add-ons - they're shown separately in "Our local customers also add:"
                if (!job.description.startsWith('Add-on:')) {
                    lineItems.push({
                        description: job.description,
                        pricePence: job.pricePence,
                        quantity: job.quantity || 1,
                    });
                }
            }
            // Handle nested tasks structure (from other quote generators)
            else if (job.tasks && Array.isArray(job.tasks)) {
                job.tasks.forEach((task: any) => {
                    const d = task.deliverable || task.description;
                    if (d && !d.startsWith('Add-on:')) {
                        lineItems.push({
                            description: d,
                            pricePence: task.pricePence,
                            quantity: task.quantity || 1,
                        });
                    }
                });
            }
        });
    }

    return lineItems;
}

/**
 * Get scope of works as formatted text (NO prices)
 */
export function getScopeOfWorks(quote: PersonalizedQuote): string {
    const lineItems = getLineItems(quote);

    if (lineItems.length > 0) {
        return lineItems.map(item => {
            const qty = item.quantity && item.quantity > 1 ? `${item.quantity}x ` : '';
            return `${qty}${item.description}`;
        }).join('\n');
    }

    // Fallback to legacy coreDeliverables
    if (quote.coreDeliverables && Array.isArray(quote.coreDeliverables)) {
        return (quote.coreDeliverables as string[]).join('\n');
    }

    return quote.jobDescription || "No details provided.";
}

/**
 * Get expert note text with prices (for spec sheets, PDFs)
 */
export function getExpertNoteText(quote: PersonalizedQuote): string {
    const lineItems = getLineItems(quote);

    if (lineItems.length > 0) {
        return lineItems.map(item => {
            const qty = item.quantity && item.quantity > 1 ? `${item.quantity}x ` : '';
            const price = item.pricePence ? ` — £${(item.pricePence / 100).toFixed(0)}` : '';
            return `${qty}${item.description}${price}`;
        }).join('\n');
    }

    // Fallback to legacy coreDeliverables
    if (quote.coreDeliverables && Array.isArray(quote.coreDeliverables)) {
        return (quote.coreDeliverables as string[]).map(d => `• ${d}`).join('\n');
    }

    return quote.assessmentReason || quote.jobDescription || "No details provided.";
}
