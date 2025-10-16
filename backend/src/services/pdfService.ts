import PDFDocument from 'pdfkit';
import { InvoicePDFData, PDFGenerationResult } from '../types/pdf.types.js';
import fs from 'fs';
import path from 'path';

// Use process.cwd() for more reliable path resolution across environments
const uploadsDir = path.join(process.cwd(), 'uploads/invoices');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Generate a professional Swedish invoice PDF
 */
export const generateInvoicePDF = async (
  data: InvoicePDFData
): Promise<PDFGenerationResult> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Faktura ${data.invoice.invoice_number}`,
          Author: data.company.name,
          Subject: 'Faktura',
          Keywords: 'invoice, faktura'
        }
      });

      const chunks: Buffer[] = [];
      const fileName = `${data.invoice.invoice_number.replace(/\//g, '-')}.pdf`;
      const filePath = path.join(uploadsDir, fileName);

      // Collect PDF data
      doc.on('data', (chunk) => chunks.push(chunk));

      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);

        // Save to file
        fs.writeFileSync(filePath, pdfBuffer);

        resolve({
          filePath,
          fileName,
          buffer: pdfBuffer
        });
      });

      doc.on('error', (error) => {
        reject(error);
      });

      // === HEADER SECTION ===
      // Company name - large and bold
      doc.fontSize(22)
         .font('Helvetica-Bold')
         .text(data.company.name, 50, 50);

      // Company details
      doc.fontSize(10)
         .font('Helvetica');

      let yPos = 80;
      if (data.company.address) {
        doc.text(data.company.address, 50, yPos);
        yPos += 15;
      }
      if (data.company.postal_code && data.company.city) {
        doc.text(`${data.company.postal_code} ${data.company.city}`, 50, yPos);
        yPos += 15;
      }
      doc.text(`Org.nr: ${data.company.org_number}`, 50, yPos);
      yPos += 15;

      if (data.company.vat_number) {
        doc.text(`VAT: ${data.company.vat_number}`, 50, yPos);
        yPos += 15;
      }
      if (data.company.phone) {
        doc.text(`Tel: ${data.company.phone}`, 50, yPos);
        yPos += 15;
      }
      if (data.company.email) {
        doc.text(`E-post: ${data.company.email}`, 50, yPos);
        yPos += 15;
      }
      if (data.company.website) {
        doc.text(data.company.website, 50, yPos);
        yPos += 15;
      }

      // === INVOICE TITLE ===
      doc.fontSize(28)
         .font('Helvetica-Bold')
         .text('FAKTURA', 380, 50);

      // === INVOICE DETAILS (Right side) ===
      doc.fontSize(10)
         .font('Helvetica');

      let rightYPos = 90;
      doc.text('Fakturanummer:', 380, rightYPos);
      doc.font('Helvetica-Bold').text(data.invoice.invoice_number, 480, rightYPos);
      rightYPos += 18;

      doc.font('Helvetica').text('Fakturadatum:', 380, rightYPos);
      doc.font('Helvetica-Bold').text(data.invoice.invoice_date, 480, rightYPos);
      rightYPos += 18;

      doc.font('Helvetica').text('Förfallodatum:', 380, rightYPos);
      doc.font('Helvetica-Bold').text(data.invoice.due_date, 480, rightYPos);
      rightYPos += 18;

      doc.font('Helvetica').text('OCR-nummer:', 380, rightYPos);
      doc.font('Helvetica-Bold').text(data.invoice.ocr_number, 480, rightYPos);
      rightYPos += 18;

      if (data.invoice.reference) {
        doc.font('Helvetica').text('Er referens:', 380, rightYPos);
        doc.font('Helvetica-Bold').text(data.invoice.reference, 480, rightYPos);
        rightYPos += 18;
      }

      // === CUSTOMER SECTION ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Fakturamottagare:', 50, 200);

      doc.fontSize(10)
         .font('Helvetica')
         .text(data.customer.name, 50, 220);

      let custYPos = 235;
      if (data.customer.address) {
        doc.text(data.customer.address, 50, custYPos);
        custYPos += 15;
      }
      if (data.customer.postal_code && data.customer.city) {
        doc.text(`${data.customer.postal_code} ${data.customer.city}`, 50, custYPos);
        custYPos += 15;
      }
      if (data.customer.org_number) {
        doc.text(`Org.nr: ${data.customer.org_number}`, 50, custYPos);
        custYPos += 15;
      }

      // === TABLE HEADER ===
      const tableTop = 320;
      const descriptionX = 50;
      const quantityX = 280;
      const unitX = 330;
      const priceX = 380;
      const vatX = 440;
      const amountX = 490;

      // Draw table header background
      doc.rect(50, tableTop - 5, 510, 25)
         .fillAndStroke('#f0f0f0', '#000000');

      doc.fillColor('#000000')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('Beskrivning', descriptionX + 5, tableTop + 5)
         .text('Antal', quantityX, tableTop + 5, { width: 40, align: 'right' })
         .text('Enhet', unitX, tableTop + 5)
         .text('à-pris', priceX, tableTop + 5, { width: 50, align: 'right' })
         .text('Moms%', vatX, tableTop + 5, { width: 40, align: 'right' })
         .text('Belopp', amountX, tableTop + 5, { width: 60, align: 'right' });

      // === TABLE ROWS ===
      let rowYPos = tableTop + 35;

      doc.font('Helvetica').fontSize(9);

      data.lines.forEach((line, index) => {
        // Alternate row coloring
        if (index % 2 === 0) {
          doc.rect(50, rowYPos - 5, 510, 25).fillOpacity(0.05).fill('#cccccc');
          doc.fillOpacity(1);
        }

        doc.fillColor('#000000')
           .text(line.description, descriptionX + 5, rowYPos, { width: 220 })
           .text(line.quantity.toString(), quantityX, rowYPos, { width: 40, align: 'right' })
           .text(line.unit, unitX, rowYPos)
           .text(line.unit_price.toFixed(2), priceX, rowYPos, { width: 50, align: 'right' })
           .text(line.vat_rate.toFixed(0) + '%', vatX, rowYPos, { width: 40, align: 'right' })
           .text(line.amount.toFixed(2), amountX, rowYPos, { width: 60, align: 'right' });

        rowYPos += 30;

        // Check if we need a new page
        if (rowYPos > 650) {
          doc.addPage();
          rowYPos = 50;
        }
      });

      // === TOTALS SECTION ===
      rowYPos += 10;

      // Draw separator line
      doc.moveTo(50, rowYPos)
         .lineTo(560, rowYPos)
         .stroke();

      rowYPos += 20;

      doc.fontSize(10).font('Helvetica');

      // Subtotal
      doc.text('Delsumma exkl. moms:', 380, rowYPos);
      doc.font('Helvetica-Bold')
         .text(`${data.totals.subtotal.toFixed(2)} SEK`, 490, rowYPos, { width: 70, align: 'right' });
      rowYPos += 20;

      // VAT
      doc.font('Helvetica')
         .text('Moms:', 380, rowYPos);
      doc.font('Helvetica-Bold')
         .text(`${data.totals.vat_amount.toFixed(2)} SEK`, 490, rowYPos, { width: 70, align: 'right' });
      rowYPos += 25;

      // Total
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('ATT BETALA:', 380, rowYPos);
      doc.fontSize(14)
         .text(`${data.totals.total_amount.toFixed(2)} SEK`, 490, rowYPos, { width: 70, align: 'right' });

      rowYPos += 40;

      // === PAYMENT INFORMATION ===
      if (data.company.bank_account || data.invoice.ocr_number) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Betalningsinformation:', 50, rowYPos);

        rowYPos += 20;
        doc.fontSize(10).font('Helvetica');

        if (data.company.bank_account) {
          doc.text(`Bankgiro/Plusgiro: ${data.company.bank_account}`, 50, rowYPos);
          rowYPos += 15;
        }

        doc.text(`OCR-nummer: ${data.invoice.ocr_number}`, 50, rowYPos);
        rowYPos += 15;
        doc.text(`Förfallodatum: ${data.invoice.due_date}`, 50, rowYPos);
        rowYPos += 20;
      }

      // === NOTES ===
      if (data.invoice.notes) {
        doc.fontSize(10)
           .font('Helvetica-Oblique')
           .text(data.invoice.notes, 50, rowYPos, { width: 500 });
        rowYPos += 30;
      }

      // === FOOTER ===
      const footerY = 750;
      doc.fontSize(8)
         .font('Helvetica')
         .fillColor('#666666')
         .text('Fakturan är skapad digitalt och godkänd utan underskrift.', 50, footerY, {
           width: 500,
           align: 'center'
         });

      // Finish PDF
      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Delete a PDF file
 */
export const deletePDF = (fileName: string): boolean => {
  try {
    const filePath = path.join(uploadsDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Delete PDF error:', error);
    return false;
  }
};

/**
 * Get PDF file path
 */
export const getPDFPath = (fileName: string): string => {
  return path.join(uploadsDir, fileName);
};
