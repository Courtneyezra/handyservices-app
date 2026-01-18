import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

interface InvoiceData {
    invoiceNumber: string;
    date: Date;
    customerName: string;
    customerAddress: string;
    items: Array<{ description: string; quantity: number; price: number }>;
    total: number;
    deposit?: number;
}

export const generateInvoicePDF = (data: InvoiceData) => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text('INVOICE', 14, 22);

    doc.setFontSize(10);
    doc.text(`Invoice #: ${data.invoiceNumber}`, 14, 30);
    doc.text(`Date: ${format(data.date, 'PPP')}`, 14, 35);

    // Business Info (Mock for now)
    doc.setFontSize(12);
    doc.text('Handy Services', 140, 22);
    doc.setFontSize(10);
    doc.text('123 High Street, London', 140, 28);
    doc.text('contact@handy.contractors', 140, 34);

    // Customer Info
    doc.text('Bill To:', 14, 50);
    doc.setFontSize(11);
    doc.text(data.customerName, 14, 56);
    doc.setFontSize(10);
    doc.text(data.customerAddress || 'No address provided', 14, 62);

    // Items Table
    const tableBody = data.items.map(item => [
        item.description,
        item.quantity,
        `£${(item.price / 100).toFixed(2)}`,
        `£${((item.price * item.quantity) / 100).toFixed(2)}`
    ]);

    autoTable(doc, {
        startY: 70,
        head: [['Description', 'Qty', 'Unit Price', 'Total']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [245, 158, 11] }, // Amber-500
    });

    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.text(`Total: £${(data.total / 100).toFixed(2)}`, 140, finalY);

    if (data.deposit) {
        doc.text(`Deposit Paid: £${(data.deposit / 100).toFixed(2)}`, 140, finalY + 6);
        doc.text(`Balance Due: £${((data.total - data.deposit) / 100).toFixed(2)}`, 140, finalY + 12);
    }

    // Save
    doc.save(`Invoice_${data.invoiceNumber}.pdf`);
};
