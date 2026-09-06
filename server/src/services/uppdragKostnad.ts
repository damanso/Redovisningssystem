// Uppdragsytan S6.1, våg 4: kostnaden binds till avtalsdelen (PRD FR-33).
//
// Ett bokfört kvitto som hör till uppdraget ska ha en avtalsdel — annars räknas
// kostnaden inte mot något och syns inte i uppföljningen. Men bindningen är två
// olika saker beroende på vad svepet kunde se, och skillnaden är hela storyn:
//
//   * **Kunde svepet peka ut en leverabel** (förslaget bär `leverabel_kod` och
//     koden har en aktiv avtalsdel) är målet ett LÖV. Vilket löv en kostnad hör
//     till är ett omdöme, och omdömen fattas av en människa: bindningen KÖAS som
//     den känsliga åtgärden `binda_kostnad` och skriver ingenting förrän någon
//     godkänt den i Att göra.
//   * **Kunde det inte**, finns inget löv att fråga om. Då binds kostnaden
//     automatiskt till strömmen vars intervall täcker datumet, annars rotdelen
//     `UPPDRAG` — de två mål som inte kräver något omdöme alls. Ingen köpost:
//     en fråga vars enda svar är "ja, förstås" är ett handgrepp utan innehåll.
//
// Det femte handgreppet uppstår alltså aldrig: David svarar på de bindningar som
// faktiskt är beslut, och de andra sker utan honom. Kvitton UTAN kostnadsförslag
// (bolagets allmänna kostnader) rörs inte alls — de hör inte till uppdraget.
import type { PoolClient } from 'pg';
import type { Actor } from '../http/middleware/authenticate.js';
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
  /** Gren 1: köade för mänskligt godkännande. */
  koade: Array<{ receipt_id: string; contract_part_id: string; approval_id: string }>;
  /** Gren 2: bundna direkt till en ström eller rotdelen, märkta oplanerade. */
  automatiska: Array<{ receipt_id: string; contract_part_id: string; kod: string }>;
  /** Kvitton som redan hade en obesvarad bindning i kön — ingen ny post. */
  redan_koade: string[];
}

/** Ett svep som inte hade något att binda svarar med det här, aldrig med null. */
export function tomtBindningsutfall(): Bindningsutfall {
  return { koade: [], automatiska: [], redan_koade: [] };
}

/**
 * Automatbindningens vakt: målet får ALDRIG vara ett löv.
 *
 * Ett löv är ett omdöme (vilken leverabel bar kostnaden?) och omdömen går genom
 * kön. Rotdelen och strömmarna är däremot strukturen själv — de går att härleda
 * ur ett datum. Vakten står i skrivvägen och inte bara i valet ovanför den, så
 * att en framtida ändring av valet inte tyst kan öppna bakvägen: bindningssteget
 * fäller hela svepet hellre än skriver ett löv utan människa.
 */
export function kravAutomatmal(delar: Bindningsdelar, partId: string): void {
  const tillatet = partId === delar.rot.part_id || delar.strommar.some((s) => s.part_id === partId);
  if (!tillatet) {
    throw new Error(
      `bindSvepetsForslag: automatbindning mot ${partId} som varken är rotdelen eller en ström — ett löv binds bara via kön`,
    );
  }
}

/**
 * Finns redan en obesvarad `binda_kostnad` för kvittot?
 *
 * Idempotensen per kvitto (1E Del 4) mäts på det som faktiskt kan bli en
 * dubblett: en PENDING post. Ett avslaget förslag ska kunna föreslås igen nästa
 * svep (annars vore ett nej ett permanent nej), och ett utfört har satt
 * `contract_part_id` — då finns inget kostnadsförslag längre, för svepet
 * föreslår bara obundna kvitton.
 */
