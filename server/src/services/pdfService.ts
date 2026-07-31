import PDFDocument from 'pdfkit';
import { formatOre, type Ore } from '../domain/money.js';

// Fakturamallen är porterad 1:1 från Locollabs riktiga, skickade faktura
// (0000024, juni 2026) — INTE från gamla systemets layout. Kännetecken:
// "Från"-block uppe till vänster, logotyp uppe till höger, stor "Faktura"-
// rubrik, "Fakturaadress"-block till höger, metadatakolumn (OCR, datum,
// leveranstidpunkt, Betalas till, fakturanummer 7 siffror, referenser,
// IBAN, BIC/Swift), radtabell Kvantitet/Beskrivning/Pris/Totalt och sidfot
// i fyra kolumner. Belopp i heltal ören, svenskt format ("114 603,00 SEK").
// ROT/RUT-blocket och hänvisningen vid omvänd skattskyldighet är lagkrav
// och behålls under summeringen även om mallfakturan inte hade dem.

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
  bic: string | null;
  website: string | null;
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
export interface InvoicePdfAppendixRow {
  entry_date: string;
  description: string;
  /** Tidsbilaga: heltal minuter (0,42 h = 25 min). */
  minutes: number | null;
  /** Utläggsbilaga: heltal ören. */
  amount_ore: number | null;
}
export interface InvoicePdfAppendix {
  kind: 'time' | 'expense';
  title: string | null;
  preamble: string | null;
  notes: string | null;
  rows: InvoicePdfAppendixRow[];
  total_minutes: number;
  total_amount_ore: number;
}

export interface InvoicePdfData {
  company: InvoicePdfCompany;
  customer: InvoicePdfCustomer;
  invoice: {
    /** Numret KUNDEN ser (externt när det finns, annars systemets egna). */
    invoice_number: number;
    invoice_date: string;
    due_date: string;
    ocr: string | null;
    reference: string | null;
    our_reference?: string | null;
    delivery_period?: string | null;
    reverse_charge?: boolean;
    housework_type?: 'rot' | 'rut' | null;
    labor_cost_ore?: Ore | null;
    housework_reduction_ore?: Ore;
    buyer_personnummer?: string | null;
    property_designation?: string | null;
  };
  lines: InvoicePdfLine[];
  totals: { subtotal_ore: Ore; vat_ore: Ore; total_ore: Ore };
  /** Bolagets logotyp (PNG/JPEG) — visas uppe till höger när den finns. */
  logo?: Buffer;
  /** Bilaga på sida 2 (tids- eller utläggsspecifikation) när fakturan har en. */
  appendix?: InvoicePdfAppendix;
}

/** Minuter → svenska timmar med två decimaler ("25" → "0,42", "1885" → "31,42"). */
function hours(minutes: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(minutes / 60);
}

const GRAY = '#555555';
const BLACK = '#000000';

function sek(ore: Ore): string {
  return `${formatOre(ore)} SEK`;
}

