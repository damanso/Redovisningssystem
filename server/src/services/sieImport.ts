// Fas A13: SIE4-import (systembyte). Parsar en SIE4-fil och importerar
// kontoplanen (#KONTO) samt verifikationerna (#VER/#TRANS). Importen respekterar
// bokföringsinvarianterna: verifikat får FÄRSKA gap-fria nummer i en egen
// importserie ('I'), det ursprungliga numret bevaras i beskrivningen, och
// debet=kredit tvingas av postVoucher. Belopp hanteras i heltal ören.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError } from '../lib/errors.js';
import { createCompanyAccount, type AccountType } from './accounting/accounts.js';
import { postVoucher } from './accounting/vouchers.js';
import { writeAudit } from './auditService.js';

export interface ParsedSieAccount { number: number; name: string }
export interface ParsedSieTrans { account: number; debit_ore: number; credit_ore: number }
export interface ParsedSieVoucher { series: string; number: string; date: string; description: string; lines: ParsedSieTrans[] }
export interface ParsedSie { accounts: ParsedSieAccount[]; vouchers: ParsedSieVoucher[] }

/** Kontotyp härledd ur BAS-kontonummer (importen har sällan #KTYP). */
export function accountTypeForNumber(n: number): AccountType {
  if (n >= 1000 && n <= 1999) return 'asset';
  if (n >= 2000 && n <= 2099) return 'equity';
  if (n >= 2100 && n <= 2999) return 'liability';
  if (n >= 3000 && n <= 3999) return 'revenue';
  return 'expense'; // 4000–8999: kostnader/finansiella poster
}

/**
 * Delar en SIE-rad i fält, med hänsyn till citattecken OCH objekt-/dimensionslistor
 * `{...}`. En hel `{...}`-grupp blir ETT token (inkl. citat inuti) så att ett
 * numeriskt dimensionsvärde (t.ex. `{1 "500"}`) inte förväxlas med #TRANS-beloppet.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i += 1;
    if (i >= line.length) break;
    if (line[i] === '"') {
      i += 1;
      let s = '';
      while (i < line.length && line[i] !== '"') { s += line[i]; i += 1; }
      i += 1; // stängande "
      out.push(s);
    } else if (line[i] === '{') {
      // Konsumera hela objektlistan till matchande '}' (respektera citat inuti).
      let depth = 0, s = '', inQ = false;
      while (i < line.length) {
        const ch = line[i]!;
        s += ch;
        if (ch === '"') inQ = !inQ;
        else if (!inQ && ch === '{') depth += 1;
        else if (!inQ && ch === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
        i += 1;
      }
      out.push(s);
    } else {
      let s = '';
      while (i < line.length && !/\s/.test(line[i]!) && line[i] !== '{') { s += line[i]; i += 1; }
      out.push(s);
    }
  }
  return out;
}

function sieDateToIso(d: string): string {
  if (!/^\d{8}$/.test(d)) throw new BadRequestError('bad_sie_date', `ogiltigt SIE-datum: ${d}`);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Parsar SIE4-text (redan avkodad till en JS-sträng) till konton + verifikat. */
export function parseSie(text: string): ParsedSie {
  const accounts: ParsedSieAccount[] = [];
  const vouchers: ParsedSieVoucher[] = [];
  const lines = text.split(/\r?\n/);
  let current: ParsedSieVoucher | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === '{') continue;
    if (line === '}') { if (current) { vouchers.push(current); current = null; } continue; }

    const tokens = tokenize(line);
    const tag = tokens[0];
    if (tag === '#KONTO') {
      const number = Number(tokens[1]);
      if (Number.isInteger(number) && tokens[2] !== undefined) accounts.push({ number, name: tokens[2] });
    } else if (tag === '#VER') {
      // #VER serie nummer datum "text"
      current = {
        series: tokens[1] ?? 'A', number: tokens[2] ?? '', date: sieDateToIso(tokens[3] ?? ''),
        description: tokens[4] ?? '', lines: [],
      };
    } else if (tag === '#TRANS' && current) {
      // #TRANS konto {} belopp   (belopp i kronor, + debet / − kredit)
      const account = Number(tokens[1]);
      const amountTok = tokens.find((t, idx) => idx >= 2 && /^-?\d/.test(t));
      const kronor = Number(amountTok);
      if (!Number.isInteger(account) || !Number.isFinite(kronor)) continue;
      const ore = Math.round(kronor * 100);
      current.lines.push({
        account,
        debit_ore: ore > 0 ? ore : 0,
        credit_ore: ore < 0 ? -ore : 0,
      });
    }
  }
  return { accounts, vouchers };
}

export interface SieImportResult { accounts_created: number; accounts_skipped: number; vouchers_imported: number }

