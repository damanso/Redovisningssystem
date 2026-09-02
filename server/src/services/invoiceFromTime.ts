// PRD_TIDSRAPPORTERING §4 F6+F7 (story 2): fakturan ur godkänd tid — i EN
// transaktion.
//
// Julifelet (PRD §1) var inte att bilagan saknades utan att fakturan kunde
// existera UTAN att tidposterna stängdes: raderna gick iväg, posterna låg kvar
// som ofakturerade, och samma timmar var redo att faktureras igen. Vägen hit
// gick i tre steg (skapa faktura → fyll bilaga → hoppas att någon körde det
// andra steget), och ett steg som kan hoppas över blir förr eller senare
// överhoppat.
//
// Den här tjänsten gör de tre stegen till ETT. Urvalet väljs och låses först
// (`valjOchLasTidposter`), fakturan skapas ur exakt det urvalet, bilagan skrivs
// ur samma rader och samma rader låses till fakturan. Faller något steg rullar
// hela transaktionen tillbaka: en faktura med olåsta tidposter går inte längre
// att skapa — inte som ett handhavandefel heller.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import type { VatRate } from '../domain/vat.js';
import { createInvoice, getInvoice } from './invoices.js';
import {
  lasTidposterTillFaktura, setInvoiceAppendix, valjOchLasTidposter, type ValdTidpost,
} from './invoiceAppendix.js';
import { delarOverBekraftatTak, gallandeTaxa } from './contracts.js';
import { writeAudit } from './auditService.js';

/**
 * Bilagans gruppering (story 3).
 *   'per_datum'     — tidsspecifikation per datum, formatet från faktura
 *                     0000027. Fortsatt default: det är formatet kunderna fått.
 *   'per_avtalsdel' — en rad per avtalsdel, utan datum (bilagemotorns
 *                     kategorivariant ur 0063). En kategoribilaga svarar på VAD
 *                     arbetet gällde, och då är fakturadatumet upprepat på
 *                     varje rad en uppgift som inte finns.
 */
export const APPENDIX_LAYOUTS = ['per_datum', 'per_avtalsdel'] as const;
export type AppendixLayout = (typeof APPENDIX_LAYOUTS)[number];

export interface CreateInvoiceFromTimeInput {
  customerId: string;
  projectId: string;
  from: string;
  to: string;
  invoiceDate: string;
  dueDate?: string;
  reference?: string;
  ourReference?: string;
  /** Poster som människan tagit undan ur just den här faktureringen. */
  excludeEntryIds?: string[];
  title?: string;
  preamble?: string;
  appendixLayout?: AppendixLayout;
  /** Uttalat ja till att fakturera förbi ett BEKRÄFTAT avtalstak (KRAV-11). */
  confirmOverCap?: boolean;
}

/** Hinken för tid som inte hör till någon avtalsdel (KRAV-10). */
const OVRIGT = 'Övrigt';

interface Klassning {
  id: string;
  contract_part_id: string | null;
  part_code: string | null;
  part_name: string | null;
  sort_order: number | null;
  post_taxa: number | null;
  del_taxa: number | null;
  avtal_taxa: number | null;
}

interface Fakturagrupp {
  /** Avtalsdelen gruppen hör till; null = tid utan del. */
  delId: string | null;
  /** Sorteringsnyckel: avtalsdelens ordning, 'Övrigt' sist. */
  ordning: [number, string];
  /** Raden på fakturan: delens code + name, annars uppdragets namn. */
  radtext: string;
  /** Bilageraden: delens namn. */
  bilagetext: string;
  taxa: number;
  minuter: number;
}

/**
 * Momssatsen när ingen annan källa säger något annat (David 1/9). Konsulttid
 * inom Sverige är 25 %; intäktskontot lämnas till createInvoice, som defaultar
 * till 3001. Att låta någon av dem vara underförstådd skulle göra en
 * momsfråga till en tyst gissning.
 */
const MOMS_KONSULTTID: VatRate = 25;

/** Timmar ur minuter, två decimaler — samma tal som hamnar på fakturaraden. */
function timmar(minuter: number): number {
  return Math.round((minuter / 60) * 100) / 100;
}

