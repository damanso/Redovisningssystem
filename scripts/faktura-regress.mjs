// Regressionstest för fakturagenerering.
// ADR-0003: en hälsokoll ska utöva funktionen den vakar över. Testet genererar
// en riktig faktura-PDF och kontrollerar att de uppgifter momslagen kräver
// FAKTISKT står i dokumentet — inte bara att generering inte kraschar.
import fs from 'node:fs';
import pg from 'pg';

const INVOICE_ID = process.argv[2];
if (!INVOICE_ID) { console.error('användning: node faktura_regress.mjs <invoice_id>'); process.exit(2); }

const env = Object.fromEntries(
  fs.readFileSync('/opt/redovisning/.env', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const c = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL || env.DATABASE_URL });
await c.connect();
const companyId = (await c.query('select id from companies limit 1')).rows[0].id;
const userId = (await c.query('select id from users limit 1')).rows[0].id;

const inv = (await c.query(
  `select i.*, cu.name customer_name, cu.address c_addr, cu.postal_code c_pc, cu.city c_city
   from invoices i join customers cu on cu.id = i.customer_id where i.id = $1`, [INVOICE_ID])).rows[0];
const co = (await c.query('select * from companies where id = $1', [companyId])).rows[0];
await c.end();

const { generateInvoicePdfFile } = await import('/opt/redovisning/server/dist/services/invoices.js');
const { buffer } = await generateInvoicePdfFile(companyId, userId, INVOICE_ID);

// PDFKit skriver strömmen okomprimerad (compress: false) och kodar text i
// oktal-escape per tecken. Avkoda innehållsströmmarnas (…)-literaler.
// Avkoda med pdftotext (poppler). Att regexa råa PDF-bytes fungerar inte:
// logotypens JPEG-data innehåller både parenteser och sekvenserna BT/ET,
// så en egen parser hittar text som inte finns och missar text som finns.
const tmp = `/tmp/regress_${process.pid}.pdf`;
fs.writeFileSync(tmp, buffer);
const { execFileSync } = await import('node:child_process');
let text;
try {
  text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { encoding: 'utf8', maxBuffer: 8e6 });
} finally {
  fs.unlinkSync(tmp);
}
if (process.env.DUMP === '1') {
  console.log('--- extraherad text (första 1200 tecken) ---');
  console.log(text.slice(0, 1200));
  console.log('--- slut ---\n');
}
const norm = s => String(s).replace(/\s+/g, ' ');
const has = s => norm(text).includes(norm(s));

const krav = [
  ['Säljarens namn',        co.name],
  ['Säljarens adress',      co.address],
  ['Säljarens postort',     `${co.postal_code} ${co.city}`],
  ['Säljarens momsreg.nr',  co.vat_number],
  ['Köparens namn',         inv.customer_name],
  ['Köparens adress',       inv.c_addr],
  ['Köparens postort',      `${inv.c_pc} ${inv.c_city}`],
  ['Fakturanummer',         String(inv.external_invoice_number ?? inv.invoice_number).padStart(7, '0')],
  ['Fakturadatum',          inv.invoice_date.toISOString().slice(0, 10)],
  ['Betalningsuppgift',     co.bankgiro || co.plusgiro || co.bank_account],
  ['Momsbelopp',            'Moms'],
  ['Att betala',            'Att betala'],
  ['F-skatt',               co.approved_for_f_tax ? 'Godkänd för F-skatt' : null],
];

let brister = 0;
console.log(`PDF: ${buffer.length} bytes, ${buffer.subarray(0, 5).toString('latin1')}\n`);
for (const [namn, varde] of krav) {
  if (!varde) { console.log(`SAKNAS I REGISTRET  ${namn}`); brister++; continue; }
  const ok = has(varde);
  if (!ok) brister++;
  console.log(`${ok ? '  OK  ' : 'SAKNAS'}  ${namn}: ${varde}`);
}
console.log(`\nBrister: ${brister}`);
process.exit(brister === 0 ? 0 : 1);
