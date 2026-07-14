// Fas D4: periodisk sammanställning (EU-moms). Rapporterar momsfri EU-försäljning per
// köpare (köparens momsregistreringsnummer) uppdelat på varor, trepartshandel och
// tjänster. Underlaget härleds ur fakturarader bokförda på EU-försäljningskontona
// (3105 varor, 3308 tjänster) grupperat per kund. Belopp i hela kronor. Beräknat
// underlag; ingen digital inlämning.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError } from '../lib/errors.js';

// EU-försäljningskonton. Varor → ruta i sammanställningen (varuvärde), tjänster →
// tjänstevärde. Trepartshandel kräver särskild kontering och stöds inte automatiskt.
const EU_GOODS_MIN = 3105, EU_GOODS_MAX = 3106;   // försäljning varor till annat EU-land
const EU_SERVICES_MIN = 3308, EU_SERVICES_MAX = 3308; // försäljning tjänster till annat EU-land

export interface EcSalesRow {
  customer_name: string;
  vat_number: string | null;   // köparens momsregistreringsnummer (landskod + nummer)
  goods_ore: Ore;
  services_ore: Ore;
}
export interface EcSalesList {
  from: string;
  to: string;
  company: { name: string; org_number: string | null; vat_number: string | null };
  rows: EcSalesRow[];
  total_goods_ore: Ore;
  total_services_ore: Ore;
  missing_vat: string[];       // kundnamn med EU-försäljning men utan momsnummer
  disclaimer: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Periodisk sammanställning för [from, to]: EU-varu- och tjänsteförsäljning per kund,
 * ur bokförda (ej makulerade) fakturarader på EU-försäljningskontona. Kunder med
 * EU-försäljning men utan registrerat momsnummer flaggas separat.
 */
export async function ecSalesList(client: PoolClient, companyId: string, from: string, to: string): Promise<EcSalesList> {
  if (!ISO_RE.test(from) || !ISO_RE.test(to)) throw new BadRequestError('invalid_period', "datum anges som 'YYYY-MM-DD'");
  const company = await client.query<{ name: string; org_number: string | null; vat_number: string | null }>(
    'SELECT name, org_number, vat_number FROM companies WHERE id = $1', [companyId],
  );

  // Summera per kund: varor (3105–3106) och tjänster (3308) ur fakturarader på
  // fakturor med fakturadatum i perioden, exkl. makulerade.
  const rows = await client.query<{ customer_name: string; vat_number: string | null; goods: string; services: string }>(
    `SELECT c.name AS customer_name, c.vat_number,
            COALESCE(sum(l.line_net_ore) FILTER (WHERE l.revenue_account BETWEEN $3 AND $4), 0) AS goods,
            COALESCE(sum(l.line_net_ore) FILTER (WHERE l.revenue_account BETWEEN $5 AND $6), 0) AS services
     FROM invoice_lines l
     JOIN invoices i ON i.id = l.invoice_id
     JOIN customers c ON c.id = i.customer_id
     WHERE i.company_id = $1 AND i.status <> 'cancelled' AND i.voucher_id IS NOT NULL
       AND i.invoice_date BETWEEN $2::date AND $7::date
       AND l.revenue_account BETWEEN $3 AND $6
     GROUP BY c.id, c.name, c.vat_number
     HAVING COALESCE(sum(l.line_net_ore) FILTER (WHERE l.revenue_account BETWEEN $3 AND $4), 0) <> 0
         OR COALESCE(sum(l.line_net_ore) FILTER (WHERE l.revenue_account BETWEEN $5 AND $6), 0) <> 0
     ORDER BY c.name`,
    [companyId, from, EU_GOODS_MIN, EU_GOODS_MAX, EU_SERVICES_MIN, EU_SERVICES_MAX, to],
  );

  const list: EcSalesRow[] = rows.rows.map((r) => ({
    customer_name: r.customer_name,
    vat_number: r.vat_number,
    goods_ore: Number(r.goods),
    services_ore: Number(r.services),
  }));

  return {
    from, to,
    company: { name: company.rows[0]?.name ?? '', org_number: company.rows[0]?.org_number ?? null, vat_number: company.rows[0]?.vat_number ?? null },
    rows: list,
    total_goods_ore: list.reduce((s, r) => s + r.goods_ore, 0),
    total_services_ore: list.reduce((s, r) => s + r.services_ore, 0),
    missing_vat: list.filter((r) => !r.vat_number).map((r) => r.customer_name),
    disclaimer: 'Beräknad periodisk sammanställning ur bokförda fakturor på EU-försäljningskontona (3105 varor, 3308 tjänster). Köparens momsregistreringsnummer måste finnas på kunden — kunder utan momsnummer flaggas. Trepartshandel hanteras inte automatiskt. Ingen digital inlämning; ladda upp filen själv hos Skatteverket.',
  };
}

// --- Skatteverkets filformat (SKV574008, semikolonseparerad text). ---
function toKr(ore: number): number { return Math.round(ore / 100); }
function cleanVat(v: string): string { return v.replace(/[^0-9A-Za-z]/g, '').toUpperCase(); }
function lastDayOfMonth(year: number, month1to12: number): string {
  const d = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Tolkar en period: 'YYYY-MM' (månad) eller 'YYYY-Qn' (kvartal) → datumintervall +
// Skatteverkets periodkod (YYMM för månad, YY-Q för kvartal).
function parsePeriod(period: string): { from: string; to: string; code: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) {
    const yStr = m[1]!; const moStr = m[2]!;
    return { from: `${yStr}-${moStr}-01`, to: lastDayOfMonth(Number(yStr), Number(moStr)), code: `${yStr.slice(2)}${moStr}` };
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    const yStr = q[1]!; const qn = Number(q[2]!);
    const startMo = (qn - 1) * 3 + 1;
    return { from: `${yStr}-${String(startMo).padStart(2, '0')}-01`, to: lastDayOfMonth(Number(yStr), startMo + 2), code: `${yStr.slice(2)}-${qn}` };
  }
  throw new BadRequestError('invalid_period', "period anges som 'YYYY-MM' eller 'YYYY-Qn'");
}

export interface EcSalesFile { csv: string; filename: string; period: string; buyer_count: number }

/**
 * Genererar periodisk sammanställning som SKV574008-fil (semikolonseparerad text) för
 * en månad ('YYYY-MM') eller ett kvartal ('YYYY-Qn'). Kräver bolagets org.nr och att
 * varje EU-köpare har ett momsregistreringsnummer.
 */
export async function generateEcSalesFile(client: PoolClient, companyId: string, period: string, contact: { name: string; phone: string; email?: string }): Promise<EcSalesFile> {
  const { from, to, code } = parsePeriod(period);
  const list = await ecSalesList(client, companyId, from, to);
  const orgDigits = (list.company.org_number ?? '').replace(/\D/g, '');
  if (orgDigits.length !== 10) throw new BadRequestError('missing_org_number', 'bolagets organisationsnummer krävs för periodisk sammanställning');
  if (list.missing_vat.length > 0) {
    throw new BadRequestError('missing_vat_number', `EU-köpare utan momsregistreringsnummer: ${list.missing_vat.join(', ')}`);
  }
  // Uppgiftslämnarens momsnummer = 10-siffrigt org.nr + '01' (svenskt momsnr utan SE).
  const reporterVat = list.company.vat_number ? cleanVat(list.company.vat_number).replace(/^SE/, '') : `${orgDigits}01`;

  const header = [reporterVat, code, contact.name, contact.phone, contact.email ?? ''].join(';');
  const buyerRows = list.rows.map((r) => {
    const goods = r.goods_ore ? String(toKr(r.goods_ore)) : '';
    const services = r.services_ore ? String(toKr(r.services_ore)) : '';
    // Fält: köparVAT;varor;trepartshandel;tjänster; (trepartshandel stöds ej → tomt).
    return `${cleanVat(r.vat_number!)};${goods};;${services};`;
  });
  const csv = ['SKV574008;', header, ...buyerRows].join('\r\n') + '\r\n';
  return { csv, filename: `periodisk_sammanstallning_${code.replace('-', 'Q')}.txt`, period, buyer_count: list.rows.length };
}
