// LOC-263 del 1b: fakturans bilaga (sida 2 i husmallen).
//
// Två varianter, båda tagna ur Locollabs verkliga fakturor:
//   'time'    — tidsspecifikation per datum (faktura 0000027)
//   'expense' — utläggsspecifikation per datum (faktura 0000024)
//
// Tid lagras som heltal MINUTER (samma modell som time_entries), utlägg som
// heltal ören — aldrig flyttal. Bilagan kan fyllas i explicit eller hämtas ur
// systemets egen tidrapportering.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export type AppendixKind = 'time' | 'expense' | 'category';

export interface AppendixRowInput {
  /**
   * Obligatoriskt för 'time' och 'expense' — de ÄR specifikationer per datum.
   * Utelämnas för 'category': en kategoribilaga svarar på vad arbetet gällde,
   * inte vilken dag. Att fylla den med fakturadatumet på varje rad, som blev
   * fallet innan varianten fanns, är att skriva ut en uppgift som inte finns.
   */
  entry_date?: string;
  description: string;
  /** Tid i hela minuter. Krävs för 'time' och 'category'. */
  minutes?: number;
  /** Belopp i hela ören. Krävs för 'expense', valfritt för 'category'. */
  amount_ore?: number;
}

export interface SetAppendixInput {
  invoiceId: string;
  kind: AppendixKind;
  title?: string;
  preamble?: string;
  notes?: string;
  rows: AppendixRowInput[];
}

export interface ManualAppendixInput extends SetAppendixInput {
  /** Krävs för kind 'time': en handskriven tidsbilaga går förbi tidrapporteringen. */
  bypassTimeEntries?: boolean;
  reason?: string;
}

/** Fakturan måste vara ett obokat utkast för att underlaget ska få ändras. */
async function assertEditableDraft(client: PoolClient, companyId: string, invoiceId: string): Promise<void> {
  const inv = await client.query<{ voucher_id: string | null; status: string }>(
    'SELECT voucher_id, status FROM invoices WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId],
  );
  const row = inv.rows[0];
  if (!row) throw new NotFoundError('invoice');
  if (row.voucher_id || row.status !== 'draft') {
    throw new ConflictError(
      'invoice_not_draft',
      'bilagan kan bara ändras på ett obokat utkast — en bokförd fakturas underlag är oföränderligt',
    );
  }
}

