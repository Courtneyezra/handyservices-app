import { writeFileSync, readdirSync } from 'fs';
import sharp from 'sharp';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { buildQuotePdf } from '../client/src/lib/quote-pdf-generator';
import { brandAssets } from '../client/src/lib/quote-pdf-brand-assets';

const slug = process.argv[2] || '78gmi07p';
const PORT = process.argv[3] || '62938'; // this session's preview dev server

// Fetch each customer photo from the running dev server and convert webp→JPEG.
async function toPhoto(buf: Buffer) {
  const jpg = await sharp(buf).resize(520, 520, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  const meta = await sharp(jpg).metadata();
  return { dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`, w: meta.width || 4, h: meta.height || 3 };
}

async function loadPhotos(urls: string[]) {
  const out: { dataUrl: string; w: number; h: number }[] = [];
  for (const u of urls.slice(0, 8)) {
    try {
      const res = await fetch(`http://localhost:${PORT}${u}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) continue; // SPA fallback = photo missing locally
      out.push(await toPhoto(buf));
    } catch { /* skip */ }
  }
  // Preview-only fallback: real /uploads photos live in S3 (stale locally), so use
  // committed sample images just to see the grid layout. Never hit in the browser.
  if (out.length === 0 && urls.length > 0) {
    const dir = 'client/public/assets/quote-images';
    const files = readdirSync(dir).filter((f) => f.endsWith('.webp') && !f.includes('-wide')).slice(0, Math.min(urls.length, 8));
    for (const f of files) {
      try { out.push(await toPhoto(await sharp(`${dir}/${f}`).toBuffer())); } catch { /* skip */ }
    }
  }
  return out;
}

function getLineTitle(l: any) { return l.skuName || l.description; }
function getSkuQualifier(l: any): string | null {
  if (l.source !== 'sku') return null;
  const c = l.unitCount, u = l.skuUnitLabel || l.unitLabel;
  if (c && c > 0) return `× ${c}${u ? ` ${u}` : ''}`;
  if (l.selectedTier) return String(l.selectedTier);
  return null;
}
function getDesc(l: any): string | null { return l.skuCustomerDescription || l.details || null; }

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
  if (!q) { console.error('no quote'); process.exit(1); }
  const items: any[] = (q.pricingLineItems as any[]) || [];
  const sorted = [...items].sort((a,b)=>((b.guardedPricePence||0)+(b.materialsWithMarginPence||0))-((a.guardedPricePence||0)+(a.materialsWithMarginPence||0)));
  const bd = q.batchDiscount as any;
  const total = (q.finalPricePence as number) || (q.basePrice as number) || 0;
  const materials = (q.materialsCostWithMarkupPence as number) || 0;
  const deposit = total > 0 ? Math.round(materials + (total - materials) * 0.30) : 0;
  const ctx: any = q.contextSignals || {};
  const ctxType = String(ctx.customerType || '').toLowerCase();
  const isLandlord = /landlord/.test(String(ctx.vaContext || '')) || ctxType === 'landlord';
  const laneEligible = !isLandlord && ctxType !== 'business';
  const premiumBase = (q.basePrice as number) || total;
  const premium = laneEligible && premiumBase > 0 ? Math.round((3000 + Math.round(premiumBase * 0.06)) / 100) * 100 : 0;
  const photos = await loadPhotos(((q.customerPhotoUrls as string[]) || []));
  const doc = buildQuotePdf({
    quoteId: q.id, customerName: q.customerName || 'Customer', address: q.address, postcode: q.postcode,
    jobDescription: q.jobDescription || '', priceInPence: total, validityHours: 48,
    createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
    lineItems: sorted.map(l => ({ title: getLineTitle(l), qualifier: getSkuQualifier(l), subtitle: getDesc(l),
      pricePence: (l.guardedPricePence||0)+(l.materialsWithMarginPence||0)+(l.structuralSharePence||0) })),
    batchDiscountPence: bd?.applied ? bd.savingsPence : undefined,
    batchDiscountLabel: bd?.applied ? `Multi-job discount (${bd.discountPercent}% off)` : undefined,
    payment: total > 0 && deposit > 0 && deposit < total ? { depositPence: deposit, balancePence: total - deposit } : undefined,
    scheduling: premium > 0 ? { flexWindowDays: 7, setDatePremiumPence: premium } : undefined,
    photos: photos.length ? photos : undefined,
  }, brandAssets);
  const out = `scratch-quote-${slug}.pdf`;
  writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
  console.log(`${q.customerName} · ${items.length} items · total £${Math.round(total/100)} · photos=${photos.length} · pages=${doc.internal.getNumberOfPages()} · ${out}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
