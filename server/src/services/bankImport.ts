// Fas A13: CSV-bankimport (offline filimport — INTE en live bankkoppling; PSD2
// är utanför scope). Parsar en bank-CSV (datum;text;belopp[;saldo]), importerar
// raderna för avstämning och deduperar mot tidigare importer. Belopp i öre.
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { BadRequestError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export interface ParsedBankRow { booking_date: string; text: string; amount_ore: number; balance_ore: number | null }

/** Svenskt beloppsformat → öre. "1 234,56" / "-1234.56" / "1.234,56". */
export function parseAmountToOre(raw: string): number {
  let s = raw.trim().replace(/\s/g, '').replace(/kr$/i, '');
  if (s === '') throw new BadRequestError('bad_amount', 'tomt belopp');
  const neg = s.startsWith('-') || /^\(.*\)$/.test(s);
  s = s.replace(/[()+-]/g, '');
  // Om både . och , finns antas . vara tusentalsavgränsare (svensk stil).
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const kronor = Number(s);
  if (!Number.isFinite(kronor)) throw new BadRequestError('bad_amount', `ogiltigt belopp: ${raw}`);
  const ore = Math.round(kronor * 100);
  return neg ? -ore : ore;
}

function parseDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Tillåt YYYY/MM/DD och YYYYMMDD.
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  throw new BadRequestError('bad_date', `ogiltigt datum: ${raw}`);
}

/** Delar en CSV-rad på ';' eller ',' (väljer det som ger flest fält), respekterar "". */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i += 1; } else inQ = !inQ;
    } else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parsar en bank-CSV. Kolumnordning härleds från en valfri rubrikrad, annars
 * antas datum, text, belopp, [saldo]. Rader utan giltigt datum/belopp hoppas.
 */
export function parseBankCsv(content: string): ParsedBankRow[] {
  const raw = content.replace(/^﻿/, ''); // BOM
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const delim = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';

  // Rubrikrad? Om första fältet inte ser ut som ett datum.
  const first = splitCsvLine(lines[0]!, delim);
  const hasHeader = !/^\d{4}[-/]?\d{2}/.test(first[0] ?? '');
  let dateCol = 0, textCol = 1, amountCol = 2, balanceCol = -1;
  if (hasHeader) {
    const lower = first.map((h) => h.toLowerCase());
    const find = (...keys: string[]) => lower.findIndex((h) => keys.some((k) => h.includes(k)));
    dateCol = Math.max(0, find('datum', 'date', 'bokför'));
    textCol = Math.max(0, find('text', 'beskriv', 'meddel', 'referens'));
    amountCol = Math.max(0, find('belopp', 'amount', 'summa'));
    balanceCol = find('saldo', 'balance');
  }

  const rows: ParsedBankRow[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cols = splitCsvLine(line, delim);
    try {
      const booking_date = parseDate(cols[dateCol] ?? '');
      const amount_ore = parseAmountToOre(cols[amountCol] ?? '');
      const text = (cols[textCol] ?? '').slice(0, 500) || '(ingen text)';
      const balance_ore = balanceCol >= 0 && cols[balanceCol] ? parseAmountToOre(cols[balanceCol]!) : null;
      rows.push({ booking_date, text, amount_ore, balance_ore });
    } catch {
      // Hoppa rader som inte går att tolka (t.ex. summeringsrad) i stället för att fela.
      continue;
    }
  }
  return rows;
}

export interface BankImportResult { imported: number; duplicates: number; batch: string }

export async function importBankCsv(
  client: PoolClient, companyId: string, userId: string, content: string,
): Promise<BankImportResult> {
  const rows = parseBankCsv(content);
  if (rows.length === 0) throw new BadRequestError('empty_csv', 'inga tolkbara rader i filen');
  const batch = randomUUID();
  let imported = 0, duplicates = 0;
  for (const r of rows) {
    const hash = createHash('sha256').update(`${r.booking_date}|${r.text}|${r.amount_ore}|${r.balance_ore ?? ''}`).digest('hex');
    const res = await client.query(
      `INSERT INTO bank_transactions (company_id, booking_date, text, amount_ore, balance_ore, import_batch, row_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, row_hash) DO NOTHING`,
      [companyId, r.booking_date, r.text, r.amount_ore, r.balance_ore, batch, hash, userId],
    );
    if (res.rowCount === 1) imported += 1; else duplicates += 1;
  }
  await writeAudit(client, {
    companyId, userId, action: 'bank.imported', entityType: 'company', entityId: companyId,
    details: { imported, duplicates, batch },
  });
  return { imported, duplicates, batch };
}

export async function listBankTransactions(
  client: PoolClient, companyId: string, opts: { reconciled?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT id, booking_date::text, text, amount_ore, balance_ore, reconciled
     FROM bank_transactions
     WHERE company_id = $1 AND ($2::boolean IS NULL OR reconciled = $2)
     ORDER BY booking_date DESC, created_at DESC LIMIT 500`,
    [companyId, opts.reconciled ?? null],
  );
  return r.rows;
}

export async function setBankTransactionReconciled(
  client: PoolClient, companyId: string, userId: string, id: string, reconciled: boolean,
): Promise<void> {
  const r = await client.query(
    'UPDATE bank_transactions SET reconciled = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId, reconciled],
  );
  if (!r.rows[0]) throw new BadRequestError('not_found', 'transaktionen finns inte');
  await writeAudit(client, {
    companyId, userId, action: 'bank.reconciled', entityType: 'bank_transaction', entityId: id, details: { reconciled },
  });
}
