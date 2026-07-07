import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const SLUG = 'zpm0zk4b';

const detailsByLineId = {
  '25vwi48w': 'Strip out existing fittings, lift the floor tiles, and remove wall tiles back to the substrate. Waste loaded and taken away.',
  'fs2ijh2n': 'Prep the surfaces, set the tiles with bathroom-grade adhesive, then grout and seal the perimeter. 24-hour cure before regular use.',
  '93bdflma': 'Level and seal the tray onto a sound base, connect the waste, then assemble the enclosure and seal the joints. Leak-checked before sign-off.',
  'bl5ze1xu': 'Fix the vanity carcass, fit the basin, connect hot and cold feeds plus the waste, then seal around the perimeter. Leak-checked on completion.',
  '6aqpyiym': 'Set the pan, fit the cistern, connect the feed and waste, then test the flush and check for leaks. Existing unit taken away.',
  'x3601aia': 'Run spurs from the existing circuit to each appliance position, fit the sockets, then test and certify the work to current regs.',
};

const [row] = await sql`
  SELECT id, pricing_line_items FROM personalized_quotes WHERE short_slug = ${SLUG}
`;
if (!row) {
  console.error(`No quote found for slug ${SLUG}`);
  process.exit(1);
}

const items = row.pricing_line_items;
const updated = items.map((li) => {
  const detail = detailsByLineId[li.lineId];
  if (!detail) {
    console.warn(`No detail mapped for lineId=${li.lineId} (${li.description})`);
    return li;
  }
  return { ...li, details: detail };
});

await sql`
  UPDATE personalized_quotes
  SET pricing_line_items = ${JSON.stringify(updated)}::jsonb
  WHERE short_slug = ${SLUG}
`;

console.log(`Updated ${updated.filter((i) => i.details).length} line items on quote ${row.id}`);
for (const li of updated) {
  console.log(`  • ${li.description}`);
  if (li.details) console.log(`    └ ${li.details}`);
}
