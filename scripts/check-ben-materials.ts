import { db } from "../server/db";
import { personalizedQuotes, users } from "../shared/schema";
import { and, eq, gte, isNotNull, desc } from "drizzle-orm";

async function main() {
  try {
    const [benUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firstName, "Ben"));
    const benId = benUser.id;

    // Check what's happened since 8 May (after last payment)
    const cutoff = new Date("2026-05-08T12:00:00Z"); // afternoon of 8 May (after Karan accept)

    // All accepts since cutoff
    const accepts = await db
      .select({
        customer: personalizedQuotes.customerName,
        createdAt: personalizedQuotes.createdAt,
        selectedAt: personalizedQuotes.selectedAt,
        bookedAt: personalizedQuotes.bookedAt,
        basePrice: personalizedQuotes.basePrice,
        pricingLineItems: personalizedQuotes.pricingLineItems,
      })
      .from(personalizedQuotes)
      .where(
        and(
          eq(personalizedQuotes.createdBy, benId),
          isNotNull(personalizedQuotes.selectedAt),
          gte(personalizedQuotes.selectedAt, cutoff)
        )
      )
      .orderBy(desc(personalizedQuotes.selectedAt));

    console.log(`\n=== Accepts since 8 May 12:00 ===\n`);
    console.log(`Found ${accepts.length}\n`);

    let totalRev = 0;
    let totalMat = 0;
    accepts.forEach((r) => {
      const rev = (r.basePrice ?? 0) / 100;
      let mat = 0;
      const items = (r.pricingLineItems as any[]) || [];
      items.forEach((it) => (mat += (it.materialsWithMarginPence ?? 0) / 100));
      const base = rev - mat;
      totalRev += rev;
      totalMat += mat;
      console.log(
        `  ${r.selectedAt!.toISOString().slice(0, 16)} | ${(r.customer ?? "").trim().padEnd(18)} | rev £${rev.toFixed(2).padStart(8)} | mat £${mat.toFixed(2).padStart(7)} | base £${base.toFixed(2).padStart(8)} | 10% £${(base * 0.1).toFixed(2)}`
      );
    });

    const labourBase = totalRev - totalMat;
    console.log(
      `\nTOTAL: Rev £${totalRev.toFixed(2)} | Mat £${totalMat.toFixed(2)} | Commission base £${labourBase.toFixed(2)} | 10% commission £${(labourBase * 0.1).toFixed(2)}`
    );

    // Also all sends in period
    const sends = await db
      .select({
        customer: personalizedQuotes.customerName,
        createdAt: personalizedQuotes.createdAt,
        selectedAt: personalizedQuotes.selectedAt,
        basePrice: personalizedQuotes.basePrice,
      })
      .from(personalizedQuotes)
      .where(
        and(
          eq(personalizedQuotes.createdBy, benId),
          gte(personalizedQuotes.createdAt, cutoff)
        )
      )
      .orderBy(desc(personalizedQuotes.createdAt));

    console.log(`\nSends since 8 May 12:00: ${sends.length}`);
    sends.slice(0, 10).forEach((r) => {
      console.log(
        `  ${r.createdAt!.toISOString().slice(0, 16)} | ${(r.customer ?? "").trim().padEnd(18)} | £${((r.basePrice ?? 0) / 100).toFixed(2)} | ${r.selectedAt ? "✓ accepted" : "pending"}`
      );
    });

    // Get latest activity date to know "today"
    const latest = await db
      .select({
        createdAt: personalizedQuotes.createdAt,
        selectedAt: personalizedQuotes.selectedAt,
      })
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.createdBy, benId))
      .orderBy(desc(personalizedQuotes.createdAt))
      .limit(3);

    console.log(`\nLatest activity (to gauge 'today'):`);
    latest.forEach((r) => {
      console.log(`  Created: ${r.createdAt?.toISOString().slice(0, 16)} | Selected: ${r.selectedAt?.toISOString().slice(0, 16) ?? "-"}`);
    });
  } catch (e) {
    console.error("Error:", e);
  }
  process.exit(0);
}

main();
