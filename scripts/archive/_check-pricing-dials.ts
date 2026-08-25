import 'dotenv/config';
import { getPricingSettings } from '../server/pricing-settings';
async function main() {
  const s = await getPricingSettings();
  console.log('referenceContingencyPercent:', s.referenceContingencyPercent);
  console.log('materialsMarginPercent:', s.materialsMarginPercent);
  console.log('decomposedPricingEnabled:', (s as any).decomposedPricingEnabled, '| attendanceFeePence:', (s as any).attendanceFeePence);
  console.log('welcomeGiftMinQuotePence:', s.welcomeGiftMinQuotePence, '| welcomeGiftMaxMinutes:', s.welcomeGiftMaxMinutes);
  process.exit(0);
}
main();
