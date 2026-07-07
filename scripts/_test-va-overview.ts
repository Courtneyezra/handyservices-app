// Throwaway verification script for the VA overview aggregates.
// Run: npx tsx scripts/_test-va-overview.ts
import { buildVaOverview } from "../server/call-performance-routes";

async function main() {
    const overview = await buildVaOverview("month", "2026-06");
    console.log(JSON.stringify(overview, null, 2));
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
