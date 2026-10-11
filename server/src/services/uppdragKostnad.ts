// Uppdragsytan S6.1 och Story 1.8 (B-6): kostnaden binds till avtalsdelen (PRD FR-33).
//
// Varje bindning är Davids beslut, oavsett belopp och nivå (FR-4). Svepet
// föreslår, kön bär förslaget (ADR-6b), och bara verkställigheten av ett
// mottaget ja skriver `receipts.contract_part_id` (`bindaKostnad` nedan,
// genom `registreraJa`, Story 1.7):
//
//   * **Kan svepet peka ut en leverabel** (förslagets `leverabel_kod` har en
//     aktiv avtalsdel) gäller förslaget lövet.
//   * **Annars** gäller det strömmen vars intervall täcker kvittots datum, och
//     finns ingen sådan rotdelen `UPPDRAG`. Det är fortfarande ett förslag: en
//     kostnad binds aldrig till ström eller uppdrag utan samma godkännande.
//
// Kvitton UTAN kostnadsförslag (bolagets allmänna kostnader) rörs inte alls.

import type { PoolClient } from 'pg';
import { valjBindningsmal } from '../lib/bindningsmal.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';

/** En avtalsdelsversion som bindningen kan peka på (svepets `bindningsmal`). */
export interface Bindningsdel {
  part_id: string;
  code: string;
  parent_part_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Delarna bindningssteget väljer bland: rotdelen, strömmarna under den, och
 * ALLA aktiva delar (leverablerna ligger ett steg längre ned). Samma
 * versionsregel för alla tre — de kommer ur samma `DISTINCT ON (code)`-läsning.
 */
export interface Bindningsdelar {
  rot: Bindningsdel;
  strommar: Bindningsdel[];
  alla: Bindningsdel[];
}

/** Det svepet härledde om ETT kvitto (`kostnadsforslag:<receipt_id>`). */
export interface Kostnadsforslag {
  receipt_id: string;
  datum: string;
  /** Leverabeln handlingen hörde till. Utan den finns inget löv att föreslå. */
  leverabel_kod?: string | undefined;
}

export interface Bindningsutfall {
  /** Köade för mänskligt godkännande: varje förslag, till löv, ström eller rotdel. */
  koade: Array<{ receipt_id: string; contract_part_id: string; approval_id: string }>;
  /**
   * Alltid tom sedan Story 1.8: ingen väg binder utan kön (B-6). Fältet står
   * kvar eftersom svepets svar får nya fält men aldrig tappar gamla
   * (architecture.md, Svepkontraktet).
   */
  automatiska: [];
  /** Kvitton som redan har en `binda_kostnad`-köpost, i vilken status som helst. */
  redan_koade: string[];
}

/** Ett svep som inte hade något att binda svarar med det här, aldrig med null. */
export function tomtBindningsutfall(): Bindningsutfall {
  return { koade: [], automatiska: [], redan_koade: [] };
}

/**
 * Kvittona som redan har en `binda_kostnad`, i vilken status som helst.
 *
 * Idempotensen per kvitto gäller alla statusar (B-6, Story 1.8). Ett nej är
 * Davids svar och återkommer inte som ny fråga, och en köpost som väntar, är
 * mottagen, verkställd eller fallerad föder ingen andra. Ett nytt förslag när
 * underlaget ändrats är Story 5.1:s regel (`forslag_hash`). `lower`: en
 * människas köpost kan bära id:t i versaler (`UuidSchema` tar emot dem), och
 * jsonb jämför text. Mängden bär id:n i gemener.
 */
async function kvittonMedBindningskopost(
  client: PoolClient, companyId: string, receiptIds: string[],
): Promise<Set<string>> {
  const res = await client.query<{ receipt_id: string }>(
    `SELECT DISTINCT lower(input->>'receipt_id') AS receipt_id FROM action_approvals
      WHERE company_id = $1 AND action = 'binda_kostnad'
        AND lower(input->>'receipt_id') = ANY($2::text[])`,
    [companyId, receiptIds.map((id) => id.toLowerCase())],
  );
  return new Set(res.rows.map((r) => r.receipt_id));
}

/**
 * Svepets bindningssteg (KRAV-3, Story 1.8): körs i svepets EGEN transaktion,
 * direkt efter förslagshärledningen, och verkar bara på den här körningens
 * `kostnadsforslag:`-värden. Varje förslag köas som `binda_kostnad`. Steget
 * skriver aldrig ett kvitto.
 */
export async function bindSvepetsForslag(
  client: PoolClient,
  companyId: string,
  userId: string,
  forslag: Kostnadsforslag[],
  delar: Bindningsdelar,
): Promise<Bindningsutfall> {
  const utfall = tomtBindningsutfall();
  // En fråga för hela körningen. Svepets `obundnaKvitton` ger varje kvitto en
  // gång, så ett kvitto står en gång i `forslag`. Ett senare uppdrag i samma
  // svep ser de här köposterna, eftersom allt sker i svepets transaktion.
  const harKopost = await kvittonMedBindningskopost(client, companyId, forslag.map((f) => f.receipt_id));
  for (const f of forslag) {
    if (harKopost.has(f.receipt_id.toLowerCase())) {
      utfall.redan_koade.push(f.receipt_id);
      continue;
    }
    const mal = valjBindningsmal(delar, f);
    // Svepets förslag är maskinens, oavsett vem som körde svepet: aktören är
    // alltid 'agent' (architecture.md, Kommunikationsmönster; PRD FR-33). Samma
    // funktion och samma auditrad som `executeAction`:s sensitive-gren.
    const koad = await createApproval(
      client, companyId, userId, 'agent', 'binda_kostnad',
      { receipt_id: f.receipt_id, contract_part_id: mal.part_id },
    );
    await writeAudit(client, {
      companyId,
      userId,
      action: 'action.approval_requested',
      entityType: 'approval',
      entityId: koad.id,
      details: { action: 'binda_kostnad', actor: 'agent', receipt_id: f.receipt_id, leverabel_kod: f.leverabel_kod ?? null },
    });
    utfall.koade.push({ receipt_id: f.receipt_id, contract_part_id: mal.part_id, approval_id: koad.id });
  }
  return utfall;
}

export interface BindaKostnadInput {
  receipt_id: string;
  contract_part_id: string;
}

/**
 * Binder ett kvitto till en avtalsdel — och gör INGENTING annat (mönstret
 * `assignContractPart`).
 *
 * Åtgärden är `sensitive`, så den här funktionen körs först när en människa
 * godkänt köposten. Därför är en FLYTT tillåten: en kostnad som är bunden till
 * ström eller uppdrag ska gå att flytta till rätt leverabel, och det är just
 * det godkännandet betyder
 * (KRAV-2, "flyttbar via kön"). `oplanerad` rörs aldrig — den säger att kostnaden
 * inte fanns i baselinen, och det blir inte osant för att någon flyttar den.
 *
 * Spärren mot ett avslutat uppdrag ligger kvar i 0068:s `receipts_vagrar_avslutat`
 * — en kopia av den här hade hunnit divergera från triggern.
 */
export async function bindaKostnad(
  client: PoolClient, companyId: string, userId: string, input: BindaKostnadInput,
): Promise<Record<string, unknown>> {
  const res = await client.query<{ id: string; contract_part_id: string | null; status: string }>(
    `SELECT id, contract_part_id, status FROM receipts
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.receipt_id, companyId],
  );
  const kvitto = res.rows[0];
  if (!kvitto) throw new NotFoundError('receipt');

  // Grannbolagets del döljs redan av RLS; uppslaget gör svaret till "finns inte"
  // i stället för ett främmande-nyckel-fel ur databasen.
  const del = await client.query<{ id: string; code: string }>(
    'SELECT id, code FROM contract_parts WHERE id = $1 AND company_id = $2',
    [input.contract_part_id, companyId],
  );
  const delrad = del.rows[0];
  if (!delrad) throw new NotFoundError('contract_part');

  const uppdaterad = await client.query(
    'UPDATE receipts SET contract_part_id = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [input.receipt_id, companyId, input.contract_part_id],
  );
  if (uppdaterad.rowCount !== 1) {
    throw new ConflictError('receipt_changed', 'kvittot ändrades av en annan skrivning — försök igen');
  }

  await writeAudit(client, {
    companyId,
    userId,
    action: 'receipt.contract_part_assigned',
    entityType: 'receipt',
    entityId: input.receipt_id,
    details: {
      fran_contract_part_id: kvitto.contract_part_id,
      till_contract_part_id: input.contract_part_id,
      code: delrad.code,
      status: kvitto.status,
    },
  });

  return {
    id: input.receipt_id,
    contract_part_id: input.contract_part_id,
    contract_part_code: delrad.code,
    status: kvitto.status,
  };
}
