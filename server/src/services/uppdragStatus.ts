// Uppdragsytan S3.2, våg 4 (PRD FR-12/FR-13, NFR-4): statusbytet med transmittal.
//
// Svepet (S7.3) skriver `statusforslag:<kod>` i cachen när Drive rapporterat en
// ny revision av leverabelns handling. Ett förslag är inte en åtgärd (1E Del 4):
// fram till den här filen fanns ingen kodväg alls till `uppdrag_leverabel.status`
// — vilket var rätt, men gjorde också att INGEN kunde flytta en leverabel. Den
// här tjänsten är den enda vägen, och den kräver en människas handgrepp.
//
// Fyra meningar bär filen:
//
//   * **Ingen maskin flyttar en status.** Åtgärden `bekrafta_statusbyte` bär
//     `kravManniska`, så ett agentanrop fälls i `executeAction` med 403
//     `human_required` FÖRE varje skrivning (NFR-4). Spärren sitter där och inte
//     här: alla tre ingångarna går genom `executeAction`.
//   * **Transmittalfälten fylls av systemet, aldrig av handen.** Mottagaren
//     läses ur avtalets `godkannare` och revisionen räknas ur historiken.
//     Saknas godkännaren skrivs INGENTING (FR-13) — en gissad mottagare i en
//     append-only historik är en uppgift som ser ut som ett faktum.
//   * **Revisionen är systemets egen uppräkning.** 1 + högsta `revision` i
//     leverabelns händelser; första överlämningen blir 1. Drive-revisionen i
//     förslaget deltar aldrig i räkningen: den räknar filens versioner, inte
//     våra överlämningar, och de två talen har ingen anledning att följas åt.
//   * **Retur är en post, inte en tyst flytt bakåt.** `avvisad` skrivs som en
//     händelse med samma spår som bekräftelsen — den enda skillnaden är att
//     ingen överlämning skedde, alltså varken revision eller mottagare.
import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { koaRegisterkopia } from './uppdragReferens.js';

/** De två svaren på svepets förslag. Ett fritt statusfält vore en andra skrivväg. */
export const STATUSUTFALL = ['bekraftad', 'retur'] as const;
export type Statusutfall = (typeof STATUSUTFALL)[number];

/** Statusen ett förslag kan besvaras FRÅN, och de två det kan leda TILL (0068). */
const FRAN_STATUS = 'pagar';
const TILL_STATUS: Record<Statusutfall, string> = {
  bekraftad: 'levererad',
  retur: 'avvisad',
};

export interface BekraftaStatusbyteInput {
  contract_id: string;
  leverabel_kod: string;
  utfall: Statusutfall;
}

export interface Statusbytesutfall {
  contract_id: string;
  leverabel_kod: string;
  fran: string;
  status: string;
  handelse_id: string;
  revision: number | null;
  mottagare: string | null;
  bekraftat_av: string;
  bekraftat_nar: string;
  /** Registerkopians köläge efter köningen — kopian är inaktuell så fort statusen bytt. */
  ko_status: string | null;
}

interface Handelserad {
  id: string;
  revision: number | null;
  mottagare: string | null;
  bekraftat_av: string | null;
  bekraftat_nar: string | null;
}

/**
 * Bekräftar (eller returnerar) svepets statusförslag för en leverabel.
 *
 * `userId` kommer ur åtgärdskontexten, aldrig ur indatat — samma regel som
 * `satt_av_manniska` och `tand_av`: ett fält anroparen fyller i om sig själv är
 * ett påstående, inte ett spår.
 */
