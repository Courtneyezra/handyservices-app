import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

/** The quote's real validity window in whole hours, from its timestamps
 * (fallback 48h). Now that the window is price-banded, the PDF must reflect the
 * actual span rather than a hard-coded 48. */
export function validityHoursFromQuote(
  createdAt?: Date | string | null,
  expiresAt?: Date | string | null,
): number {
  if (!createdAt || !expiresAt) return 48;
  const c = new Date(createdAt).getTime();
  const e = new Date(expiresAt).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(e) || e <= c) return 48;
  return Math.round((e - c) / 3_600_000);
}

/** One itemised row in the quote breakdown. `pricePence` is the full customer-
 * facing display price for the line (labour + materials + any folded structural
 * share) — i.e. what the customer sees against that job on the quote page. */
export interface QuotePDFLineItem {
  title: string;
  qualifier?: string | null;
  subtitle?: string | null;
  category?: string | null;
  pricePence: number;
}

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
  /** When present (contextual quotes), the PDF renders an itemised breakdown
   * table instead of the single free-text "Scope of Works" block. */
  lineItems?: QuotePDFLineItem[];
  /** Batch/multi-job discount savings in pence, shown as a deduction row. */
  batchDiscountPence?: number;
  batchDiscountLabel?: string;
  /** Reserve-vs-pay-in-full payment choice (mirrors the live booking card).
   * deposit = 100% materials + 30% labour; balance = total − deposit. */
  payment?: {
    depositPence: number;
    balancePence: number;
  };
  /** "When suits you?" scheduling choice (mirrors the live booking card).
   * Only rendered when setDatePremiumPence > 0 (lane-eligible quotes). */
  scheduling?: {
    flexWindowDays?: number;
    setDatePremiumPence: number;
  };
  /** Customer's own job photos (JPEG/PNG data URLs + natural dimensions for
   * aspect-correct thumbnails). Rendered as a "Your Job — Priced From Your Photos" grid. */
  photos?: { dataUrl: string; w: number; h: number }[];
  /** Social-proof review card. Falls back to a default Google review when omitted. */
  testimonial?: { text: string; author: string; rating?: number };
}

// ── Official Handy Services brand tokens (mirrors handy-services-pdf skill) ──
const NAVY: [number, number, number] = [27, 42, 74]; // #1B2A4A
const YELLOW: [number, number, number] = [245, 166, 35]; // #F5A623
const CREAM: [number, number, number] = [255, 248, 236]; // #FFF8EC
const DARK: [number, number, number] = [17, 24, 39]; // #111827
const MUTED: [number, number, number] = [107, 114, 128]; // #6B7280
const GRID: [number, number, number] = [208, 213, 227]; // #D0D5E3
const GREEN: [number, number, number] = [63, 138, 14]; // #3F8A0E
const SLATE_LIGHT: [number, number, number] = [203, 213, 225]; // #CBD5E1 — sub-text on navy
const WHITE: [number, number, number] = [255, 255, 255];