export async function createInvoiceFromTime(
  client: PoolClient, companyId: string, userId: string, input: CreateInvoiceFromTimeInput,
): Promise<Record<string, unknown>> {
  const layout: AppendixLayout = input.appendixLayout ?? 'per_datum';

  const p = await client.query<{ name: string; hourly_rate_ore: number | null }>(
    'SELECT name, hourly_rate_ore FROM projects WHERE id = $1 AND company_id = $2',
    [input.projectId, companyId],
  );
  const projekt = p.rows[0];
  if (!projekt) throw new NotFoundError('project');

  // Urvalet först — låset ligger på posterna INNAN fakturan finns, så att en
  // faktura aldrig hinner skapas mot tid som någon annan redan tagit.
  const entries = await valjOchLasTidposter(client, companyId, {
    from: input.from, to: input.to, projectId: input.projectId, excludeEntryIds: input.excludeEntryIds,
  });

  // Klassificeringen hämtas ur exakt de LÅSTA raderna (id för id) — aldrig ur
  // en ny fråga med samma predikat. Bilagemotorns urval är oförändrat; det som
  // tillkommer här är vad varje vald post hör till i avtalet.
  const klassning = await client.query<Klassning>(
    `SELECT t.id, t.contract_part_id, cp.code AS part_code, cp.name AS part_name, cp.sort_order,
            t.hourly_rate_ore AS post_taxa, cp.hourly_rate_ore AS del_taxa, c.hourly_rate_ore AS avtal_taxa
       FROM time_entries t
       LEFT JOIN contract_parts cp ON cp.id = t.contract_part_id AND cp.company_id = t.company_id
       LEFT JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
      WHERE t.company_id = $1 AND t.id = ANY($2::uuid[])`,
    [companyId, entries.map((e) => e.id)],
  );
  const perId = new Map<string, Klassning>(klassning.rows.map((r) => [r.id, r]));
  // En faktura där INGEN post är klassad ÄR uppdraget: då står uppdragets namn
  // på raden precis som före story 3. 'Övrigt' skrivs bara ut när det finns
  // avtalsdelar att stå bredvid — annars hade en oförändrad faktura plötsligt
  // haft en enda rad som hette "Övrigt".
  const finnsDel = klassning.rows.some((r) => r.contract_part_id !== null);

  // En rad per AVTALSDEL, och inom delen en rad per taxa. Posterna kan bära
  // olika pris, och att slå ihop dem till ett snitt hade gjort fakturabeloppet
  // omöjligt att härleda ur bilagan.
  const grupper = new Map<string, Fakturagrupp>();
  for (const e of entries) {
    const k = perId.get(e.id);
    const taxa = gallandeTaxa(
      k?.post_taxa ?? e.hourly_rate_ore, k?.del_taxa ?? null, k?.avtal_taxa ?? null, projekt.hourly_rate_ore,
    );
    // Ett saknat pris är en fråga, inte en nolla. En rad utan taxa hade blivit
    // en rad på 0 kr på en faktura som ser komplett ut — samma tysta noll som
    // lärdom 7 i STATUS.md.
    if (taxa === null) {
      throw new BadRequestError(
        'missing_hourly_rate',
        `tidposten ${e.work_date} har ingen timtaxa och uppdraget har ingen heller — sätt en taxa i stället för att fakturera noll`,
      );
    }
    const delId = k?.contract_part_id ?? null;
    const nyckel = `${delId ?? ''}|${taxa}`;
    const grupp: Fakturagrupp = grupper.get(nyckel) ?? {
      delId,
      ordning: [delId ? k!.sort_order ?? 0 : Number.MAX_SAFE_INTEGER, delId ? k!.part_code! : ''],
      radtext: delId ? `${k!.part_code} ${k!.part_name}` : finnsDel ? OVRIGT : projekt.name,
      bilagetext: delId ? k!.part_name! : finnsDel ? OVRIGT : projekt.name,
      taxa,
      minuter: 0,
    };
    grupp.minuter += e.billable_minutes;
    grupper.set(nyckel, grupp);
  }

  const sorterade = [...grupper.values()].sort((a, b) => (
    a.ordning[0] - b.ordning[0] || a.ordning[1].localeCompare(b.ordning[1]) || a.taxa - b.taxa
  ));
  const rader = sorterade.map((g) => ({
    description: g.radtext,
    quantity: timmar(g.minuter),
    unit: 'h',
    unit_price_ore: g.taxa,
    vat_rate: MOMS_KONSULTTID,
  }));

  // Spärren (KRAV-11). Här — och bara här — säger systemet nej: registreringen
  // spärras aldrig, men en faktura ÄR pengarna. Ett obekräftat eller saknat tak
  // spärrar inte, eftersom en spärr på ett oläst tal bara lär mottagaren att
  // forcera varje gång.
  const berordaDelar = [...new Set(klassning.rows.map((r) => r.contract_part_id).filter((v): v is string => v !== null))];
  const over = await delarOverBekraftatTak(client, companyId, berordaDelar);
  if (over.length > 0 && input.confirmOverCap !== true) {
    throw new ConflictError(
      'cap_exceeded',
      `avtalsdelen ${over[0]!.code} ${over[0]!.name} är över sitt bekräftade tak — `
      + 'sätt confirm_over_cap för att fakturera ändå (avtalet kräver skriftligt besked till kunden om ändrad omfattning)',
    );
  }

  const skapad = await createInvoice(client, companyId, userId, {
    customer_id: input.customerId,
    invoice_date: input.invoiceDate,
    due_date: input.dueDate,
    reference: input.reference,
    our_reference: input.ourReference,
    lines: rader,
  });
  const invoiceId = skapad.id as string;

  // Uppdraget på fakturahuvudet (kolumnen finns sedan 0060): utan den går
  // fakturan inte att spåra tillbaka till tiden den kom ur.
  await client.query(
    'UPDATE invoices SET project_id = $3 WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId, input.projectId],
  );

  // Bilagan ur SAMMA låsta rader som fakturaraderna räknades ur — inte ur en ny
  // fråga. En andra fråga hade kunnat ge ett annat urval, och då vore bilagan
  // ett annat underlag än beloppet den ska förklara. Grupperingen per avtalsdel
  // slår ihop rader som redan är sammanslagna på fakturan; inga andra minuter,
  // samma summa.
  // Insättningsordningen ÄR radordningen: `sorterade` är redan i avtalets
  // ordning med 'Övrigt' sist, och en Map behåller den.
  // Nyckeln är avtalsdelens ID, inte dess namn: två delar får heta likadant, och
  // då ska de ändå vara två rader.
  const perAvtalsdel = new Map<string, { text: string; minuter: number }>();
  for (const g of sorterade) {
    const nyckel = g.delId ?? '';
    const hink = perAvtalsdel.get(nyckel) ?? { text: g.bilagetext, minuter: 0 };
    hink.minuter += g.minuter;
    perAvtalsdel.set(nyckel, hink);
  }
  await setInvoiceAppendix(client, companyId, userId, {
    invoiceId,
    kind: layout === 'per_avtalsdel' ? 'category' : 'time',
    title: input.title,
    preamble: input.preamble,
    rows: layout === 'per_avtalsdel'
      ? [...perAvtalsdel.values()].map((g) => ({ description: g.text, minutes: g.minuter }))
      : entries.map((e) => ({
        entry_date: e.work_date, description: e.description, minutes: e.billable_minutes,
      })),
  });

  await lasTidposterTillFaktura(client, companyId, invoiceId, entries);

  const minuter = entries.reduce((s: number, e: ValdTidpost) => s + e.billable_minutes, 0);
  await writeAudit(client, {
    companyId, userId, action: 'invoice.created_from_time', entityType: 'invoice', entityId: invoiceId,
    details: {
      project_id: input.projectId, from: input.from, to: input.to,
      entries: entries.length, billable_minutes: minuter,
      excluded_entries: input.excludeEntryIds?.length ?? 0,
      appendix_layout: layout,
      contract_parts: berordaDelar.length,
    },
  });

  // Forceringen skrivs som en EGEN rad. Ett överskridande som bara syns som ett
  // fält på fakturans skapanderad är i praktiken osynligt; det här är beslutet
  // att fakturera förbi ett tak som en människa läst i avtalet.
  if (over.length > 0) {
    await writeAudit(client, {
      companyId, userId, action: 'invoice.cap_override', entityType: 'invoice', entityId: invoiceId,
      details: {
        parts: over.map((d) => ({
          contract_part_id: d.part_id, code: d.code, share: d.share,
          billable_minutes: d.billable_minutes, amount_ore: d.amount_ore,
          cap_hours: d.cap_hours, cap_amount_ore: d.cap_amount_ore,
        })),
      },
    });
  }

  return {
    invoice: await getInvoice(client, companyId, invoiceId),
    time_entries: entries.length,
    billable_minutes: minuter,
    appendix_layout: layout,
    ...(over.length > 0
      ? { cap_override: over.map((d) => ({ code: d.code, name: d.name, share: d.share })) }
      : {}),
  };
}