export interface SieImportPlan {
  accountsToCreate: ParsedSieAccount[];
  accountsSkipped: number;
  vouchers: ParsedSieVoucher[];
}

/**
 * Importens räkning, delad med förhandsvisningen på förslagskortet: vilka
 * konton som skapas, hur många som hoppas över och vilka verifikat som bokförs.
 *
 * Befintliga konton hämtas FÖRST i en SELECT och hoppas över — vi får ALDRIG
 * låta en INSERT slå i unik-indexet inne i importtransaktionen: en misslyckad
 * sats försätter hela Postgres-transaktionen i abortläge (25P02) och nästa
 * fråga kraschar rått. (Grindfynd: import mot bolag med befintliga konton gav
 * 500 exakt så.) Av samma skäl når bara nummer 1000–9999 `$2::int[]`: ett
 * nummer utanför heltalsintervallet (`#KONTO 99999999999`) gav 22003 i frågan.
 */
export async function planSieImport(client: PoolClient, companyId: string, parsed: ParsedSie): Promise<SieImportPlan> {
  const inRange = parsed.accounts.filter((a) => Number.isInteger(a.number) && a.number >= 1000 && a.number <= 9999);
  const existing = await client.query<{ account_number: number }>(
    'SELECT account_number FROM accounts WHERE company_id = $1 AND account_number = ANY($2::int[])',
    [companyId, inRange.map((a) => a.number)],
  );
  const existingNumbers = new Set(existing.rows.map((r) => r.account_number));
  const accountsToCreate = inRange.filter((a) => !existingNumbers.has(a.number));
  return {
    accountsToCreate,
    accountsSkipped: parsed.accounts.length - accountsToCreate.length,
    vouchers: parsed.vouchers.filter((v) => v.lines.length > 0),
  };
}

/**
 * Förhandsvisningen på förslagskortet: hur många verifikat och nya konton
 * importen skulle ge. null när innehållet inte är en sträng eller inte går att
 * läsa. `parseSie` är ren och körs före varje fråga, så felet fångas utan att
 * transaktionen rörts.
 *
 * Avvägning: funktionen parsar hela texten (högst 4 MB enligt schemat) och
 * anropas bara för ett väntande förslag, en gång per kort och sidvisning. En
 * avgjord rad räknar aldrig om, eftersom importen då redan har skapat kontona
 * som räkningen letar efter (`approvalSummary`, läget `avgjord`). Väntande
 * `import_sie` är få, och svaret sparas inte: en cache vore ett nytt mönster,
 * och kortet ska visa vad importen ger i dag, inte vad den gav när förslaget köades.
 */
export async function previewSieImport(
  client: PoolClient, companyId: string, sieContent: unknown,
): Promise<{ vouchers: number; newAccounts: number } | null> {
  if (typeof sieContent !== 'string') return null;
  let parsed: ParsedSie;
  try {
    parsed = parseSie(sieContent);
  } catch (err) {
    if (err instanceof BadRequestError) return null;
    throw err;
  }
  const plan = await planSieImport(client, companyId, parsed);
  return { vouchers: plan.vouchers.length, newAccounts: plan.accountsToCreate.length };
}

export async function importSie(
  client: PoolClient, companyId: string, userId: string, fiscalYearId: string, parsed: ParsedSie,
): Promise<SieImportResult> {
  let accountsCreated = 0, vouchersImported = 0;

  // 1) Konton: skapa de som inte redan finns, enligt planen (SELECT före INSERT).
  const plan = await planSieImport(client, companyId, parsed);
  for (const acc of plan.accountsToCreate) {
    await createCompanyAccount(client, companyId, userId, {
      account_number: acc.number, name: acc.name, account_type: accountTypeForNumber(acc.number),
    });
    accountsCreated += 1;
  }

  // 2) Verifikat: importeras med FÄRSKA nummer i importserien 'I'; ursprungligt
  //    serie/nummer bevaras i beskrivningen. postVoucher tvingar debet=kredit.
  for (const v of plan.vouchers) {
    await postVoucher(client, companyId, userId, {
      fiscalYearId,
      series: 'I',
      voucherDate: v.date,
      description: `[SIE ${v.series}${v.number}] ${v.description}`.slice(0, 200),
      lines: v.lines.map((l) => ({ account_number: l.account, debit_ore: l.debit_ore, credit_ore: l.credit_ore })),
      sourceType: 'sie_import',
    });
    vouchersImported += 1;
  }

  await writeAudit(client, {
    companyId, userId, action: 'sie.imported', entityType: 'company', entityId: companyId,
    details: { accounts_created: accountsCreated, vouchers_imported: vouchersImported },
  });
  return { accounts_created: accountsCreated, accounts_skipped: plan.accountsSkipped, vouchers_imported: vouchersImported };
}