const money = (pence: number) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`;

/** Brand assets (Poppins TTFs + hand logo) — loaded via dynamic import at the
 * call site so the ~640KB payload stays out of the main bundle. When omitted the
 * PDF falls back to Helvetica with the text wordmark only. */
export interface QuotePdfBrand {
  logoDataUrl?: string;
  poppins?: { regular: string; bold: string; italic: string };
}

export function buildQuotePdf(data: QuotePDFData, brand?: QuotePdfBrand): jsPDF {
  const doc = new jsPDF(); // mm, A4 portrait (210 x 297)
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14; // left/right margin
  const contentW = W - M * 2;

  // Register Poppins (matches the handy-services-pdf brand skill); fall back to
  // Helvetica if the assets weren't supplied or fail to register.
  let FONT = 'helvetica';
  if (brand?.poppins) {
    try {
      doc.addFileToVFS('Poppins-Regular.ttf', brand.poppins.regular);
      doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
      doc.addFileToVFS('Poppins-Bold.ttf', brand.poppins.bold);
      doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
      doc.addFileToVFS('Poppins-Italic.ttf', brand.poppins.italic);
      doc.addFont('Poppins-Italic.ttf', 'Poppins', 'italic');
      FONT = 'Poppins';
    } catch {
      FONT = 'helvetica';
    }
  }
  const LOGO = brand?.logoDataUrl;
  // Aspect ratio of the source logo (940×788) — keep thumbnails undistorted.
  const LOGO_AR = 940 / 788;

  const priceDisplay = money(data.priceInPence);
  const ref = `#${data.quoteId.replace(/^(quote_|pq_)/i, '').slice(0, 8).toUpperCase()}`;
  const dateStr = format(data.createdAt || new Date(), 'd MMM yyyy');
  const location = data.address || data.postcode || '';
  const firstName = (data.customerName || '').split(' ')[0] || 'there';
  const hasItems = Array.isArray(data.lineItems) && data.lineItems.length > 0;

  // Footer geometry — content must never flow underneath it.
  const footH = 26;
  const bottomLimit = H - footH - 8;

  // Section heading: navy bold + a short yellow underline rule (PDF parity).
  const sectionHeading = (title: string, yPos: number) => {
    doc.setTextColor(...NAVY);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.text(title, M, yPos);
    doc.setDrawColor(...YELLOW);
    doc.setLineWidth(0.8);
    doc.line(M, yPos + 2, M + 18, yPos + 2);
  };

  // Continuation page for long itemised breakdowns — slim navy header, returns
  // the starting y for content on the new page.
  const newPage = (): number => {
    doc.addPage();
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 14, 'F');
    let hx = M;
    if (LOGO) {
      const lh = 9;
      try {
        doc.addImage(LOGO, 'PNG', M, 2.5, lh * LOGO_AR, lh);
        hx = M + lh * LOGO_AR + 3;
      } catch { /* text-only */ }
    }
    doc.setTextColor(...WHITE);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.text('Handy Services', hx, 9);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.text(`Quote ${ref} (continued)`, W - M, 9, { align: 'right' });
    return 24;
  };

  // Add a page break when the next block wouldn't fit above the footer.
  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) y = newPage();
  };

  // A filled 5-point star (jsPDF has no star primitive) — used for review ratings.
  const star = (cx: number, cy: number, r: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.42 : r;
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]);
    doc.setFillColor(...YELLOW);
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'F', true);
  };

  // A selectable-style option card (mirrors the booking card's radio rows):
  // the recommended option is a BOLD solid-navy block (white label, filled yellow
  // radio), others are plain white outlined. `badge` renders a yellow pill.
  const optionBox = (label: string, sub: string, opts: { recommended?: boolean; badge?: string } = {}) => {
    const h = 12.5;
    ensureSpace(h + 2);
    const rec = !!opts.recommended;
    if (rec) {
      doc.setFillColor(...NAVY);
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.3);
    } else {
      doc.setFillColor(...WHITE);
      doc.setDrawColor(...GRID);
      doc.setLineWidth(0.3);
    }
    doc.roundedRect(M, y, contentW, h, 1.6, 1.6, 'FD');
    if (rec) {
      // thick yellow left accent — the "selected" cue
      doc.setFillColor(...YELLOW);
      doc.rect(M, y, 1.6, h, 'F');
    }
    // radio / check marker
    doc.setDrawColor(...(rec ? YELLOW : GRID));
    doc.setLineWidth(0.5);
    doc.circle(M + 7, y + h / 2, 2.2, 'S');
    if (rec) {
      doc.setFillColor(...YELLOW);
      doc.circle(M + 7, y + h / 2, 1.1, 'F');
    }
    const textX = M + 13;
    doc.setTextColor(...(rec ? WHITE : NAVY));
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.text(label, textX, y + 5.4);
    doc.setTextColor(...(rec ? SLATE_LIGHT : MUTED));
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.3);
    doc.text(sub, textX, y + 9.6);
    if (opts.badge) {
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9);
      const bw = doc.getTextWidth(opts.badge) + 7;
      doc.setFillColor(...YELLOW);
      doc.roundedRect(W - M - bw - 5, y + h / 2 - 3.4, bw, 6.8, 1.2, 1.2, 'F');
      doc.setTextColor(...NAVY);
      doc.text(opts.badge, W - M - bw - 5 + bw / 2, y + h / 2 + 1.3, { align: 'center' });
    }
    y += h + 2;
  };

  // ── 1. Navy nav bar (logo, wordmark, social proof, phone) ──
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 20, 'F');
  let navX = M;
  if (LOGO) {
    const logoH = 14;
    const logoW = logoH * LOGO_AR;
    try {
      doc.addImage(LOGO, 'PNG', M, 3, logoW, logoH);
      navX = M + logoW + 4;
    } catch { /* fall back to text-only wordmark */ }
  }
  doc.setTextColor(...WHITE);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(15);
  doc.text('Handy Services', navX, 10);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(245, 166, 35);
  doc.text('4.9', navX, 15.5);
  doc.setTextColor(...WHITE);
  doc.text('from 300+ reviews', navX + 6, 15.5);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(10);
  doc.text('07449 501 762', W - M, 12, { align: 'right' });

  // ── 2. Yellow accent strip ──
  doc.setFillColor(...YELLOW);
  doc.rect(0, 20, W, 7, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.text('YOUR PERSONALISED QUOTE', W / 2, 24.6, { align: 'center' });

  // ── 3. Hero title block ──
  let y = 42;
  doc.setTextColor(...NAVY);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(24);
  doc.text(`Your Quote, ${firstName}`, M, y);
  y += 7;
  doc.setFont(FONT, 'normal');
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
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  badges.forEach((b, i) => {
    doc.text(b, M + cellW * i + cellW / 2, y + badgeH / 2 + 1.4, { align: 'center' });
    if (i > 0) {
      doc.setDrawColor(...YELLOW);
      doc.setLineWidth(0.4);
      doc.line(M + cellW * i, y + 2, M + cellW * i, y + badgeH - 2);
    }
  });

  // ── 5. Scope of works — itemised table (contextual) or free text (fallback) ──
  y += badgeH + 12;
  if (hasItems) {
    sectionHeading('Scope of Works & Pricing', y);
    y += 7;

    const priceColW = 24;
    const textW = contentW - priceColW - 8;

    const drawTableHead = () => {
      doc.setFillColor(...NAVY);
      doc.rect(M, y, contentW, 8, 'F');
      doc.setTextColor(...WHITE);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8);
      doc.text('JOB', M + 4, y + 5.4);
      doc.text('PRICE', W - M - 4, y + 5.4, { align: 'right' });
      y += 8;
    };
    drawTableHead();

    data.lineItems!.forEach((item) => {
      const heading = item.qualifier ? `${item.title}   ${item.qualifier}` : item.title;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(10);
      const titleLines = doc.splitTextToSize(heading, textW) as string[];
      let subLines: string[] = [];
      if (item.subtitle) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8.5);
        subLines = doc.splitTextToSize(item.subtitle, textW) as string[];
      }
      const rowH = 3.5 + titleLines.length * 4.2 + (subLines.length ? subLines.length * 3.8 + 1 : 0) + 1.5;

      // Page break — keep the row whole and re-draw the table header.
      if (y + rowH > bottomLimit) {
        y = newPage();
        drawTableHead();
      }

      const rowTop = y;
      let ty = y + 4.2;
      doc.setTextColor(...DARK);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(10);
      titleLines.forEach((l) => {
        doc.text(l, M + 4, ty);
        ty += 4.2;
      });
      if (subLines.length) {
        doc.setTextColor(...MUTED);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8.5);
        ty += 0.8;
        subLines.forEach((l) => {
          doc.text(l, M + 4, ty);
          ty += 3.8;
        });
      }
      // Price, right-aligned to the first line of the row.
      doc.setTextColor(...NAVY);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(10);
      doc.text(money(item.pricePence), W - M - 4, rowTop + 4.2, { align: 'right' });

      y = Math.max(ty, rowTop + rowH);
      doc.setDrawColor(...GRID);
      doc.setLineWidth(0.2);
      doc.line(M, y - 1, W - M, y - 1);
      y += 1.5;
    });

    // Multi-job discount deduction row.
    if (data.batchDiscountPence && data.batchDiscountPence > 0) {
      if (y + 10 > bottomLimit) y = newPage();
      doc.setTextColor(...GREEN);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9.5);
      doc.text(data.batchDiscountLabel || 'Multi-job discount', M + 4, y + 4);
      doc.text(`-${money(data.batchDiscountPence)}`, W - M - 4, y + 4, { align: 'right' });
      y += 9;
    }
    y += 4;
  } else {
    sectionHeading('Scope of Works', y);
    y += 8;
    doc.setTextColor(...DARK);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(data.jobDescription || 'As discussed.', contentW);
    doc.text(lines, M, y);
    y += lines.length * 5.4 + 10;
  }

  // ── 6. Your quote — cream "recommended" box with thick yellow left border ──
  const boxH = 34;
  if (y + boxH + 6 > bottomLimit) y = newPage();
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...YELLOW);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, y, contentW, boxH, 2, 2, 'FD');
  // thick yellow left accent
  doc.setFillColor(...YELLOW);
  doc.rect(M, y, 1.6, boxH, 'F');
  doc.setTextColor(...NAVY);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.text(hasItems ? 'TOTAL — ALL JOBS' : 'YOUR QUOTE', M + 8, y + 9);
  doc.setFontSize(30);
  doc.text(priceDisplay, M + 8, y + 24);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`All-inclusive, no hidden fees  ·  Quote ${ref}`, M + 8, y + 30);
  // validity, right aligned
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  const vh = data.validityHours || 48;
  const validityLabel = vh > 72 ? `Valid ${Math.round(vh / 24)} days` : `Valid ${vh} hours`;
  doc.text(validityLabel, W - M - 6, y + 9, { align: 'right' });
  y += boxH + 9;

  // ── 6b. When suits you? — scheduling choice (lane-eligible quotes only) ──
  if (data.scheduling && data.scheduling.setDatePremiumPence > 0) {
    ensureSpace(7 + 2 * 15);
    sectionHeading('When Suits You?', y);
    y += 7;
    optionBox(
      "I'm flexible",
      'We fit you into our route — you pick any days to avoid after booking',
      { recommended: true, badge: 'BEST PRICE' },
    );
    optionBox(
      'I want a date & time',
      'Your exact day & time slot — no waiting in',
      { badge: `+${money(data.scheduling.setDatePremiumPence)}` },
    );
    y += 2;
  }

  // ── 6c. How to pay — reserve deposit vs pay in full ──
  if (data.payment && data.payment.depositPence > 0 && data.payment.balancePence > 0) {
    ensureSpace(7 + 2 * 15);
    sectionHeading('How to Pay', y);
    y += 7;
    // Derive the completion balance from the ROUNDED deposit so the two whole-pound
    // figures always sum back to the displayed total (independent rounding can drift £1).
    const totalPounds = Math.round(data.priceInPence / 100);
    const depositPounds = Math.round(data.payment.depositPence / 100);
    const balancePounds = totalPounds - depositPounds;
    const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`;
    optionBox(
      `Reserve your slot — ${gbp(depositPounds)} today`,
      `${gbp(balancePounds)} on completion · covers materials in full + 30% of labour`,
      { recommended: true },
    );
    optionBox(
      `Pay in full — ${priceDisplay} today`,
      'Settle the whole job now, nothing due on completion',
    );
    y += 2;
  }

  // ── 7. What's included — compact reassurance strip (keeps itemised quotes to
  //     a single page; each item separated by a yellow bullet) ──
  const inclusions = [
    'Vetted, insured tradesperson',
    'Full cleanup on completion',
    'Workmanship guarantee',
    'Fixed price — no surprises',
  ];
  if (y + 14 > bottomLimit) y = newPage();
  sectionHeading("What's Included", y);
  y += 7;
  doc.setFontSize(9.5);
  let cx = M;
  inclusions.forEach((item, i) => {
    doc.setFont(FONT, 'normal');
    const w = doc.getTextWidth(item);
    const sepW = i > 0 ? doc.getTextWidth('•') + 5 : 0;
    // Wrap BEFORE drawing the separator so no bullet is ever left dangling at a
    // line end; the wrapped item starts clean at the left margin with no bullet.
    if (cx + sepW + w > W - M) {
      cx = M;
      y += 5.5;
    } else if (i > 0) {
      doc.setTextColor(...YELLOW);
      doc.setFont(FONT, 'bold');
      doc.text('•', cx + 2.5, y);
      cx += sepW;
    }
    doc.setTextColor(...DARK);
    doc.setFont(FONT, 'normal');
    doc.text(item, cx, y);
    cx += w + 2.5;
  });
  y += 10;

  // ── 7a. Your job, priced from your photos — photo grid (page-filler: only when it fits) ──
  if (data.photos && data.photos.length > 0) {
    const shown = data.photos.slice(0, 8);
    const cols = 4;
    const gap = 3;
    const cellW = (contentW - gap * (cols - 1)) / cols;
    const cellH = cellW * 0.75;
    const rows = Math.ceil(shown.length / cols);
    const need = 8 + rows * (cellH + gap);
    if (y + need <= bottomLimit) {
      sectionHeading('Your Job — Priced From Your Photos', y);
      y += 7;
      shown.forEach((p, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const bx = M + c * (cellW + gap);
        const by = y + r * (cellH + gap);
        // letterbox card background, then the image fitted inside preserving aspect
        doc.setFillColor(...CREAM);
        doc.setDrawColor(...GRID);
        doc.setLineWidth(0.2);
        doc.roundedRect(bx, by, cellW, cellH, 1, 1, 'FD');
        const scale = Math.min(cellW / p.w, cellH / p.h);
        const dw = p.w * scale;
        const dh = p.h * scale;
        try {
          doc.addImage(p.dataUrl, 'JPEG', bx + (cellW - dw) / 2, by + (cellH - dh) / 2, dw, dh);
        } catch {
          /* skip a photo that fails to decode rather than abort the whole PDF */
        }
      });
      y += rows * (cellH + gap) + 5;
    }
  }

  // ── 7b. Social proof — review card (page-filler: only when it fits) ──
  {
    const t = data.testimonial || {
      text: 'Turned up on time, tidy, and the price was exactly what the quote said. Would use again without hesitation.',
      author: 'Verified Google review',
      rating: 5,
    };
    const lineW = contentW - 16;
    doc.setFont(FONT, 'italic');
    doc.setFontSize(10);
    const tLines = doc.splitTextToSize(`“${t.text}”`, lineW) as string[];
    const cardH = 12 + tLines.length * 5 + 6;
    if (y + cardH <= bottomLimit) {
      doc.setFillColor(...CREAM);
      doc.setDrawColor(...YELLOW);
      doc.setLineWidth(0.4);
      doc.roundedRect(M, y, contentW, cardH, 2, 2, 'FD');
      // stars
      const rating = Math.max(1, Math.min(5, t.rating || 5));
      for (let i = 0; i < rating; i++) star(M + 8 + i * 6, y + 8, 2.2);
      // quote
      doc.setTextColor(...DARK);
      doc.setFont(FONT, 'italic');
      doc.setFontSize(10);
      tLines.forEach((l, i) => doc.text(l, M + 8, y + 15 + i * 5));
      // author
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(`— ${t.author}`, M + 8, y + 15 + tLines.length * 5);
      y += cardH + 6;
    }
  }

  // ── 7c. Ready to book? — bold navy CTA band with yellow accent.
  // Page-filler: only drawn when it fits on the current page (fills the lower
  // half on multi-page quotes; skipped on compact quotes where forcing it onto
  // a new page would look worse — the footer already carries contact details). ──
  const bandH = 22;
  if (y + bandH + 4 <= bottomLimit) {
  doc.setFillColor(...NAVY);
  doc.roundedRect(M, y, contentW, bandH, 2, 2, 'F');
  doc.setFillColor(...YELLOW);
  doc.rect(M, y, 1.8, bandH, 'F');
  doc.setTextColor(...WHITE);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.text('Ready to book?', M + 9, y + 9);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_LIGHT);
  doc.text('Reply on WhatsApp or call us — we\'ll lock in your slot.', M + 9, y + 15.5);
  doc.setTextColor(...YELLOW);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.text('CALL OR MESSAGE', W - M - 8, y + 8, { align: 'right' });
  doc.setTextColor(...WHITE);
  doc.setFontSize(14);
  doc.text('07449 501 762', W - M - 8, y + 15.5, { align: 'right' });
  y += bandH + 6;
  }

  // ── 8. Navy footer block (drawn on the final page) ──
  const footY = H - footH;
  doc.setFillColor(...NAVY);
  doc.rect(0, footY, W, footH, 'F');
  let footX = M;
  if (LOGO) {
    const logoH = 13;
    const logoW = logoH * LOGO_AR;
    try {
      doc.addImage(LOGO, 'PNG', M, footY + (footH - logoH) / 2, logoW, logoH);
      footX = M + logoW + 4;
    } catch { /* text-only footer */ }
  }
  doc.setTextColor(...WHITE);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text('Handy Services', footX, footY + 10);
  doc.setTextColor(245, 166, 35);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  doc.text('Next-day slots  ·  Fast & reliable  ·  Fully insured', footX, footY + 16);
  doc.setTextColor(...WHITE);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.text('Get in Touch', W - M, footY + 9, { align: 'right' });
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  doc.text('07449 501 762', W - M, footY + 14.5, { align: 'right' });
  doc.text('info@handyservices.co.uk', W - M, footY + 19.5, { align: 'right' });

  return doc;
}

export const generateQuotePDF = async (data: QuotePDFData) => {
  // Code-split the ~640KB Poppins+logo payload — only fetched on download.
  let brand: QuotePdfBrand | undefined;
  try {
    brand = (await import('./quote-pdf-brand-assets')).brandAssets;
  } catch {
    brand = undefined; // fall back to Helvetica + text wordmark
  }
  const doc = buildQuotePdf(data, brand);
  const filename = `Quote_${data.quoteId.slice(0, 8).toUpperCase()}_${data.customerName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
};

/**
 * Load the customer's job photos (same-origin `/uploads/*` URLs) into
 * aspect-tagged JPEG data URLs the PDF can embed. Browser-only (uses Image +
 * canvas). Any photo that fails to load (404 / CORS taint) is skipped, so a
 * missing photo never blocks the download — the grid just shows fewer/none.
 */
export async function loadQuotePhotos(
  urls: string[],
  max = 8,
): Promise<{ dataUrl: string; w: number; h: number }[]> {
  const out: { dataUrl: string; w: number; h: number }[] = [];
  for (const url of urls.slice(0, max)) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const cap = 520;
      const scale = Math.min(1, cap / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, w, h);
      out.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.8), w, h });
    } catch {
      /* skip an unloadable photo */
    }
  }
  return out;
}
