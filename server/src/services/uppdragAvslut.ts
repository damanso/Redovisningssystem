// Uppdragsytan S8.1, våg 4 (PRD FR-8): avslutet med öppna leverabler.
//
// Ett uppdrag ska gå att avsluta även när något står ogodkänt — verkligheten
// slutar sällan jämnt. Men avslutet får inte TYSTA det öppna: 0068:s
// `vagrar_skrivning_pa_avslutat()` stänger all skrivning mot uppdraget i samma
// ögonblick projektet blir `closed`, och det som inte skrevs ner före den
// stängningen går därefter inte att skriva ner alls.
//
// Tre meningar bär filen:
//
//   * **Listan fryses FÖRE stängningen, i samma transaktion.** Ordningen är inte
//     kosmetik: `avsluta_uppdrag` är `sensitive` och körs därför inuti
//     `approveAction`:s enda transaktion (execute.ts), och triggern får aldrig
//     hinna se ett stängt uppdrag före kolumnifyllnaden. Faller något rullas
//     hela avslutet tillbaka — ett stängt uppdrag utan lista vore precis det
//     tysta avslut FR-8 finns för att hindra.
//   * **Listan räknas VID GODKÄNNANDET, aldrig vid förslaget.** En leverabel som
//     hinner bli `godkand` mellan förslag och godkännande står inte i listan, och
//     det faller ut av huset självt: sensitive-åtgärdens handler körs först när en
//     människa godkänt. Ingen egen mekanik behövs, och ingen egen får byggas.
//   * **Listan är fryst historik (1E §3.1) och skrivs aldrig om.** Ett redan
//     avslutat uppdrag fälls med `ConflictError` innan en enda rad rörs. Ett andra
//     avslut hade skrivit över det som stod öppet vid det FÖRSTA — och en historik
//     som går att skriva om är ingen historik.
//
// Stängningen delegeras till `setProjectStatus` (samma tjänstefunktion som
// `set_project_status`), aldrig till ett andra `executeAction`-anrop: åtgärden
// `set_project_status` bär `kravManniska` och den spärren rörs inte. Samma regel
// som `andra_baseline` följer mot `upsertContractPart`.
import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { setProjectStatus } from './projects.js';

/**
 * Den enda status som räknas som STÄNGD vid avslutet. Allt annat —
 * `ej_paborjad`, `pagar`, `levererad`, `avvisad` — stod öppet, och en levererad
 * men ogodkänd leverabel är just det avslutet ska säga högt.
 */
const GODKAND = 'godkand';

/** Ett avtal på uppdraget med sin frysta lista. Tom array = inget stod öppet. */
export interface Avslutatavtal {
  contract_id: string;
  namn: string;
  oppna: string[];
}

export interface Avslutsutfall {
  project_id: string;
  status: string;
  avtal: Avslutatavtal[];
}

/**
 * Avslutar uppdraget: fryser listan över det som stod öppet, och stänger sedan
 * projektet.
 *
 * `userId` kommer ur åtgärdskontexten (vid godkännandet: godkännaren), aldrig ur
 * indatat — samma regel som `bekraftat_av` i `bekraftaStatusbyte`.
 */
export async function avslutaUppdrag(
  client: PoolClient, companyId: string, userId: string, projectId: string,
): Promise<Avslutsutfall> {
  // (1) Projektraden, låst. Utan `FOR UPDATE` kan två samtidiga avslut båda läsa
  // `active`, båda räkna sin lista och båda skriva — och den andra skrivningen
  // hade skrivit över den första listan utan att någon sett det. Samma grepp som
  // `bekraftaStatusbyte` och `lockPendingApproval`.
  const p = await client.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [projectId, companyId],
  );
  const projekt = p.rows[0];
  if (!projekt) throw new NotFoundError('project');
  if (projekt.status === 'closed') {
    throw new ConflictError(
      'uppdrag_redan_avslutat',
      'uppdraget är redan avslutat — listan över det som stod öppet är fryst historik och skrivs aldrig om',
    );
  }

  // (2) Listan per avtal, FÖRE stängningen. Ett uppdrag kan ha flera avtal
  // (tilläggsavtal), och kolumnen bor på avtalet: varje avtal bär sin egen
  // lista, aldrig en hopslagen.
  const avtal = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM contracts WHERE company_id = $1 AND project_id = $2 ORDER BY name, id',
    [companyId, projectId],
  );

  const utfall: Avslutatavtal[] = [];
  for (const a of avtal.rows) {
    const oppna = (await client.query<{ kod: string }>(
      `SELECT kod FROM uppdrag_leverabel
        WHERE company_id = $1 AND contract_id = $2 AND status <> $3
        ORDER BY kod`,
      [companyId, a.id, GODKAND],
    )).rows.map((r) => r.kod);

    // Tom array när inget står öppet — aldrig NULL. Skillnaden är hela
    // läsbarheten: NULL betyder "aldrig avslutad via åtgärden", `{}` betyder
    // "avslutad, och ingenting stod öppet". Ett fält som betyder två saker är
    // ett fält man inte kan lita på.
    await client.query(
      'UPDATE contracts SET avslutat_med_oppna = $3 WHERE id = $1 AND company_id = $2',
      [a.id, companyId, oppna],
    );

    // Husets invariant: skrivoperationen auditloggas i SAMMA transaktion som
    // mutationen, med listan i klartext. `project.set_status`-raden skrivs redan
    // av `setProjectStatus` nedan — den här raden är listans egen.
    await writeAudit(client, {
      companyId,
      userId,
      action: 'uppdrag.avslutat_med_oppna',
      entityType: 'contract',
      entityId: a.id,
      details: { project_id: projectId, oppna },
    });

    utfall.push({ contract_id: a.id, namn: a.name, oppna });
  }

  // (3) Stängningen sist, genom tjänstefunktionen. Efter den här satsen fäller
  // 0068:s trigger varje skrivning mot uppdraget — och listan står redan där.
  const projektEfter = await setProjectStatus(client, companyId, userId, projectId, 'closed');

  return {
    project_id: projectId,
    status: String(projektEfter.status ?? 'closed'),
    avtal: utfall,
  };
}

/**
 * Avslutslistan som vyn läser (KRAV-4). Bara avtal där kolumnen faktiskt är satt
 * kommer med: ett uppdrag som stängts på annat sätt har ingen fryst lista, och
 * en tom panel som påstår att ingenting stod öppet vore ett påstående systemet
 * inte har täckning för.
 */
export async function lasAvslutslista(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Avslutatavtal[]> {
  const res = await client.query<{ id: string; name: string; avslutat_med_oppna: string[] | null }>(
    `SELECT id, name, avslutat_med_oppna FROM contracts
      WHERE company_id = $1 AND project_id = $2 AND avslutat_med_oppna IS NOT NULL
      ORDER BY name, id`,
    [companyId, projectId],
  );
  return res.rows.map((r) => ({
    contract_id: r.id,
    namn: r.name,
    oppna: r.avslutat_med_oppna ?? [],
  }));
}
