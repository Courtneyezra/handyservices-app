import 'dotenv/config';
import { getPricingSettings } from '../server/pricing-settings';
async function main() {
  const s = await getPricingSettings();
  const q: any = s.quoteOffers;
  const dump = (label: string, g: any) => {
    if (!g) return;
    console.log(label, '| mode:', g.selectionMode, '| active:', g.activeOfferId,
      '| items:', (g.items || []).map((o: any) => `${o.id}[${o.type}/${o.template ?? '?'}/${o.enabled ? 'on' : 'off'}${o.weight != null ? '/w' + o.weight : ''}]`).join(' '));
  };
  dump('DEFAULT', q);
  for (const [k, g] of Object.entries(q?.perCustomerType || {})) dump('TYPE ' + k, g);
  process.exit(0);
}
main();
