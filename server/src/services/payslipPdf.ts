// K3: lönespecifikationen som PDF enligt Locollabs befintliga mall (portad från
// Cowork-skillen lonespecifikation/skapa_lonespec.py): header, infoblock i två
// kolumner, tabell (Månadslön / ev. Semesterersättning / Prel skatt tabell),
// Brutto+Netto-rad, blocket «Ackumulerat {år}» och sidfot. Genereras ur
// systemets data och lagras i dokumentarkivet kopplad till lönebeskedet —
// ersätter den externa PDF:en i bokföringsmappen. Blocket visar fem belopp
// (bruttolön, skatt, nettolön, arbetsgivaravgift, semesterersättning) ur
// payrollYearSummary, samma funktion som payroll_year_summary (FR-16).
import PDFDocument from 'pdfkit';
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { linkDocument, type AttachedDocument } from './documents.js';
import { validateUpload, writeStoredFile, removeStoredFile } from './fileStorage.js';
import { payrollYearSummary } from './payroll.js';

// Mallens beloppsformat: mellanslag som tusentalsavgränsare, komma + 3 decimaler
// ("56 500,000"). Ören → kronor.
function kr(ore: number): string {
  const negative = ore < 0;
  const abs = Math.abs(ore);
  const whole = Math.floor(abs / 100);
  const decimals = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}${grouped},${decimals}0`;
}

function lastDayOfPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, '0')}`;
}

export interface PayslipPdfData {
  company: { name: string; org_number: string | null };
  employee: { name: string; personnummer: string | null; employment_type: string };
  payslip: {
    period: string;            // 'YYYY-MM'
    payment_date: string | null;
    gross_ore: number;
    vacation_pay_ore: number;
    tax_ore: number;
    net_ore: number;
    tax_source: string;
  };
  accumulated: {
    year: number;
    gross_ore: number;
    tax_ore: number;
    net_ore: number;
    employer_contribution_ore: number;
    vacation_pay_ore: number;
  };
  createdDate: string;         // 'YYYY-MM-DD'
}

export function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 50, compress: false,
      info: { Title: `Lönespecifikation ${data.payslip.period}`, Author: data.company.name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { company, employee, payslip } = data;
    const periodStart = `${payslip.period}-01`;
    const periodEnd = lastDayOfPeriod(payslip.period);
    const periodLabel = `${periodStart.replace(/-/g, '')} - ${periodEnd.replace(/-/g, '')}`;
    const baseSalary = payslip.gross_ore - payslip.vacation_pay_ore;
    const left = 57; // ~20 mm
    const right = 538;

    // Header
    doc.fontSize(13).font('Helvetica-Bold').text(company.name, left, 70);
    doc.fontSize(17).font('Helvetica-Bold').text('LÖNESPECIFIKATION', left, 96);

    // Infoblock: två kolumner (vänster person, höger bolag/period).
    const infoTop = 130;
    const lineH = 15;
    const drawInfo = (labelX: number, valueX: number, rows: [string, string][]) => {
      let yy = infoTop;
      for (const [label, value] of rows) {
        doc.fontSize(9).font('Helvetica').text(label, labelX, yy);
        doc.font('Helvetica-Bold').text(value, valueX, yy);
        yy += lineH;
      }
      return yy;
    };
    drawInfo(left, left + 85, [
      ['Namn', employee.name],
      ['Personnummer', employee.personnummer ?? '—'],
      ['Anställning', employee.employment_type],
    ]);
    drawInfo(left + 250, left + 350, [
      ['Org.nummer', company.org_number ?? '—'],
      ['Period', periodLabel],
      ['Utbetalningsdatum', (payslip.payment_date ?? '—').replace(/-/g, '')],
      // historical = tabell 30, fast fjolårets faktiskt tillämpade värde.
      ['Skattetabell', payslip.tax_source === 'table30' || payslip.tax_source === 'historical' ? '30' : payslip.tax_source === 'manual' ? 'Jämkning' : 'Platt sats'],
    ]);

    // Tabellhuvud
    let y = infoTop + 4 * lineH + 14;
    const xDat = 330, xAntal = 390, xApris = 460, xBelopp = right;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('BESKRIVNING', left, y);
    doc.text('DAT/ANM', xDat - 60, y, { width: 60, align: 'right' });
    doc.text('ANTAL', xAntal - 50, y, { width: 50, align: 'right' });
    doc.text('À-PRIS', xApris - 60, y, { width: 60, align: 'right' });
    doc.text('BELOPP', xBelopp - 75, y, { width: 75, align: 'right' });
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).stroke();
    y += 10;

    // Rader
    doc.font('Helvetica');
    const row = (desc: string, datAnm: string, antal: string, apris: string, belopp: string) => {
      doc.text(desc, left, y);
      if (datAnm) doc.text(datAnm, xDat - 90, y, { width: 90, align: 'right' });
      if (antal) doc.text(antal, xAntal - 50, y, { width: 50, align: 'right' });
      if (apris) doc.text(apris, xApris - 60, y, { width: 60, align: 'right' });
      doc.text(belopp, xBelopp - 90, y, { width: 90, align: 'right' });
      y += lineH;
    };
    row('Månadslön', `${periodStart.slice(5).replace('-', '')}-${periodEnd.slice(5).replace('-', '')}`, '1,000', kr(baseSalary), kr(baseSalary));
    if (payslip.vacation_pay_ore > 0) row('Semesterersättning', '', '', '', kr(payslip.vacation_pay_ore));
    row('Prel skatt tabell', `(${kr(payslip.gross_ore)})`, '', '', kr(-payslip.tax_ore));

    y += 2;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).stroke();
    y += 16;

    // Brutto / Netto
    doc.fontSize(10).font('Helvetica-Bold').text('Bruttolön', left, y);
    doc.font('Helvetica').text(kr(payslip.gross_ore), left + 80, y);
    doc.font('Helvetica-Bold').text('Nettolön', left + 250, y);
    doc.font('Helvetica').text(kr(payslip.net_ore), xBelopp - 90, y, { width: 90, align: 'right' });
    y += 24;

    // Ackumulerat (kalenderår, t.o.m. denna period): fem belopp ur
    // payrollYearSummary (FR-16) i två kolumner, eftersom «Ack.
    // Arbetsgivaravgift» inte ryms i den gamla radens 70 punkter. Varje belopp
    // ritas direkt efter sin etikett, så att texten står i par i filen.
    const acc = data.accumulated;
    doc.fontSize(9).font('Helvetica-Bold').text(`Ackumulerat ${acc.year}`, left, y);
    const accPair = (label: string, ore: number, labelX: number, amountX: number) => {
      doc.font('Helvetica').text(label, labelX, y);
      doc.font('Helvetica-Bold').text(kr(ore), amountX, y, { width: 90, align: 'right' });
    };
    for (const [leftLabel, leftOre, rightLabel, rightOre] of [
      ['Ack. Bruttolön', acc.gross_ore, 'Ack. Skatt', acc.tax_ore],
      ['Ack. Nettolön', acc.net_ore, 'Ack. Arbetsgivaravgift', acc.employer_contribution_ore],
      ['Ack. Semesterersättning', acc.vacation_pay_ore, 'Ack. Förmån', 0],
    ] as const) {
      y += lineH;
      accPair(leftLabel, leftOre, left, left + 140);
      accPair(rightLabel, rightOre, left + 250, xBelopp - 90);
    }

    // Sidfot
    doc.fontSize(7.5).font('Helvetica-Oblique');
    doc.text(`${company.name} · Org.nr ${company.org_number ?? '—'} · Lönespecifikation period ${periodLabel}`, left, 790);
    doc.text(`Skapad ${data.createdDate}`, xBelopp - 150, 790, { width: 150, align: 'right' });

    doc.end();
  });
}