/** "91.000" → "91", "2.500" → "2,5" — mallen skriver antal utan onödiga nollor. */
function formatQuantity(quantity: string): string {
  const n = Number(quantity);
  if (!Number.isFinite(n)) return quantity;
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 3 });
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
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
    const left = 70;
    const right = 525;

    // Från-blocket (uppe till vänster).
    doc.fontSize(8.5).font('Helvetica').fillColor(GRAY).text('Från', left, 78);
    doc.fontSize(10).fillColor(BLACK);
    let fy = 92;
    for (const line of [
      company.name,
      company.address,
      [company.postal_code, company.city].filter(Boolean).join(' ') || null,
    ]) {
      if (line) { doc.text(line, left, fy); fy += 14; }
    }

    // Logotyp uppe till höger (proportionerna bevaras inom rutan).
    if (data.logo) {
      try {
        doc.image(data.logo, 415, 28, { fit: [115, 135], align: 'right' });
      } catch {
        // En trasig bildfil får aldrig stoppa fakturan — PDF:en renderas utan logotyp.
      }
    }

    // Fakturaadress-blocket (till höger, under logotypen).
    doc.fontSize(8.5).fillColor(GRAY).text('Fakturaadress', 355, 175);
    doc.fontSize(10).fillColor(BLACK);
    let cy = 189;
    for (const line of [
      customer.name,
      customer.address,
      [customer.postal_code, customer.city].filter(Boolean).join(' ') || null,
      // Vid omvänd skattskyldighet SKA köparen kunna identifieras på fakturan.
      invoice.reverse_charge ? (customer.org_number ? `Org.nr: ${customer.org_number}` : null) : null,
      invoice.reverse_charge && customer.vat_number ? `Moms-nr: ${customer.vat_number}` : null,
    ]) {
      if (line) { doc.text(line, 355, cy, { width: right - 355 }); cy += 14; }
    }

    // Stora rubriken.
    doc.fontSize(30).font('Helvetica-Bold').text('Faktura', left, 182);

    // Metadatakolumnen (etikett vänster, värde vid fast x).
    const paymentTarget = company.bankgiro
      ? `Bankgiro ${company.bankgiro}`
      : company.plusgiro
        ? `Plusgiro ${company.plusgiro}`
        : company.bank_account
          ? `Bankkonto ${company.bank_account}`
          : null;
    const dueDays = daysBetween(invoice.invoice_date, invoice.due_date);
    const meta: [string, string][] = [];
    if (invoice.ocr) meta.push(['OCR-nummer', invoice.ocr]);
    meta.push(['Fakturadatum', invoice.invoice_date]);
    meta.push(['Förfallodatum', `${invoice.due_date}${dueDays > 0 ? ` (${dueDays} dagar)` : ''}`]);
    if (invoice.delivery_period) meta.push(['Leveranstidpunkt', invoice.delivery_period]);
    if (paymentTarget) meta.push(['Betalas till', paymentTarget]);
    meta.push(['Fakturanummer', String(invoice.invoice_number).padStart(7, '0')]);
    if (invoice.our_reference) meta.push(['Vår referens', invoice.our_reference]);
    if (invoice.reference) meta.push(['Er referens', invoice.reference]);
    if (company.iban) meta.push(['IBAN', company.iban]);
    if (company.bic) meta.push(['BIC/Swift', company.bic]);

    let my = Math.max(250, cy + 20);
    doc.fontSize(9.5);
    for (const [label, value] of meta) {
      doc.font('Helvetica').fillColor(GRAY).text(label, left, my);
      doc.fillColor(BLACK).text(value, 190, my);
      my += 14;
    }

    // Radtabellen: Kvantitet | Beskrivning | Pris | Totalt. Pris-kolumnen
    // slutar vid priceRight och Totalt-kolumnen börjar FÖRST vid totalLeft —
    // ett fast mellanrum så beloppen aldrig kolliderar på breda rader.
    const tableTop = my + 24;
    const xDesc = 155;
    const priceRight = 435; // högerkant för priskolumnen
    const totalLeft = 443;  // vänsterkant för totalkolumnen (right = högerkant)
    const descWidth = priceRight - 105 - xDesc;
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('Kvantitet', left, tableTop);
    doc.text('Beskrivning', xDesc, tableTop);
    doc.text('Pris', priceRight - 105, tableTop, { width: 105, align: 'right' });
    doc.text('Totalt', totalLeft, tableTop, { width: right - totalLeft, align: 'right' });
    doc.moveTo(left, tableTop + 13).lineTo(right, tableTop + 13).lineWidth(0.7).stroke();

    doc.font('Helvetica');
    let ly = tableTop + 21;
    for (const line of lines) {
      // Timpriser skrivs "1 100,00 SEK/h" — styckpriser utan enhetssuffix.
      const priceSuffix = line.unit && line.unit !== 'st' ? `/${line.unit}` : '';
      const descHeight = doc.heightOfString(line.description, { width: descWidth });
      doc.text(`${formatQuantity(line.quantity)} ${line.unit}`, left, ly);
      doc.text(line.description, xDesc, ly, { width: descWidth });
      doc.text(`${sek(line.unit_price_ore)}${priceSuffix}`, priceRight - 105, ly, { width: 105, align: 'right' });
      doc.text(sek(line.line_net_ore), totalLeft, ly, { width: right - totalLeft, align: 'right' });
      ly += Math.max(16, descHeight + 4);
    }

    // Summeringen (högerställd: etikett + belopp, samma kolumngräns som tabellen).
    let ty = ly + 16;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, priceRight - 160, ty, { width: 160, align: 'right' });
      doc.text(value, totalLeft, ty, { width: right - totalLeft, align: 'right' });
      ty += 16;
    };
    totalRow('Exklusive moms', sek(totals.subtotal_ore));
    // En momsrad per förekommande sats (mallen: "Moms (25%)").
    const rates = [...new Set(lines.map((l) => l.vat_rate))].sort((a, b) => b - a);
    if (rates.length === 1) {
      totalRow(`Moms (${rates[0]}%)`, sek(totals.vat_ore));
    } else {
      totalRow('Moms', sek(totals.vat_ore));
    }
    const reduction = invoice.housework_reduction_ore ?? 0;
    if (invoice.housework_type && reduction > 0) {
      totalRow('Fakturabelopp', sek(totals.total_ore));
      totalRow(invoice.housework_type === 'rot' ? 'ROT-avdrag' : 'RUT-avdrag', `−${sek(reduction)}`);
      totalRow('Att betala', sek(totals.total_ore - reduction), true);
    } else {
      totalRow('Att betala', sek(totals.total_ore), true);
    }

    // ROT/RUT: obligatoriska uppgifter + hänvisning till fakturamodellen (lagkrav).
    if (invoice.housework_type && reduction > 0) {
      ty += 12;
      const rc = invoice.housework_type === 'rot' ? 'ROT' : 'RUT';
      doc.font('Helvetica-Bold').text(`Husavdrag (${rc})`, left, ty);
      ty += 13;
      doc.font('Helvetica');
      for (const line of [
        invoice.labor_cost_ore ? `Arbetskostnad (inkl. moms): ${sek(invoice.labor_cost_ore)}` : null,
        invoice.buyer_personnummer ? `Köparens personnummer: ${invoice.buyer_personnummer}` : null,
        invoice.property_designation ? `Fastighetsbeteckning: ${invoice.property_designation}` : null,
        'Skattereduktionen begärs av utföraren hos Skatteverket (fakturamodellen).',
      ]) {
        if (line) { doc.text(line, left, ty, { width: 440 }); ty += 12; }
      }
    }

    // Omvänd skattskyldighet: lagstadgad hänvisning på fakturan.
    if (invoice.reverse_charge) {
      ty += 12;
      doc.font('Helvetica-Bold').text('Omvänd betalningsskyldighet', left, ty);
      ty += 13;
      doc.font('Helvetica').text('Omvänd skattskyldighet gäller — köparen redovisar och betalar momsen. Ingen moms har debiterats på denna faktura.', left, ty, { width: 400 });
    }

    // Sidfoten: linje + fyra kolumner (bolag, momsreg/F-skatt, kontakt, hemsida/bankgiro).
    // En rad är antingen en grå etikett {label}, ett svart värde {value} eller
    // ett litet mellanrum (SPACER) mellan grupperna i samma kolumn.
    type FootRow = { label: string } | { value: string } | 'SPACER';
    const footTop = 745;
    doc.moveTo(left, footTop - 7).lineTo(right, footTop - 7).lineWidth(0.7).stroke();
    const footCol = (x: number, rows: FootRow[]) => {
      let yy = footTop;
      doc.fontSize(8).font('Helvetica');
      for (const row of rows) {
        if (row === 'SPACER') { yy += 4; continue; }
        if ('label' in row) doc.fillColor(GRAY).text(row.label, x, yy);
        else doc.fillColor(BLACK).text(row.value, x, yy);
        yy += 11;
      }
    };
    const group = (label: string, value: string | null): FootRow[] =>
      value ? [{ label }, { value }] : [];
    const withSpacer = (a: FootRow[], b: FootRow[]): FootRow[] =>
      a.length > 0 && b.length > 0 ? [...a, 'SPACER', ...b] : [...a, ...b];
    footCol(left, [
      { value: company.name },
      ...(company.address ? [{ value: company.address }] : []),
      ...([company.postal_code, company.city].filter(Boolean).join(' ')
        ? [{ value: [company.postal_code, company.city].filter(Boolean).join(' ') }]
        : []),
    ]);
    footCol(200, [
      ...group('Moms reg. nr.', company.vat_number),
      ...(company.approved_for_f_tax ? [{ value: 'Godkänd för F-skatt' }] : []),
    ]);
    footCol(330, withSpacer(group('Telefon', company.phone), group('E-post', company.email)));
    footCol(455, withSpacer(group('Hemsida', company.website), group('Bankgiro', company.bankgiro)));
    doc.fillColor(BLACK);

    // ---- Sida 2: bilagan (tids- eller utläggsspecifikation) ----
    // Mönster: faktura 0000027 (tid) resp. 0000024 (utlägg). Sida 2 har INGEN
    // logotyp — mallen släppte den i den nyare varianten (27).
    if (data.appendix && data.appendix.rows.length > 0) {
      const ap = data.appendix;
      doc.addPage();
      const invNo = String(invoice.invoice_number).padStart(7, '0');
      doc.fontSize(8.5).font('Helvetica').fillColor(BLACK)
        .text(`Tillhör faktura ${invNo} · ${company.name} · ${customer.name}`, left, 78);

      const isTime = ap.kind === 'time';
      doc.fontSize(20).font('Helvetica-Bold')
        .text(ap.title ?? (isTime ? 'Bilaga – tidsspecifikation' : 'Bilaga – specifikation av utlägg'), left, 108);

      let ay = 150;
      if (ap.preamble) {
        doc.fontSize(9.5).font('Helvetica').text(ap.preamble, left, ay, { width: right - left });
        ay += doc.heightOfString(ap.preamble, { width: right - left }) + 18;
      }

      // Tabellhuvud: Datum | Beskrivning | Timmar/SEK
      const axDesc = 155;
      const valueWidth = 90;
      const descWidth = right - valueWidth - 10 - axDesc;
      doc.fontSize(9.5).font('Helvetica-Bold');
      doc.text('Datum', left, ay);
      doc.text('Beskrivning', axDesc, ay);
      doc.text(isTime ? 'Timmar' : 'SEK', right - valueWidth, ay, { width: valueWidth, align: 'right' });
      ay += 13;
      doc.moveTo(left, ay).lineTo(right, ay).lineWidth(0.7).stroke();
      ay += 9;

      doc.font('Helvetica');
      for (const row of ap.rows) {
        const h = doc.heightOfString(row.description, { width: descWidth });
        // Ny sida om raden inte får plats ovanför sidfoten.
        if (ay + h > 760) {
          doc.addPage();
          ay = 78;
          doc.fontSize(8.5).text(`Tillhör faktura ${invNo} · ${company.name} · ${customer.name} (forts.)`, left, ay);
          ay += 26;
          doc.fontSize(9.5);
        }
        doc.text(row.entry_date, left, ay);
        doc.text(row.description, axDesc, ay, { width: descWidth });
        doc.text(
          isTime ? hours(row.minutes ?? 0) : formatOre(row.amount_ore ?? 0),
          right - valueWidth, ay, { width: valueWidth, align: 'right' },
        );
        ay += Math.max(14, h + 3);
      }

      ay += 3;
      doc.moveTo(left, ay).lineTo(right, ay).lineWidth(0.7).stroke();
      ay += 10;

      const sumRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(label, left, ay);
        doc.text(value, right - valueWidth, ay, { width: valueWidth, align: 'right' });
        ay += 15;
      };
      if (isTime) {
        sumRow('Summa fakturerbar tid', `${hours(ap.total_minutes)} h`, true);
      } else {
        // Vidarefakturerade utlägg summeras exkl./moms/inkl. — momssatsen tas
        // från fakturan när den är entydig (mönster: faktura 0000024, 25 %).
        const apRates = [...new Set(lines.map((l) => l.vat_rate))];
        sumRow('Summa utlägg exkl. moms', formatOre(ap.total_amount_ore));
        if (apRates.length === 1) {
          const rate = apRates[0]!;
          const vat = Math.round((ap.total_amount_ore * rate) / 100);
          sumRow(`Moms ${rate} % (vidarefakturering)`, formatOre(vat));
          sumRow('Summa utlägg inkl. moms', formatOre(ap.total_amount_ore + vat), true);
        }
      }

      if (ap.notes) {
        ay += 10;
        doc.fontSize(8).font('Helvetica').fillColor(GRAY)
          .text(ap.notes, left, ay, { width: right - left });
        doc.fillColor(BLACK);
      }
    }

    doc.end();
  });
}
