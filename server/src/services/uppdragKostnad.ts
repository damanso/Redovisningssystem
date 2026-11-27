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
import { bindningsniva, oplaneradVidBindning } from '../lib/bindningsmal.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { BindaKostnadSchema } from '../lib/avtalsdelsfalt.js';
import { nyttBindningsforslag, type Bindningsunderlag } from '../lib/beslutsunderlag.js';
import { createApproval, MOTTAGET_EJ_VERKSTALLT } from './approvals.js';
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
  forslagsunderlag: Bindningsunderlag;
}

export interface Bindningsutfall {
  /** Köade för mänskligt godkännande: varje förslag, till löv, ström eller rotdel. */
  koade: Array<{ receipt_id: string; contract_part_id: string; approval_id: string; forslag_hash: string }>;
  /**
   * Alltid tom sedan Story 1.8: ingen väg binder utan kön (B-6). Fältet står
   * kvar eftersom svepets svar får nya fält men aldrig tappar gamla
   * (architecture.md, Svepkontraktet).
   */
  automatiska: [];
  /** Kvitton vars köposter spärrar ett nytt förslag enligt hashregeln. */
  redan_koade: string[];
  avvisade: Array<{ receipt_id: string; orsak: 'underlag_ogiltigt' }>;
}

/** Ett svep som inte hade något att binda svarar med det här, aldrig med null. */
export function tomtBindningsutfall(): Bindningsutfall {
  return { koade: [], automatiska: [], redan_koade: [], avvisade: [] };
}

/** En listfråga för alla statusar och hashar; id i JSON jämförs i gemener. */
interface Bindningskopost { status: string; mottagen_ej_verkstalld: boolean; forslag_hash: string | null }
async function kvittonMedBindningskopost(
  client: PoolClient, companyId: string, receiptIds: string[],
): Promise<Map<string, Bindningskopost[]>> {
  const res = await client.query<Bindningskopost & { receipt_id: string }>(
    `SELECT lower(input->>'receipt_id') AS receipt_id, status,
            (${MOTTAGET_EJ_VERKSTALLT}) AS mottagen_ej_verkstalld,
            input->'forslagsunderlag'->>'forslag_hash' AS forslag_hash
       FROM action_approvals
      WHERE company_id = $1 AND action = 'binda_kostnad'
        AND lower(input->>'receipt_id') = ANY($2::text[])
      ORDER BY created_at, id`,
    [companyId, receiptIds.map((id) => id.toLowerCase())],
  );
  const per = new Map<string, Bindningskopost[]>();
  for (const r of res.rows) per.set(r.receipt_id, [...per.get(r.receipt_id) ?? [], r]);
  return per;
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
    if (nyttBindningsforslag(harKopost.get(f.receipt_id.toLowerCase()) ?? [], f.forslagsunderlag?.forslag_hash ?? '') === 'redan_koad') {
      utfall.redan_koade.push(f.receipt_id);
      continue;
    }
    const underlag = f.forslagsunderlag;
    const provat = BindaKostnadSchema.safeParse({ receipt_id: f.receipt_id, contract_part_id: underlag?.mal?.part_id, forslagsunderlag: underlag });
    const tillatna = [delar.rot, ...delar.strommar, ...delar.alla];
    if (!provat.success || !provat.data.forslagsunderlag || !tillatna.some((d) => d.part_id.toLowerCase() === provat.data.contract_part_id.toLowerCase())) {
      utfall.avvisade.push({ receipt_id: f.receipt_id, orsak: 'underlag_ogiltigt' });
      continue;
    }
    const u = provat.data.forslagsunderlag;
    const mal = u.mal;
    // Svepets förslag är maskinens, oavsett vem som körde svepet: aktören är
    // alltid 'agent' (architecture.md, Kommunikationsmönster; PRD FR-33). Samma
    // funktion och samma auditrad som `executeAction`:s sensitive-gren.
    const koad = await createApproval(
      client, companyId, userId, 'agent', 'binda_kostnad',
      provat.data,
    );
    await writeAudit(client, {
      companyId,
      userId,
      action: 'action.approval_requested',
      entityType: 'approval',
      entityId: koad.id,
      details: { action: 'binda_kostnad', actor: 'agent', receipt_id: f.receipt_id, leverabel_kod: u.leverabel_kod, forslag_hash: u.forslag_hash },
    });
    utfall.koade.push({ receipt_id: f.receipt_id, contract_part_id: mal.part_id, approval_id: koad.id, forslag_hash: u.forslag_hash });
    harKopost.set(f.receipt_id.toLowerCase(), [{ status: 'pending', mottagen_ej_verkstalld: false, forslag_hash: u.forslag_hash }]);
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
 * (KRAV-2, "flyttbar via kön"). En leverabelbindning sätter `oplanerad`,
 * eftersom baselinen saknar kostnadsplan. Ingen bindning tar bort märkningen.
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
  const del = await client.query<{ id: string; code: string; parent_part_id: string | null; foralder_parent_id: string | null }>(
    `SELECT d.id, d.code, d.parent_part_id, p.parent_part_id AS foralder_parent_id
       FROM contract_parts d LEFT JOIN contract_parts p
         ON p.id = d.parent_part_id AND p.company_id = d.company_id AND p.contract_id = d.contract_id
      WHERE d.id = $1 AND d.company_id = $2`,
    [input.contract_part_id, companyId],
  );
  const delrad = del.rows[0];
  if (!delrad) throw new NotFoundError('contract_part');

  const markning = oplaneradVidBindning(bindningsniva(delrad, delrad.parent_part_id === null ? null : { parent_part_id: delrad.foralder_parent_id }));
  const uppdaterad = await client.query<{ oplanerad: boolean }>(
    'UPDATE receipts SET contract_part_id = $3, oplanerad = oplanerad OR $4 WHERE id = $1 AND company_id = $2 RETURNING id, oplanerad',
    [input.receipt_id, companyId, input.contract_part_id, markning],
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
      oplanerad: uppdaterad.rows[0]!.oplanerad,
    },
  });

  return {
    id: input.receipt_id,
    contract_part_id: input.contract_part_id,
    contract_part_code: delrad.code,
    status: kvitto.status,
    oplanerad: uppdaterad.rows[0]!.oplanerad,
  };
}