/**
 * Genererar lönespec-PDF:en för ett lönebesked, lagrar den i dokumentarkivet
 * och kopplar den till lönebeskedet (documents). Körs om → ny fil kopplas
 * (historiken bevaras i arkivet).
 */
export async function generateAndAttachPayslipPdf(
  client: PoolClient, companyId: string, userId: string, payslipId: string, createdDate: string,
): Promise<AttachedDocument> {
  const r = await client.query<{
    employee_id: string;
    period: string; payment_date: string | null; gross_ore: string; vacation_pay_ore: string;
    tax_ore: string; net_ore: string; tax_source: string;
    employee_name: string; personnummer: string | null; employment_type: string;
    company_name: string; org_number: string | null;
  }>(
    `SELECT p.employee_id, p.period, p.payment_date::text, p.gross_ore, p.vacation_pay_ore, p.tax_ore, p.net_ore, p.tax_source,
            e.name AS employee_name, e.personnummer, e.employment_type,
            c.name AS company_name, c.org_number
     FROM payslips p
     JOIN employees e ON e.id = p.employee_id
     JOIN companies c ON c.id = p.company_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [payslipId, companyId],
  );
  const row = r.rows[0];
  if (!row) throw new NotFoundError('payslip');

  // Ackumulerat för kalenderåret t.o.m. denna period (den anställda), räknat i
  // payrollYearSummary som payroll_year_summary, så att specen och åtgärden
  // aldrig visar olika tal (FR-16). Året och gränsen tas ur specens period.
  const year = Number(row.period.slice(0, 4));
  const acc = await payrollYearSummary(client, companyId, year, {
    employee_id: row.employee_id, through_period: row.period,
  });

  const pdf = await generatePayslipPdf({
    company: { name: row.company_name, org_number: row.org_number },
    employee: { name: row.employee_name, personnummer: row.personnummer, employment_type: row.employment_type },
    payslip: {
      period: row.period, payment_date: row.payment_date,
      gross_ore: Number(row.gross_ore), vacation_pay_ore: Number(row.vacation_pay_ore),
      tax_ore: Number(row.tax_ore), net_ore: Number(row.net_ore), tax_source: row.tax_source,
    },
    accumulated: {
      year: acc.year,
      gross_ore: acc.gross_total_ore,
      tax_ore: acc.tax_total_ore,
      net_ore: acc.net_total_ore,
      employer_contribution_ore: acc.employer_contribution_total_ore,
      vacation_pay_ore: acc.vacation_pay_total_ore,
    },
    createdDate,
  });

  const filename = `Lönespecifikation ${row.employee_name} ${row.period}.pdf`;
  const validated = validateUpload(filename, pdf);
  await writeStoredFile(companyId, validated.storedName, pdf);
  try {
    const file = await client.query<{ id: string }>(
      `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [companyId, filename, validated.storedName, validated.mimeType, pdf.length, validated.sha256, userId],
    );
    const document = await linkDocument(client, companyId, userId, {
      fileId: file.rows[0]!.id, entityType: 'payslip', entityId: payslipId, title: `Lönespecifikation ${row.period}`,
    });
    await writeAudit(client, {
      companyId, userId, action: 'payslip.pdf_generated', entityType: 'payslip', entityId: payslipId,
      details: { document_id: document.id, file_id: document.file_id, period: row.period },
    });
    return document;
  } catch (err) {
    await removeStoredFile(companyId, validated.storedName);
    throw err;
  }
}