async function harObesvaradBindning(
  client: PoolClient, companyId: string, receiptId: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM action_approvals
      WHERE company_id = $1 AND action = 'binda_kostnad' AND status = 'pending'
        AND input->>'receipt_id' = $2
      LIMIT 1`,
    [companyId, receiptId],
  );
  return res.rowCount === 1;
}

/**
 * Svepets bindningssteg (KRAV-3): körs i svepets EGEN transaktion, direkt efter
 * förslagshärledningen, och verkar bara på den här körningens
 * `kostnadsforslag:`-värden. Ett kvitto utan kostnadsförslag rörs aldrig.
 */
export async function bindSvepetsForslag(
  client: PoolClient,
  companyId: string,
  userId: string,
  actor: Actor,
  forslag: Kostnadsforslag[],
  delar: Bindningsdelar,
): Promise<Bindningsutfall> {
  const utfall = tomtBindningsutfall();
  for (const f of forslag) {
    // Lövet enligt SAMMA versionsregel som bindningsmålen: senaste aktiva
    // versionen av koden. En avslutad (inaktiv) leverabel har ingen del att
    // föreslå, och då är det gren 2 som gäller — inte en gissning.
    const lov = f.leverabel_kod === undefined
      ? undefined
      : delar.alla.find((d) => d.code === f.leverabel_kod);

    if (lov !== undefined) {
      if (await harObesvaradBindning(client, companyId, f.receipt_id)) {
        utfall.redan_koade.push(f.receipt_id);
        continue;
      }
      // Samma funktion som `executeAction`:s sensitive-gren och samma auditrad —
      // köposten ska se likadan ut oavsett vilken ingång som skapade den
      // (mönstret i `avgorSignal`). Kvittot skrivs inte: det gör godkännandet.
      const koad = await createApproval(
        client, companyId, userId, actor, 'binda_kostnad',
        { receipt_id: f.receipt_id, contract_part_id: lov.part_id },
      );
      await writeAudit(client, {
        companyId,
        userId,
        action: 'action.approval_requested',
        entityType: 'approval',
        entityId: koad.id,
        details: { action: 'binda_kostnad', actor, receipt_id: f.receipt_id, leverabel_kod: lov.code },
      });
      utfall.koade.push({ receipt_id: f.receipt_id, contract_part_id: lov.part_id, approval_id: koad.id });
      continue;
    }

    // FR-33: strömmen vars intervall täcker datumet, annars rotdelen. Samma val
    // som förslaget skrev — ordningen är avtalets egen (`sort_order`), så två
    // överlappande strömmar ger samma mål vid varje körning.
    const strom = delar.strommar.find((s) => s.start_date !== null && s.end_date !== null
      && s.start_date <= f.datum && f.datum <= s.end_date);
    const mal = strom ?? delar.rot;
    kravAutomatmal(delar, mal.part_id);
    // BARA obundna kvitton: `contract_part_id IS NULL` i WHERE-satsen gör
    // skrivningen till en bindning och aldrig en flytt. En flytt är ett omdöme
    // och går genom kön (`binda_kostnad`).
    const skriven = await client.query(
      `UPDATE receipts SET contract_part_id = $3, oplanerad = true
        WHERE id = $1 AND company_id = $2 AND contract_part_id IS NULL
        RETURNING id`,
      [f.receipt_id, companyId, mal.part_id],
    );
    if (skriven.rowCount !== 1) continue;
    await writeAudit(client, {
      companyId,
      userId,
      action: 'receipt.contract_part_assigned',
      entityType: 'receipt',
      entityId: f.receipt_id,
      details: {
        fran_contract_part_id: null,
        till_contract_part_id: mal.part_id,
        code: mal.code,
        // Det som skiljer den här raden från godkännandets: ingen människa har
        // svarat, och kostnaden fanns inte i baselinen.
        bindning: 'automatisk',
        oplanerad: true,
      },
    });
    utfall.automatiska.push({ receipt_id: f.receipt_id, contract_part_id: mal.part_id, kod: mal.code });
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
 * godkänt köposten. Därför är en FLYTT tillåten: en automatiskt bunden kostnad
 * ska gå att flytta till rätt leverabel, och det är just det godkännandet betyder
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