export async function bekraftaStatusbyte(
  client: PoolClient, companyId: string, userId: string, input: BekraftaStatusbyteInput,
): Promise<Statusbytesutfall> {
  // (1) Förslaget måste finnas. Bekräftelsen är ett svar på något svepet sett i
  // Drive; utan förslag finns ingen observation att bekräfta, och ett
  // statusbyte utan underlag är just det handgreppet ska hindra. Ett avtal i
  // ett annat bolag har inga rader här (RLS + den sammansatta FK:n) och svarar
  // därför också "finns inte" — aldrig ett databasfel.
  const forslag = await client.query(
    `SELECT 1 FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3`,
    [companyId, input.contract_id, `statusforslag:${input.leverabel_kod}`],
  );
  if (forslag.rowCount === 0) throw new NotFoundError('statusforslag');

  // (2) Leverabeln, låst för raden. FOR UPDATE och inte en vanlig SELECT: utan
  // låset kan två samtidiga bekräftelser båda läsa `pagar`, båda skriva en
  // händelse med revision 1 och båda sätta `levererad` — två överlämningar av
  // samma leverabel, med samma revisionsnummer, i en historik som inte går att
  // rätta. Samma grepp som `lockPendingApproval` i godkännandekön.
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');
  if (leverabel.status !== FRAN_STATUS) {
    throw new ConflictError(
      'leverabel_ej_pagaende',
      `leverabelns status är ${leverabel.status} — bara en leverabel som pågår kan bekräftas eller returneras`,
    );
  }

  // (3) Transmittalfälten. Bara bekräftelsen är en överlämning: en retur har
  // ingen mottagare och räknar ingen revision, och mottagarspärren gäller
  // därför inte den.
  let mottagare: string | null = null;
  let revision: number | null = null;
  if (input.utfall === 'bekraftad') {
    const avtal = await client.query<{ godkannare: string | null }>(
      'SELECT godkannare FROM contracts WHERE id = $1 AND company_id = $2',
      [input.contract_id, companyId],
    );
    const godkannare = avtal.rows[0]?.godkannare?.trim();
    // FR-13: mottagaren gissas ALDRIG. Utan avtalets godkännare skrivs
    // ingenting alls — varken händelse eller status. Ett tomt mottagarfält i en
    // append-only överlämning hade sett ut som en överlämning utan mottagare;
    // en påhittad hade varit värre.
    if (!godkannare) {
      throw new ConflictError(
        'saknad_mottagare',
        'saknad mottagare — avtalets godkännare är inte ifylld, och mottagaren hittas aldrig på',
      );
    }
    mottagare = godkannare;
    // Systemets egen uppräkning, härledd ur historiken. Returer bär NULL och
    // räknas alltså inte: de är inga överlämningar. Första gången ger 1.
    const nasta = await client.query<{ nasta: number }>(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS nasta
         FROM uppdrag_leverabel_handelse
        WHERE company_id = $1 AND leverabel_id = $2`,
      [companyId, leverabel.id],
    );
    revision = Number(nasta.rows[0]!.nasta);
  }

  // (4) Händelsen först, statusen sedan — i EN transaktion (anroparens
  // `withTenantTransaction`). Tabellen har SELECT + INSERT för rollen `app` och
  // ingenting annat (0068): raden går inte att skriva om i efterhand.
  const till = TILL_STATUS[input.utfall];
  const handelse = await client.query<Handelserad>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, bekraftat_nar, revision, mottagare)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
     RETURNING id, revision, mottagare, bekraftat_av, bekraftat_nar::text`,
    [companyId, input.contract_id, leverabel.id, FRAN_STATUS, till, userId, revision, mottagare],
  );

  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [till, leverabel.id, companyId],
  );

  // (5) Registerkopian köas om. Statusen står i kopians innehåll
  // (`lasLeverabelregister`), så ett statusbyte gör kundens frysta kopia
  // inaktuell — och `koaRegisterkopia` har sitt eget kodkontrakt: den anropas i
  // SAMMA transaktion som registerändringen (FR-11). Repot skriver aldrig ut
  // själv; Hermes tömmer kön.
  const ko = await koaRegisterkopia(client, companyId, input.contract_id);

  const rad = handelse.rows[0]!;
  return {
    contract_id: input.contract_id,
    leverabel_kod: input.leverabel_kod,
    fran: FRAN_STATUS,
    status: till,
    handelse_id: rad.id,
    revision: rad.revision,
    mottagare: rad.mottagare,
    bekraftat_av: rad.bekraftat_av!,
    bekraftat_nar: rad.bekraftat_nar!,
    ko_status: ko.ko_status,
  };
}
