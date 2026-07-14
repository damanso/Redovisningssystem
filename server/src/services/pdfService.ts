import PDFDocument from 'pdfkit';
import { formatOre, type Ore } from '../domain/money.js';

// Skördad och moderniserad från den gamla koden: en A4-faktura-PDF. Skillnader:
// belopp i heltal ören (aldrig float), Bankgiro/Plusgiro faktiskt med i schemat
// och på PDF:en (gamla saknade bank_account helt → tom betalinfo), och ingen
// skrivning till disk här (anroparen lagrar via fileStorage).

export interface InvoicePdfCompany {
  name: string;
  org_number: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  bankgiro: string | null;
  plusgiro: string | null;
  bank_account: string | null;
  iban: string | null;
  approved_for_f_tax?: boolean;
}
export interface InvoicePdfCustomer {
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  org_number?: string | null;
  vat_number?: string | null;
}
export interface InvoicePdfLine {
  description: string;
  quantity: string;
  unit: string;
  unit_price_ore: Ore;
  vat_rate: number;
  line_net_ore: Ore;
}
export interface InvoicePdfData {
  company: InvoicePdfCompany;
  customer: InvoicePdfCustomer;
  invoice: {
    invoice_number: number;
    invoice_date: string;
    due_date: string;
    ocr: string | null;
    reference: string | null;
    reverse_charge?: boolean;
    housework_type?: 'rot' | 'rut' | null;
    labor_cost_ore?: Ore | null;
    housework_reduction_ore?: Ore;
    buyer_personnummer?: string | null;
    property_designation?: string | null;
  };
  lines: InvoicePdfLine[];
  totals: { subtotal_ore: Ore; vat_ore: Ore; total_ore: Ore };
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      // Okomprimerad ström: fakturor är små och en inspekterbar PDF gör
      // betalinformationen (bankgiro m.m.) verifierbar i det producerade dokumentet.
      compress: false,
      info: { Title: `Faktura ${data.invoice.invoice_number}`, Author: data.company.name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { company, customer, invoice, lines, totals } = data;

    // Avsändare
    doc.fontSize(20).font('Helvetica-Bold').text(company.name, 50, 50);
    doc.fontSize(9).font('Helvetica');
    let y = 75;
    for (const line of [
      company.address,
      [company.postal_code, company.city].filter(Boolean).join(' ') || null,
      company.org_number ? `Org.nr: ${company.org_number}` : null,
      company.vat_number ? `Moms-nr: ${company.vat_number}` : null,
      company.email,
      company.phone,
      company.approved_for_f_tax ? 'Godkänd för F-skatt' : null,
    ]) {
      if (line) { doc.text(line, 50, y); y += 12; }
    }

    // Fakturarubrik + metadata
    doc.fontSize(18).font('Helvetica-Bold').text('FAKTURA', 400, 50, { width: 145, align: 'right' });
    doc.fontSize(9).font('Helvetica');
    let ry = 78;
    const meta: [string, string][] = [
      ['Fakturanr:', String(invoice.invoice_number)],
      ['Fakturadatum:', invoice.invoice_date],
      ['Förfallodatum:', invoice.due_date],
    ];
    if (invoice.ocr) meta.push(['OCR-nummer:', invoice.ocr]);
    if (invoice.reference) meta.push(['Referens:', invoice.reference]);
    for (const [label, value] of meta) {
      doc.font('Helvetica').text(label, 350, ry, { width: 90, align: 'right' });
      doc.font('Helvetica-Bold').text(value, 445, ry, { width: 100, align: 'right' });
      ry += 14;
    }

    // Mottagare
    doc.fontSize(9).font('Helvetica-Bold').text('Faktureras till:', 50, 150);
    doc.font('Helvetica');
    let cy = 164;
    for (const line of [
      customer.name,
      customer.address,
      [customer.postal_code, customer.city].filter(Boolean).join(' ') || null,
      customer.org_number ? `Org.nr: ${customer.org_number}` : null,
      invoice.reverse_charge && customer.vat_number ? `Moms-nr: ${customer.vat_number}` : null,
    ]) {
      if (line) { doc.text(line, 50, cy); cy += 12; }
    }

    // Radtabell
    const tableTop = Math.max(cy, ry) + 25;
    const cols = { desc: 50, qty: 300, price: 350, vat: 420, amount: 470 };
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Beskrivning', cols.desc, tableTop);
    doc.text('Antal', cols.qty, tableTop, { width: 45, align: 'right' });
    doc.text('À-pris', cols.price, tableTop, { width: 60, align: 'right' });
    doc.text('Moms%', cols.vat, tableTop, { width: 45, align: 'right' });
    doc.text('Belopp', cols.amount, tableTop, { width: 75, align: 'right' });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).stroke();

