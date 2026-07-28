/**
 * Partner brag card — a square, shareable PDF of a contractor's day rate.
 * "£409 a day · ~£8k/month at this pace." Built on demand from the my-week app;
 * brand assets (Poppins + hand logo) are code-split so they never bloat the app.
 */
import { jsPDF } from 'jspdf';

export interface BragCardData {
  name: string;
  perDayPence: number;
  days: number;
  monthlyPence: number;
}

const NAVY = '#0f172a';
const CARD = '#1d2d3d';
const AMBER = '#f59e0b';
const WHITE = '#ffffff';
const SLATE = '#94a3b8';

/** Returns the card as a PDF Blob (1080×1080, social-share friendly). */
export async function generatePartnerBragCard(d: BragCardData): Promise<Blob> {
  const { LOGO_DATA_URL, POPPINS_REGULAR, POPPINS_BOLD } = await import('./quote-pdf-brand-assets');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [1080, 1080] });

  let FONT = 'helvetica';
  try {
    doc.addFileToVFS('Poppins-Regular.ttf', POPPINS_REGULAR);
    doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
    doc.addFileToVFS('Poppins-Bold.ttf', POPPINS_BOLD);
    doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
    FONT = 'Poppins';
  } catch { /* fall back to helvetica */ }

  const cx = 540;
  // Background + framing
  doc.setFillColor(NAVY); doc.rect(0, 0, 1080, 1080, 'F');
  doc.setFillColor(CARD); doc.roundedRect(60, 60, 960, 960, 28, 28, 'F');
  doc.setFillColor(AMBER); doc.rect(60, 60, 960, 10, 'F');

  // Logo (source is 940×788)
  const lh = 150; const lw = lh * (940 / 788);
  doc.addImage(LOGO_DATA_URL, 'PNG', cx - lw / 2, 130, lw, lh);

  doc.setFont(FONT, 'bold'); doc.setTextColor(AMBER); doc.setFontSize(30);
  doc.text('HANDY PARTNER', cx, 360, { align: 'center', charSpace: 3 });

  // The number
  doc.setTextColor(WHITE); doc.setFontSize(210);
  doc.text(`£${Math.round(d.perDayPence / 100).toLocaleString()}`, cx, 560, { align: 'center' });
  doc.setFont(FONT, 'normal'); doc.setTextColor(SLATE); doc.setFontSize(64);
  doc.text('a day', cx, 630, { align: 'center' });

  // Context
  doc.setTextColor(WHITE); doc.setFontSize(34);
  doc.text(`${d.name}'s average over the next ${d.days} booked ${d.days === 1 ? 'day' : 'days'}`, cx, 740, { align: 'center', maxWidth: 860 });

  // The brag amplifier
  doc.setFont(FONT, 'bold'); doc.setTextColor(AMBER); doc.setFontSize(48);
  doc.text(`~£${(d.monthlyPence / 100 / 1000).toFixed(1)}k a month at this pace`, cx, 850, { align: 'center' });

  doc.setFont(FONT, 'normal'); doc.setTextColor(SLATE); doc.setFontSize(26);
  doc.text('handyservices.app  ·  become a partner', cx, 970, { align: 'center' });

  return doc.output('blob');
}

/** Generate the card and share it (Web Share API with the file, else download). */
export async function sharePartnerBragCard(d: BragCardData): Promise<void> {
  const blob = await generatePartnerBragCard(d);
  const file = new File([blob], 'my-handy-day-rate.pdf', { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Handy day rate', text: `£${Math.round(d.perDayPence / 100).toLocaleString()} a day with Handy` });
      return;
    } catch { /* user cancelled or share failed — fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'my-handy-day-rate.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
