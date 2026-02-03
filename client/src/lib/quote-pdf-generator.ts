import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { applyPsychologicalPricing } from '@/components/quote/SchedulingConfig';

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

export const generateQuotePDF = (data: QuotePDFData) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Apply psychological pricing
  const adjustedPrice = applyPsychologicalPricing(data.priceInPence);
  const priceDisplay = `£${Math.round(adjustedPrice / 100)}`;

  // Colors
  const brandGreen = [125, 176, 14] as [number, number, number]; // #7DB00E
  const darkGrey = [30, 41, 59] as [number, number, number]; // slate-800
  const lightGrey = [148, 163, 184] as [number, number, number]; // slate-400

  // Header - Green bar
  doc.setFillColor(...brandGreen);
  doc.rect(0, 0, pageWidth, 35, 'F');

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Handy Services', 14, 22);

  // Quote label
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('QUOTATION', pageWidth - 14, 22, { align: 'right' });

  // Quote details section
  doc.setTextColor(...darkGrey);
  doc.setFontSize(10);

  let yPos = 50;

  // Quote reference and date
  doc.setFont('helvetica', 'bold');
  doc.text('Quote Reference:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`#${data.quoteId.slice(0, 8).toUpperCase()}`, 60, yPos);

  doc.setFont('helvetica', 'bold');
  doc.text('Date:', pageWidth - 80, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(format(data.createdAt || new Date(), 'dd MMM yyyy'), pageWidth - 60, yPos);

  yPos += 8;

  doc.setFont('helvetica', 'bold');
  doc.text('Valid for:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.validityHours || 48} hours`, 60, yPos);

  // Customer details box
  yPos += 20;
  doc.setDrawColor(...lightGrey);
  doc.setLineWidth(0.5);
  doc.roundedRect(14, yPos, pageWidth - 28, 35, 3, 3, 'S');

  yPos += 8;
  doc.setTextColor(...brandGreen);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED FOR', 20, yPos);

  yPos += 8;
  doc.setTextColor(...darkGrey);
  doc.setFontSize(12);
  doc.text(data.customerName || 'Valued Customer', 20, yPos);

  yPos += 7;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...lightGrey);
  const addressText = data.address || data.postcode || 'Address on file';
  doc.text(addressText, 20, yPos);

  // Scope of works
  yPos += 25;
  doc.setTextColor(...brandGreen);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('SCOPE OF WORKS', 14, yPos);

  yPos += 8;
  doc.setTextColor(...darkGrey);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');

  // Wrap job description text
  const maxWidth = pageWidth - 28;
  const lines = doc.splitTextToSize(data.jobDescription || 'As discussed', maxWidth);
  doc.text(lines, 14, yPos);
  yPos += lines.length * 6 + 10;

  // Price box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(14, yPos, pageWidth - 28, 45, 3, 3, 'F');

  yPos += 12;
  doc.setTextColor(...brandGreen);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('YOUR QUOTE', 20, yPos);

  yPos += 15;
  doc.setTextColor(...darkGrey);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(priceDisplay, 20, yPos);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...lightGrey);
  doc.text('All-inclusive, no hidden fees', 20, yPos + 10);

  // What's included
  yPos += 35;
  doc.setTextColor(...brandGreen);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text("WHAT'S INCLUDED", 14, yPos);

  yPos += 8;
  doc.setTextColor(...darkGrey);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const inclusions = [
    '✓ Quality workmanship',
    '✓ Full cleanup on completion',
    '✓ Workmanship guarantee',
    '✓ Vetted & insured tradesperson',
  ];

  inclusions.forEach((item) => {
    doc.text(item, 20, yPos);
    yPos += 6;
  });

  // Footer
  yPos = 260;
  doc.setDrawColor(...lightGrey);
  doc.setLineWidth(0.3);
  doc.line(14, yPos, pageWidth - 14, yPos);

  yPos += 8;
  doc.setFontSize(9);
  doc.setTextColor(...lightGrey);
  doc.text('Questions? Reply to this quote or call us directly.', 14, yPos);
  doc.text('www.handy.contractors', pageWidth - 14, yPos, { align: 'right' });

  yPos += 6;
  doc.setFontSize(8);
  doc.text('This quote is valid for 48 hours from the date above.', 14, yPos);

  // Save
  const filename = `Quote_${data.quoteId.slice(0, 8).toUpperCase()}_${data.customerName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
};
