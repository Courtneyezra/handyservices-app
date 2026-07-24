/**
 * SEO suburb data — real suburbs/neighbourhoods of Nottingham and Derby, used
 * for T3 (job x suburb) landing pages. Pure data, no I/O.
 *
 * Slugs are URL-safe (lowercase, hyphenated) and map 1:1 to the `:suburb`
 * route segment. postcodeArea is the outward postcode district the suburb
 * predominantly falls in.
 */
import type { SeoSuburb } from '../contract';

const NOTTINGHAM_SUBURBS: SeoSuburb[] = [
    { slug: 'beeston', name: 'Beeston', citySlug: 'nottingham', postcodeArea: 'NG9' },
    { slug: 'west-bridgford', name: 'West Bridgford', citySlug: 'nottingham', postcodeArea: 'NG2' },
    { slug: 'arnold', name: 'Arnold', citySlug: 'nottingham', postcodeArea: 'NG5' },
    { slug: 'carlton', name: 'Carlton', citySlug: 'nottingham', postcodeArea: 'NG4' },
    { slug: 'bulwell', name: 'Bulwell', citySlug: 'nottingham', postcodeArea: 'NG6' },
    { slug: 'hucknall', name: 'Hucknall', citySlug: 'nottingham', postcodeArea: 'NG15' },
    { slug: 'wollaton', name: 'Wollaton', citySlug: 'nottingham', postcodeArea: 'NG8' },
    { slug: 'sherwood', name: 'Sherwood', citySlug: 'nottingham', postcodeArea: 'NG5' },
    { slug: 'mapperley', name: 'Mapperley', citySlug: 'nottingham', postcodeArea: 'NG3' },
    { slug: 'clifton', name: 'Clifton', citySlug: 'nottingham', postcodeArea: 'NG11' },
    { slug: 'bilborough', name: 'Bilborough', citySlug: 'nottingham', postcodeArea: 'NG8' },
    { slug: 'gedling', name: 'Gedling', citySlug: 'nottingham', postcodeArea: 'NG4' },
    { slug: 'ruddington', name: 'Ruddington', citySlug: 'nottingham', postcodeArea: 'NG11' },
    { slug: 'stapleford', name: 'Stapleford', citySlug: 'nottingham', postcodeArea: 'NG9' },
    { slug: 'netherfield', name: 'Netherfield', citySlug: 'nottingham', postcodeArea: 'NG4' },
    { slug: 'bramcote', name: 'Bramcote', citySlug: 'nottingham', postcodeArea: 'NG9' },
    { slug: 'lenton', name: 'Lenton', citySlug: 'nottingham', postcodeArea: 'NG7' },
    { slug: 'radcliffe-on-trent', name: 'Radcliffe-on-Trent', citySlug: 'nottingham', postcodeArea: 'NG12' },
];

const DERBY_SUBURBS: SeoSuburb[] = [
    { slug: 'mickleover', name: 'Mickleover', citySlug: 'derby', postcodeArea: 'DE3' },
    { slug: 'littleover', name: 'Littleover', citySlug: 'derby', postcodeArea: 'DE23' },
    { slug: 'allestree', name: 'Allestree', citySlug: 'derby', postcodeArea: 'DE22' },
    { slug: 'chaddesden', name: 'Chaddesden', citySlug: 'derby', postcodeArea: 'DE21' },
    { slug: 'spondon', name: 'Spondon', citySlug: 'derby', postcodeArea: 'DE21' },
    { slug: 'alvaston', name: 'Alvaston', citySlug: 'derby', postcodeArea: 'DE24' },
    { slug: 'oakwood', name: 'Oakwood', citySlug: 'derby', postcodeArea: 'DE21' },
    { slug: 'sinfin', name: 'Sinfin', citySlug: 'derby', postcodeArea: 'DE24' },
    { slug: 'chellaston', name: 'Chellaston', citySlug: 'derby', postcodeArea: 'DE73' },
    { slug: 'darley-abbey', name: 'Darley Abbey', citySlug: 'derby', postcodeArea: 'DE22' },
    { slug: 'normanton', name: 'Normanton', citySlug: 'derby', postcodeArea: 'DE23' },
    { slug: 'mackworth', name: 'Mackworth', citySlug: 'derby', postcodeArea: 'DE22' },
    { slug: 'breadsall', name: 'Breadsall', citySlug: 'derby', postcodeArea: 'DE21' },
    { slug: 'borrowash', name: 'Borrowash', citySlug: 'derby', postcodeArea: 'DE72' },
    { slug: 'duffield', name: 'Duffield', citySlug: 'derby', postcodeArea: 'DE56' },
    { slug: 'findern', name: 'Findern', citySlug: 'derby', postcodeArea: 'DE65' },
    { slug: 'melbourne', name: 'Melbourne', citySlug: 'derby', postcodeArea: 'DE73' },
    { slug: 'ockbrook', name: 'Ockbrook', citySlug: 'derby', postcodeArea: 'DE72' },
];

/** All suburbs, keyed for lookup by the content API. */
export const SEO_SUBURBS: SeoSuburb[] = [
    ...NOTTINGHAM_SUBURBS,
    ...DERBY_SUBURBS,
];
