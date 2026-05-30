import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

interface QuotePDFData {
  quoteId: string;
  customerName: string;
  address?: string | null;
  postcode?: string | null;
  jobDescription: string;
  priceInPence: number;
  segment?: string;
  validityHours?: number;
  createdAt?: Date;
}

// ── Official Handy Services brand tokens (mirrors handy-services-pdf skill) ──
const NAVY: [number, number, number] = [27, 42, 74]; // #1B2A4A
const YELLOW: [number, number, number] = [245, 166, 35]; // #F5A623
const CREAM: [number, number, number] = [255, 248, 236]; // #FFF8EC
const DARK: [number, number, number] = [17, 24, 39]; // #111827
const MUTED: [number, number, number] = [107, 114, 128]; // #6B7280
const GRID: [number, number, number] = [208, 213, 227]; // #D0D5E3
const WHITE: [number, number, number] = [255, 255, 255];

export function buildQuotePdf(data: QuotePDFData): jsPDF {
  const doc = new jsPDF(); // mm, A4 portrait (210 x 297)
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14; // left/right margin
  const contentW = W - M * 2;

  const priceDisplay = `£${Math.round(data.priceInPence / 100).toLocaleString('en-GB')}`;
  const ref = `#${data.quoteId.replace(/^(quote_|pq_)/i, '').slice(0, 8).toUpperCase()}`;
  const dateStr = format(data.createdAt || new Date(), 'd MMM yyyy');
  const location = data.address || data.postcode || '';
  const firstName = (data.customerName || '').split(' ')[0] || 'there';

  // Section heading: navy bold + a short yellow underline rule (PDF parity).
  const sectionHeading = (title: string, y: number) => {
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(title, M, y);
    doc.setDrawColor(...YELLOW);
    doc.setLineWidth(0.8);
    doc.line(M, y + 2, M + 18, y + 2);
  };

  // ── 1. Navy nav bar (logo wordmark, social proof, phone) ──
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 20, 'F');
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Handy Services', M, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(245, 166, 35);
  doc.text('4.9', M, 15.5);
  doc.setTextColor(...WHITE);
  doc.text('from 300+ reviews', M + 6, 15.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('07449 501 762', W - M, 12, { align: 'right' });

  // ── 2. Yellow accent strip ──
  doc.setFillColor(...YELLOW);
  doc.rect(0, 20, W, 7, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('YOUR PERSONALISED QUOTE', W / 2, 24.6, { align: 'center' });

  // ── 3. Hero title block ──
  let y = 42;
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(`Your Quote, ${firstName}`, M, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const preparedFor = [
    `Prepared for ${data.customerName || 'you'}`,
    location,
    dateStr,
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(preparedFor, M, y);

  // ── 4. Credential badge strip (navy, yellow dividers) ──
  y += 8;
  const badgeH = 9;
  doc.setFillColor(...NAVY);
  doc.rect(M, y, contentW, badgeH, 'F');
  const badges = ['£2M Public Liability', '4.9 Google (300+)', 'DBS Checked', 'Next-Day Slots'];
  const cellW = contentW / badges.length;
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  badges.forEach((b, i) => {
    doc.text(b, M + cellW * i + cellW / 2, y + badgeH / 2 + 1.4, { align: 'center' });
    if (i > 0) {
      doc.setDrawColor(...YELLOW);
      doc.setLineWidth(0.4);
      doc.line(M + cellW * i, y + 2, M + cellW * i, y + badgeH - 2);
    }
  });

  // ── 5. Scope of works ──
  y += badgeH + 14;
  sectionHeading('Scope of Works', y);
  y += 8;
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const lines = doc.splitTextToSize(data.jobDescription || 'As discussed.', contentW);
  doc.text(lines, M, y);
  y += lines.length * 5.4 + 10;

  // ── 6. Your quote — cream "recommended" box with thick yellow left border ──
  const boxH = 34;
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...YELLOW);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, y, contentW, boxH, 2, 2, 'FD');
  // thick yellow left accent
  doc.setFillColor(...YELLOW);
  doc.rect(M, y, 1.6, boxH, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('YOUR QUOTE', M + 8, y + 9);
  doc.setFontSize(30);
  doc.text(priceDisplay, M + 8, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`All-inclusive, no hidden fees  ·  Quote ${ref}`, M + 8, y + 30);
  // validity, right aligned
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(`Valid ${data.validityHours || 48} hours`, W - M - 6, y + 9, { align: 'right' });
  y += boxH + 14;

  // ── 7. What's included ──
  sectionHeading("What's Included", y);
  y += 8;
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const inclusions = [
    'Quality workmanship by a vetted, insured tradesperson',
    'Full cleanup on completion',
    'Workmanship guarantee',
    'Fixed price, no surprises on the day',
  ];
  inclusions.forEach((item) => {
    doc.setTextColor(...YELLOW);
    doc.setFont('helvetica', 'bold');
    doc.text('•', M, y);
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'normal');
    doc.text(item, M + 5, y);
    y += 7;
  });

  // ── 8. Navy footer block ──
  const footH = 26;
  const footY = H - footH;
  doc.setFillColor(...NAVY);
  doc.rect(0, footY, W, footH, 'F');
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Handy Services', M, footY + 10);
  doc.setTextColor(245, 166, 35);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Next-day slots  ·  Fast & reliable  ·  Fully insured', M, footY + 16);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Get in Touch', W - M, footY + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('07449 501 762', W - M, footY + 14.5, { align: 'right' });
  doc.text('info@handyservices.co.uk', W - M, footY + 19.5, { align: 'right' });

  return doc;
}

export const generateQuotePDF = (data: QuotePDFData) => {
  const doc = buildQuotePdf(data);
  const filename = `Quote_${data.quoteId.slice(0, 8).toUpperCase()}_${data.customerName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
};
