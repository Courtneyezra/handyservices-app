import { buildVaOverview } from '../server/call-performance-routes';
async function main() {
  const o = await buildVaOverview('month', '2026-07');
  console.log('perVa:', JSON.stringify((o as any).perVa, null, 1));
  console.log('totals:', JSON.stringify((o as any).totals));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
