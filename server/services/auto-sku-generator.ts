import { db } from "../db";
import { productizedServices, handymanSkills, handymanProfiles } from "@shared/schema";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

interface RateConfig {
    userId: string;
    profileId: string;
    services: {
        trade: string; // 'plumbing'
        hourlyRatePence: number;
        dayRatePence: number;
    }[];
}

export class AutoSkuGenerator {

    private static TRADE_TEMPLATES: Record<string, { label: string, keywords: string[] }> = {
        'plumbing': {
            label: "Plumbing",
            keywords: ['plumber', 'leak', 'tap', 'pipe', 'drain', 'water']
        },
        'electrical': {
            label: "Electrical",
            keywords: ['electrician', 'light', 'socket', 'fuse', 'wiring', 'power']
        },
        'handyman': {
            label: "Handyman Services",
            keywords: ['handyman', 'fix', 'assembly', 'shelf', 'repair']
        },
        'painting': {
            label: "Painting & Decorating",
            keywords: ['painter', 'decorating', 'wall', 'paint']
        },
        'carpentry': {
            label: "Carpentry",
            keywords: ['carpenter', 'wood', 'door', 'cabinet']
        }
    };

    static async generateForContractor(config: RateConfig) {
        const generatedSkus = [];

        for (const service of config.services) {
            const trade = this.TRADE_TEMPLATES[service.trade];
            if (!trade) continue;

            // 1. Hourly Rate SKU
            const hourlySku = await this.createSku({
                name: `${trade.label} - Hourly Rate`,
                description: `Standard hourly rate for ${trade.label.toLowerCase()} services.`,
                pricePence: service.hourlyRatePence,
                timeEstimateMinutes: 60,
                keywords: [...trade.keywords, 'hourly', 'rate'],
                category: service.trade,
                skuCode: `SVC-${service.trade.toUpperCase()}-HR-${nanoid(6)}`
            });
            generatedSkus.push(hourlySku);

            // 2. Day Rate SKU
            if (service.dayRatePence > 0) {
                const daySku = await this.createSku({
                    name: `${trade.label} - Day Rate`,
                    description: `Full day (8 hours) of ${trade.label.toLowerCase()} services.`,
                    pricePence: service.dayRatePence,
                    timeEstimateMinutes: 480,
                    keywords: [...trade.keywords, 'day', 'full day'],
                    category: service.trade,
                    skuCode: `SVC-${service.trade.toUpperCase()}-DAY-${nanoid(6)}`
                });
                generatedSkus.push(daySku);
            }
        }

        // Link SKUs to Contractor
        if (generatedSkus.length > 0) {
            await db.insert(handymanSkills).values(
                generatedSkus.map(sku => ({
                    id: nanoid(),
                    handymanId: config.profileId,
                    serviceId: sku.id
                }))
            );
        }

        return generatedSkus;
    }

    private static async createSku(data: any) {
        // Check if similar SKU exists globally? For now creating unique instances per generation to avoid conflicts.
        // In a real SaaS, we might have global SKUs and link them. 
        // But for "Contractor Platform", each might want their own description eventually.
        // Let's create unique ones for now.

        const [sku] = await db.insert(productizedServices).values({
            id: nanoid(),
            ...data,
            isActive: true, // Default to active
            aiPromptHint: `Use this SKU for ${data.name} requests.`
        }).returning();
        return sku;
    }
}