export async function setInvoiceAppendix(
  client: PoolClient, companyId: string, userId: string, input: SetAppendixInput,
): Promise<Record<string, unknown>> {
  await assertEditableDraft(client, companyId, input.invoiceId);
  if (input.rows.length === 0) throw new BadRequestError('no_rows', 'bilagan saknar rader');

  const ärKategori = input.kind === 'category';
  for (const [i, r] of input.rows.entries()) {
    const hasMinutes = r.minutes !== undefined;
    const hasAmount = r.amount_ore !== undefined;
    const hasDate = r.entry_date !== undefined && r.entry_date !== null && r.entry_date !== '';

    // Datum: krav för specifikationer per datum, förbjudet för kategoribilagan.
    // Det andra ledet är avsiktligt — utan det skulle datumkolumnen dyka upp
    // igen så fort någon råkar skicka med ett datum, och bilagan bytte form.
    if (!ärKategori && !hasDate) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: ${input.kind}-bilagan kräver entry_date`);
    }
    if (ärKategori && hasDate) {
      throw new BadRequestError(
        'invalid_row',
        `rad ${i + 1}: kategoribilagan har inga datum — använd kind 'time' om raderna ska visas per datum`,
      );
    }

    if (ärKategori) {
      // Kategoriraden bär timmar, och får bära beloppet bredvid.
      if (!hasMinutes) throw new BadRequestError('invalid_row', `rad ${i + 1}: kategoribilagan kräver minutes`);
    } else if (hasMinutes === hasAmount) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: ange antingen minutes (tid) eller amount_ore (utlägg)`);
    }
    if (input.kind === 'time' && !hasMinutes) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: tidsbilagan kräver minutes`);
    }
    if (input.kind === 'expense' && !hasAmount) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: utläggsbilagan kräver amount_ore`);
    }
    if (hasMinutes && (!Number.isInteger(r.minutes) || r.minutes! <= 0)) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: minutes måste vara ett positivt heltal`);
    }
    if (hasAmount && (!Number.isInteger(r.amount_ore) || r.amount_ore! < 0)) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: amount_ore måste vara ett heltal i ören`);
    }
  }

  // Ersätt hela bilagan (idempotent: samma anrop två gånger ger samma resultat).
  await client.query('DELETE FROM invoice_appendix_rows WHERE invoice_id = $1 AND company_id = $2',
    [input.invoiceId, companyId]);
  await client.query(
    `UPDATE invoices SET appendix_kind = $3, appendix_title = $4, appendix_preamble = $5, appendix_notes = $6
     WHERE id = $1 AND company_id = $2`,
    [input.invoiceId, companyId, input.kind, input.title ?? null, input.preamble ?? null, input.notes ?? null],
  );
  for (const [i, r] of input.rows.entries()) {
    await client.query(
      `INSERT INTO invoice_appendix_rows (invoice_id, company_id, row_no, entry_date, description, minutes, amount_ore)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.invoiceId, companyId, i + 1, r.entry_date ?? null, r.description, r.minutes ?? null, r.amount_ore ?? null],
    );
  }

  await writeAudit(client, {
    companyId, userId, action: 'invoice.appendix_set', entityType: 'invoice', entityId: input.invoiceId,
    details: { kind: input.kind, rows: input.rows.length },
  });
  return getInvoiceAppendix(client, companyId, input.invoiceId);
}

export interface AppendixRow {
  row_no: number;
  /** null för kategoribilagor. */
  entry_date: string | null;
  description: string;
  minutes: number | null;
  amount_ore: number | null;
}

export async function getInvoiceAppendix(
  client: PoolClient, companyId: string, invoiceId: string,
): Promise<Record<string, unknown>> {
  const head = await client.query<{
    appendix_kind: AppendixKind | null; appendix_title: string | null;
    appendix_preamble: string | null; appendix_notes: string | null;
  }>(
    'SELECT appendix_kind, appendix_title, appendix_preamble, appendix_notes FROM invoices WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('invoice');
  const rows = await client.query<AppendixRow>(
    `SELECT row_no, entry_date::text, description, minutes, amount_ore
     FROM invoice_appendix_rows WHERE invoice_id = $1 AND company_id = $2 ORDER BY row_no`,
    [invoiceId, companyId],
  );
  const totalMinutes = rows.rows.reduce((s, r) => s + (r.minutes ?? 0), 0);
  const totalOre = rows.rows.reduce((s, r) => s + (r.amount_ore ?? 0), 0);
  return {
    kind: head.rows[0].appendix_kind,
    title: head.rows[0].appendix_title,
    preamble: head.rows[0].appendix_preamble,
    notes: head.rows[0].appendix_notes,
    rows: rows.rows,
    total_minutes: totalMinutes,
    total_amount_ore: totalOre,
  };
}

/**
 * Urvalet till tidsbilagan: godkänd (eller justerad) tid i perioden som ännu
 * inte hör till någon faktura. Predikatet står på EN plats därför att det
 * används av två frågor som måste vara identiska — räkningen före låset och
 * själva låsningen. Två snarlika kopior hade gjort skillnaden mellan dem till
 * ett falskt larm.
 *
 * `billable_minutes > 0` ingår: en post som debiterar noll minuter har ingen
 * rad att sätta på bilagan (och bilageraden kräver minuter > 0). Sättet att
 * säga "den här ska aldrig faktureras" är statusen 'ignorerad', inte en
 * nollrad.
 *
 * $5 är de poster människan uttryckligen tagit UNDAN ur just den här
 * faktureringen. Undantaget hör hemma i predikatet och ingenstans annars: en
 * bortfiltrering efter urvalet hade låst poster som aldrig hamnade på fakturan.
 */
const TIDPOSTURVAL = `company_id = $1
       AND status IN ('godkand', 'justerad') AND invoice_id IS NULL
       AND billable_minutes > 0
       AND work_date >= $2 AND work_date <= $3
       AND ($4::uuid IS NULL OR project_id = $4)
       AND ($5::uuid[] IS NULL OR NOT (id = ANY($5)))`;

export interface TidpostUrval {
  from: string;
  to: string;
  projectId?: string;
  /** Poster som uttryckligen INTE ska faktureras den här gången. Rörs inte alls. */
  excludeEntryIds?: string[];
}

export interface ValdTidpost {
  id: string;
  work_date: string;
  description: string;
  billable_minutes: number;
  /** Postens egen taxa; null = uppdragets taxa gäller. */
  hourly_rate_ore: number | null;
}

/**
 * Väljer OCH låser tidposterna i perioden (story 1-mönstret, nu på ett ställe
 * för både bilagan och fakturaskapandet):
 *   1. räkning på ögonblicksbilden UTAN lås — den skiljer "det fanns aldrig
 *      något att fakturera" (400) från "någon annan hann före" (409). Utan den
 *      blir en förlorad kapplöpning en tom lista, alltså samma tysta noll som
 *      lärdom 7 i STATUS.md handlar om: inget fel, inget resultat, ingen
 *      förklaring.
 *   2. `SELECT … FOR UPDATE` med EXAKT samma predikat.
 *   3. lika många rader som räkningen, annars 409 och rollback.
 */
export async function valjOchLasTidposter(
  client: PoolClient, companyId: string, urval: TidpostUrval,
): Promise<ValdTidpost[]> {
  const parametrar = [
    companyId, urval.from, urval.to, urval.projectId ?? null,
    urval.excludeEntryIds?.length ? urval.excludeEntryIds : null,
  ];
  const fore = await client.query<{ antal: string }>(
    `SELECT count(*)::int AS antal FROM time_entries WHERE ${TIDPOSTURVAL}`, parametrar,
  );
  const antalFore = Number(fore.rows[0]?.antal ?? 0);
  if (antalFore === 0) {
    throw new BadRequestError('no_time_entries', 'ingen godkänd, ofakturerad tid i perioden');
  }

  const entries = await client.query<ValdTidpost>(
    `SELECT id, work_date::text, description, billable_minutes, hourly_rate_ore
     FROM time_entries
     WHERE ${TIDPOSTURVAL}
     ORDER BY work_date, created_at
     FOR UPDATE`,
    parametrar,
  );
  if (entries.rows.length !== antalFore) {
    throw new ConflictError(
      'time_entries_changed',
      'tidposterna i perioden ändrades av en annan skrivning — försök igen',
    );
  }
  return entries.rows;
}

/**
 * Låser de valda posterna till fakturan. Villkoret upprepas i UPDATE:n med
 * flit: låset (FOR UPDATE) skyddar mot samtidiga skrivningar, villkoret skyddar
 * mot allt annat. Stämmer inte antalet rullas HELA transaktionen tillbaka — en
 * halv fakturering, där bilagan skrivits men posterna inte låsts, är exakt
 * julifelet igen.
 */
export async function lasTidposterTillFaktura(
  client: PoolClient, companyId: string, invoiceId: string, entries: ValdTidpost[],
): Promise<void> {
  const last = await client.query(
    `UPDATE time_entries
        SET status = 'fakturerad', invoiced = true, billable = true, invoice_id = $3
      WHERE company_id = $1 AND id = ANY($2::uuid[])
        AND invoice_id IS NULL AND status IN ('godkand', 'justerad')`,
    [companyId, entries.map((e) => e.id), invoiceId],
  );
  if (last.rowCount !== entries.length) {
    throw new ConflictError(
      'time_entries_changed',
      'tidposterna i perioden ändrades av en annan skrivning — försök igen',
    );
  }
}

/**
 * Fyller tidsbilagan ur systemets EGEN tidrapportering (time_entries) i stället
 * för handpåläggning: godkänd, ännu ofakturerad tid i perioden, per datum.
 * Bilagans minuter är de DEBITERBARA (`billable_minutes`) — vad kunden betalar,
 * inte vad klockan visade. Posterna låses till fakturan (`invoice_id` + status
 * 'fakturerad') i samma transaktion, så samma timmar aldrig kan faktureras två
 * gånger; det var precis det som gick fel i juli 2026 (PRD §1 rad 1).
 */
export async function appendixFromTimeEntries(
  client: PoolClient, companyId: string, userId: string,
  input: { invoiceId: string; projectId?: string; from: string; to: string; title?: string; preamble?: string },
): Promise<Record<string, unknown>> {
  await assertEditableDraft(client, companyId, input.invoiceId);
  const entries = await valjOchLasTidposter(client, companyId, {
    from: input.from, to: input.to, projectId: input.projectId,
  });

  const result = await setInvoiceAppendix(client, companyId, userId, {
    invoiceId: input.invoiceId,
    kind: 'time',
    title: input.title,
    preamble: input.preamble,
    rows: entries.map((e) => ({
      entry_date: e.work_date, description: e.description, minutes: e.billable_minutes,
    })),
  });

  await lasTidposterTillFaktura(client, companyId, input.invoiceId, entries);

  await writeAudit(client, {
    companyId, userId, action: 'invoice.appendix_from_time', entityType: 'invoice', entityId: input.invoiceId,
    details: {
      entries: entries.length, from: input.from, to: input.to, project_id: input.projectId ?? null,
      billable_minutes: entries.reduce((s, e) => s + e.billable_minutes, 0),
    },
  });
  return result;
}

/**
 * Vägen för en HANDSKRIVEN bilaga (`set_invoice_appendix`). En tidsbilaga
 * skriven för hand går förbi tidrapporteringen: raderna hamnar på fakturan utan
 * att en enda tidpost låses, och samma timmar kan faktureras igen i morgon. Det
 * ÄR julifelet, bara utfört med handen i stället för av en bugg. Därför krävs
 * ett uttalat undantag med skäl — och skälet hamnar i auditloggen, så att den
 * som läser efteråt ser att det var ett beslut och inte en slentrian.
 *
 * 'expense' och 'category' rörs inte: ingen av dem har någon tidrapportering
 * att gå förbi.
 */
export async function setInvoiceAppendixManually(
  client: PoolClient, companyId: string, userId: string, input: ManualAppendixInput,
): Promise<Record<string, unknown>> {
  if (input.kind === 'time') {
    if (input.bypassTimeEntries !== true) {
      throw new ConflictError(
        'use_create_invoice_from_time',
        'en tidsbilaga skrivs ur godkänd tid (create_invoice_from_time) — sätt bypass_time_entries med skäl för att skriva den för hand',
      );
    }
    if (!input.reason?.trim()) {
      throw new BadRequestError(
        'bypass_reason_required', 'att gå förbi tidrapporteringen kräver ett skäl (reason)',
      );
    }
  }

  const result = await setInvoiceAppendix(client, companyId, userId, input);

  if (input.kind === 'time') {
    await writeAudit(client, {
      companyId, userId, action: 'invoice.appendix_time_bypass', entityType: 'invoice', entityId: input.invoiceId,
      details: { rows: input.rows.length, reason: input.reason },
    });
  }
  return result;
}