    doc.font('Helvetica');
    let ly = tableTop + 20;
    for (const line of lines) {
      doc.text(line.description, cols.desc, ly, { width: 240 });
      doc.text(`${line.quantity} ${line.unit}`, cols.qty, ly, { width: 45, align: 'right' });
      doc.text(formatOre(line.unit_price_ore), cols.price, ly, { width: 60, align: 'right' });
      doc.text(`${line.vat_rate}%`, cols.vat, ly, { width: 45, align: 'right' });
      doc.text(formatOre(line.line_net_ore), cols.amount, ly, { width: 75, align: 'right' });
      ly += 16;
    }
    doc.moveTo(50, ly + 2).lineTo(545, ly + 2).stroke();

    // Summering
    let ty = ly + 12;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, 350, ty, { width: 90, align: 'right' });
      doc.text(value, 445, ty, { width: 100, align: 'right' });
      ty += 16;
    };
    totalRow('Delsumma exkl. moms:', `${formatOre(totals.subtotal_ore)} SEK`);
    totalRow('Moms:', `${formatOre(totals.vat_ore)} SEK`);
    // ROT/RUT: visa fakturans totalbelopp, avdraget och vad kunden faktiskt betalar.
    const reduction = invoice.housework_reduction_ore ?? 0;
    if (invoice.housework_type && reduction > 0) {
      totalRow('Fakturabelopp:', `${formatOre(totals.total_ore)} SEK`);
      const label = invoice.housework_type === 'rot' ? 'ROT-avdrag:' : 'RUT-avdrag:';
      totalRow(label, `−${formatOre(reduction)} SEK`);
      ty += 4;
      doc.fontSize(11);
      totalRow('Att betala:', `${formatOre(totals.total_ore - reduction)} SEK`, true);
      doc.fontSize(9);
    } else {
      ty += 4;
      doc.fontSize(11);
      totalRow('Att betala:', `${formatOre(totals.total_ore)} SEK`, true);
      doc.fontSize(9);
    }

    // ROT/RUT: obligatoriska uppgifter + hänvisning till fakturamodellen.
    if (invoice.housework_type && reduction > 0) {
      ty += 12;
      const rc = invoice.housework_type === 'rot' ? 'ROT' : 'RUT';
      doc.font('Helvetica-Bold').text(`Husavdrag (${rc})`, 50, ty);
      ty += 13;
      doc.font('Helvetica');
      for (const line of [
        invoice.labor_cost_ore ? `Arbetskostnad (inkl. moms): ${formatOre(invoice.labor_cost_ore)} SEK` : null,
        invoice.buyer_personnummer ? `Köparens personnummer: ${invoice.buyer_personnummer}` : null,
        invoice.property_designation ? `Fastighetsbeteckning: ${invoice.property_designation}` : null,
        'Skattereduktionen begärs av utföraren hos Skatteverket (fakturamodellen).',
      ]) {
        if (line) { doc.text(line, 50, ty, { width: 460 }); ty += 12; }
      }
      ty += 12;
    }

    // Omvänd skattskyldighet: lagstadgad hänvisning på fakturan (moms redovisas
    // av köparen, ingen moms debiteras).
    if (invoice.reverse_charge) {
      ty += 12;
      doc.font('Helvetica-Bold').fillColor('#000').text('Omvänd betalningsskyldighet', 50, ty);
      ty += 13;
      doc.font('Helvetica').text('Omvänd skattskyldighet gäller — köparen redovisar och betalar momsen. Ingen moms har debiterats på denna faktura.', 50, ty, { width: 400 });
      ty += 26;
    }

    // Betalinformation
    ty += 20;
    doc.font('Helvetica-Bold').fontSize(10).text('Betalningsinformation', 50, ty);
    ty += 16;
    doc.font('Helvetica').fontSize(9);
    const payment: [string, string | null][] = [
      ['Bankgiro:', company.bankgiro],
      ['Plusgiro:', company.plusgiro],
      ['Bankkonto:', company.bank_account],
      ['IBAN:', company.iban],
      ['OCR-nummer:', invoice.ocr],
      ['Förfallodatum:', invoice.due_date],
      ['Att betala:', `${formatOre(totals.total_ore)} SEK`],
    ];
    for (const [label, value] of payment) {
      if (value) {
        doc.font('Helvetica').text(label, 50, ty, { width: 90 });
        doc.font('Helvetica-Bold').text(value, 145, ty);
        ty += 13;
      }
    }

    doc.end();
  });
}
