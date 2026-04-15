import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

// Handy Services Brand
const NAVY = '#1B2A4A';
const YELLOW = '#F5A623';
const LIGHT_BG = '#F7F8FC';
const DARK_TEXT = '#111827';
const MUTED = '#6B7280';
const BORDER = '#D0D5E3';
const WHITE = '#FFFFFF';
const GREEN = '#7DB00E';

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceSection {
  address: string;
  invoiceNumber: string;
  items: InvoiceLineItem[];
  total: number;
  deposit: number;
  balance: number;
}

export interface BrandedInvoiceData {
  parentInvoiceNumber?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  invoiceDate: string;
  dueDate?: string;
  sections: InvoiceSection[];
  grandTotal: number;
  totalDeposits: number;
  balanceDue: number;
}

/**
 * Generate a single-section invoice PDF (one property/quote)
 */
export async function generateSingleInvoicePDF(section: InvoiceSection, customerName: string, invoiceDate: string, dueDate?: string) {
  await generateBrandedInvoicePDF({
    customerName,
    invoiceDate,
    dueDate,
    sections: [section],
    grandTotal: section.total,
    totalDeposits: section.deposit,
    balanceDue: section.balance,
  });
}

// Load logo as base64 for embedding in PDF
let logoDataUrl: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (logoDataUrl) return logoDataUrl;
  try {
    const response = await fetch('/logo.png');
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        logoDataUrl = reader.result as string;
        resolve(logoDataUrl);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Generate branded Handy Services invoice PDF
 */
export async function generateBrandedInvoicePDF(data: BrandedInvoiceData) {
  const logo = await loadLogo();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // =========================================
  // NAV BAR
  // =========================================
  doc.setFillColor(NAVY);
  doc.rect(0, 0, pageWidth, 16, 'F');

  // Logo (square aspect ratio)
  if (logo) {
    doc.addImage(logo, 'PNG', 5, 2, 12, 12);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(WHITE);
  doc.text('Handy Services', logo ? 19 : 14, 11);

  doc.setFontSize(8.5);
  doc.setTextColor(YELLOW);
  doc.text('4.9 from 300+ Reviews', 75, 11);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(WHITE);
  doc.text('07449 501 762', pageWidth - 14, 11, { align: 'right' });

  // =========================================
  // YELLOW ACCENT STRIP
  // =========================================
  doc.setFillColor(YELLOW);
  doc.rect(0, 16, pageWidth, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(NAVY);
  doc.text('INVOICE', pageWidth / 2, 21.5, { align: 'center' });

  // =========================================
  // TITLE & CUSTOMER INFO
  // =========================================
  let y = 34;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(NAVY);
  doc.text('Invoice', margin, y);

  // Invoice date on right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text('Invoice Date', pageWidth - margin, y - 8, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(DARK_TEXT);
  doc.text(formatDate(data.invoiceDate), pageWidth - margin, y - 2, { align: 'right' });

  if (data.dueDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('Due Date', pageWidth - margin, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(DARK_TEXT);
    doc.text(formatDate(data.dueDate), pageWidth - margin, y + 12, { align: 'right' });
  }

  y += 10;

  // Bill To
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text('BILLED TO', margin, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(DARK_TEXT);
  doc.text(data.customerName, margin, y);
  y += 5;

  if (data.customerEmail) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(data.customerEmail, margin, y);
    y += 4;
  }

  if (data.customerAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(data.customerAddress, margin, y);
    y += 4;
  }

  // =========================================
  // CREDENTIAL BADGES
  // =========================================
  y += 6;
  doc.setFillColor(NAVY);
  doc.rect(margin, y, contentWidth, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(WHITE);
  const badges = ['\u00A32M Insured', '4.9 Google Rating', 'DBS Checked', 'Next-Day Slots'];
  const badgeWidth = contentWidth / badges.length;
  badges.forEach((badge, i) => {
    doc.text(badge, margin + badgeWidth * i + badgeWidth / 2, y + 5.5, { align: 'center' });
  });

  y += 14;

  // =========================================
  // PROPERTY SECTIONS
  // =========================================
  for (const section of data.sections) {
    // Check if we need a new page
    if (y > 240) {
      doc.addPage();
      y = 20;
    }

    // Property header bar
    doc.setFillColor(GREEN);
    doc.rect(margin, y, contentWidth, 10, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(WHITE);
    doc.text(section.address, margin + 4, y + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(section.invoiceNumber, pageWidth - margin - 4, y + 6.5, { align: 'right' });

    y += 14;

    // Line items table
    const tableBody = section.items.map(item => [
      item.description,
      String(item.quantity),
      formatPence(item.total),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Description', 'Qty', 'Amount']],
      body: tableBody,
      theme: 'grid',
      margin: { left: margin, right: margin },
      headStyles: {
        fillColor: NAVY,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: 3,
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 3,
        textColor: DARK_TEXT,
      },
      alternateRowStyles: {
        fillColor: LIGHT_BG,
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 3;

    // Section subtotals
    doc.setFillColor(LIGHT_BG);
    doc.rect(margin, y, contentWidth, 18, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text('Subtotal', margin + 4, y + 5);
    doc.setTextColor(DARK_TEXT);
    doc.text(formatPence(section.total), pageWidth - margin - 4, y + 5, { align: 'right' });

    if (section.deposit > 0) {
      doc.setTextColor(GREEN);
      doc.text('Deposit Paid', margin + 4, y + 11);
      doc.text(`-${formatPence(section.deposit)}`, pageWidth - margin - 4, y + 11, { align: 'right' });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(NAVY);
    doc.text('Balance', margin + 4, y + 17);
    doc.text(formatPence(section.balance), pageWidth - margin - 4, y + 17, { align: 'right' });

    y += 24;
  }

  // =========================================
  // GRAND TOTAL (if multiple sections)
  // =========================================
  if (data.sections.length > 1) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }

    // Yellow separator
    doc.setFillColor(YELLOW);
    doc.rect(margin, y, contentWidth, 1, 'F');
    y += 6;

    doc.setFillColor(NAVY);
    doc.rect(margin, y, contentWidth, 22, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(WHITE);
    doc.text('Combined Total', margin + 6, y + 6);
    doc.text(formatPence(data.grandTotal), pageWidth - margin - 6, y + 6, { align: 'right' });

    doc.setTextColor(YELLOW);
    doc.text('Total Deposits Paid', margin + 6, y + 12);
    doc.text(`-${formatPence(data.totalDeposits)}`, pageWidth - margin - 6, y + 12, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(YELLOW);
    doc.text('Balance Due', margin + 6, y + 19);
    doc.text(formatPence(data.balanceDue), pageWidth - margin - 6, y + 19, { align: 'right' });

    y += 28;
  }

  // =========================================
  // FOOTER
  // =========================================
  const footerY = doc.internal.pageSize.height - 16;
  doc.setFillColor(NAVY);
  doc.rect(0, footerY, pageWidth, 16, 'F');

  // Footer logo (square aspect ratio)
  if (logo) {
    doc.addImage(logo, 'PNG', 5, footerY + 2, 12, 12);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(WHITE);
  doc.text('Handy Services', logo ? 19 : 14, footerY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(YELLOW);
  doc.text('Next-day slots \u00B7 Fast & reliable \u00B7 Fully insured', 14, footerY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(WHITE);
  doc.text('07449 501 762  |  info@handyservices.co.uk', pageWidth - 14, footerY + 10, { align: 'right' });

  // =========================================
  // SAVE
  // =========================================
  const filename = data.sections.length === 1
    ? `Invoice_${data.sections[0].invoiceNumber}.pdf`
    : `Invoice_${data.customerName.replace(/\s+/g, '_')}_${formatDateShort(data.invoiceDate)}.pdf`;

  doc.save(filename);
}

// Helpers
function formatPence(pence: number): string {
  return '\u00A3' + (pence / 100).toFixed(2);
}

function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'd MMMM yyyy');
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yyyy-MM-dd');
  } catch {
    return dateStr;
  }
}
