// K3: lönespecifikationen som PDF enligt Locollabs befintliga mall (portad från
// Cowork-skillen lonespecifikation/skapa_lonespec.py): header, infoblock i två
// kolumner, tabell (Månadslön / ev. Semesterersättning / Prel skatt tabell),
// Brutto+Netto-rad, ackumulerat per kalenderår och sidfot. Genereras ur
// systemets data och lagras i dokumentarkivet kopplad till lönebeskedet —
// ersätter den externa PDF:en i bokföringsmappen.
import PDFDocument from 'pdfkit';
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { linkDocument, type AttachedDocument } from './documents.js';
import { validateUpload, writeStoredFile, removeStoredFile } from './fileStorage.js';

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
  accumulated: { gross_ore: number; tax_ore: number };
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
      ['Skattetabell', payslip.tax_source === 'table30' ? '30' : payslip.tax_source === 'manual' ? 'Jämkning' : 'Platt sats'],
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

    // Ackumulerat (kalenderår, t.o.m. denna period)
    doc.fontSize(9).font('Helvetica').text('Ack. Bruttolön', left, y);
    doc.font('Helvetica-Bold').text(kr(data.accumulated.gross_ore), left + 80, y);
    doc.font('Helvetica').text('Ack. Förmån', left + 200, y);
    doc.font('Helvetica-Bold').text(kr(0), left + 270, y);
    doc.font('Helvetica').text('Ack. Skatt', left + 340, y);
    doc.font('Helvetica-Bold').text(kr(data.accumulated.tax_ore), xBelopp - 90, y, { width: 90, align: 'right' });

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
    period: string; payment_date: string | null; gross_ore: string; vacation_pay_ore: string;
    tax_ore: string; net_ore: string; tax_source: string;
    employee_name: string; personnummer: string | null; employment_type: string;
    company_name: string; org_number: string | null;
  }>(
    `SELECT p.period, p.payment_date::text, p.gross_ore, p.vacation_pay_ore, p.tax_ore, p.net_ore, p.tax_source,
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

  // Ackumulerat brutto/skatt för kalenderåret t.o.m. denna period (den anställda).
  const acc = await client.query<{ gross: string | null; tax: string | null }>(
    `SELECT SUM(p.gross_ore)::text AS gross, SUM(p.tax_ore)::text AS tax
     FROM payslips p
     WHERE p.company_id = $1 AND p.status <> 'cancelled'
       AND p.employee_id = (SELECT employee_id FROM payslips WHERE id = $2)
       AND p.period LIKE $3 AND p.period <= $4`,
    [companyId, payslipId, `${row.period.slice(0, 4)}-%`, row.period],
  );

  const pdf = await generatePayslipPdf({
    company: { name: row.company_name, org_number: row.org_number },
    employee: { name: row.employee_name, personnummer: row.personnummer, employment_type: row.employment_type },
    payslip: {
      period: row.period, payment_date: row.payment_date,
      gross_ore: Number(row.gross_ore), vacation_pay_ore: Number(row.vacation_pay_ore),
      tax_ore: Number(row.tax_ore), net_ore: Number(row.net_ore), tax_source: row.tax_source,
    },
    accumulated: { gross_ore: Number(acc.rows[0]?.gross ?? 0), tax_ore: Number(acc.rows[0]?.tax ?? 0) },
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
