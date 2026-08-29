// Städytan för crm.people — platsen där man SER vad som är fel och RÄTTAR det.
//
// Bakgrunden är en fråga som nådde beställaren i en beslutskö: "vilka av raderna
// i crm.people är samma person?" Frågan gick att ställa, men inte att besvara:
// kunder har en vy med skrivväg, personerna i relationen hade ingen vy alls. Han
// fick alltså en fråga om data han inte kunde se någonstans i systemet, och en
// begärd åtgärd han inte kunde utföra någonstans i systemet.
//
// Modulen finns för att svaret ska gå att GE på samma sida som frågan syns. Den
// gör tre saker, och den tredje är den som betyder mest:
//
//   1. RÄKNAR. Frågan beskrevs som "ungefär 35 namn att gå igenom". Ingen hade
//      räknat. Det verkliga talet räknas fram här, vid varje sidladdning, ur
//      raderna själva — aldrig ur en siffra som någon bar med sig in i frågan.
//   2. DELAR UPP raderna i exakt tre högar som tillsammans är hela tabellen:
//      delade namn, namn som är en e-postadress, och resten. Partitionen är
//      avsiktlig — en lista som bara visar "det systemet tycker är fel" döljer
//      hur stor helheten är, och då går det inte att veta när man är klar.
//   3. RÄKNAR UT KONSEKVENSEN i förväg. Sammanslagningen går inte att ångra
//      (crmMerge.mergePeople gör DELETE på den inslagna raden), så antalet
//      kontaktpunkter och åtaganden som flyttas, och vilka fält som fylls i,
//      ska stå skrivet INNAN någon trycker. En knapp vars följd först syns
//      efteråt är inte ett beslut, det är en chansning.
//
// Ett fynd som modulen är byggd för, och som ingen räkning i frågan hade fångat:
// ett delat namn betyder INTE dubblett. I det verkliga underlaget bär tolv rader
// på samma organisation namnet "david mancilla" — och tolv olika e-postadresser.
// Det är tolv människor med fel namn. mergePeople vägrar (email_conflict), och
// det är rätt av den att vägra. Ytan måste därför säga vilket av de två fallen
// en grupp är, innan den erbjuder en knapp.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeCrmAudit } from './crmRelations.js';
import { recordProvenance } from './crmProvenance.js';
import { mergePeople } from './crmMerge.js';

/**
 * Ett namn som i själva verket är en e-postadress.
 *
 * Medvetet trubbig: den ska känna igen "adam.lorin@synologen.se" och lämna
 * "Adam Lorin" i fred, inte validera adresser. Ett efternamn med snabel-a finns
 * inte, och en falsk träff kostar bara en rad extra i fel hög — den raden går
 * ändå att rätta med samma formulär.
 */
const NAMN_SOM_AR_EPOST = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fälten mergePeople fyller på den kvarvarande raden, i den ordning den gör det. */
const IFYLLBARA = ['email', 'phone', 'role_title', 'external_ref', 'notes', 'organization_id'] as const;

export interface StadPerson {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  external_ref: string | null;
  /** Bara förekomsten. Anteckningens TEXT hör inte hemma i en skanningslista. */
  har_notes: boolean;
  organization_id: string | null;
  organization_name: string | null;
  created_at: string;
  last_contact_at: string | null;
  interactions: number;
  commitments: number;
}

/** Vad knappen "behåll denna" faktiskt gör — i siffror, före klicket. */
export interface Utfall {
  keep_id: string;
  /** Raderna som slås in. Bara de som GÅR att slå in; resten står i `hindrade`. */
  merge_ids: string[];
  interactions: number;
  commitments: number;
  /** Fält som fylls i på den kvarvarande raden, i den ordning de fylls. */
  filled_fields: string[];
  /** Rader som inte kan slås in hit, med skälet. Tystnad här vore det värsta utfallet. */
  hindrade: { id: string; skal: string }[];
}

export interface Namngrupp {
  /** Nyckeln grupperingen sker på: gemener, trimmat. */
  norm: string;
  /** Namnet som det står på den äldsta raden — det som människan känner igen. */
  visningsnamn: string;
  rader: StadPerson[];
  interactions: number;
  commitments: number;
  /** Ett utfall per rad, i samma ordning som `rader`. */
  utfall: Utfall[];
  /**
   * Sant när ingen rad i gruppen kan slås ihop med någon annan. Då är gruppen
   * inte en dubblett utan samma felaktiga namn på flera personer, och ytan ska
   * säga det i stället för att erbjuda en knapp som bara kan misslyckas.
   */
  inga_dubbletter: boolean;
}

export interface Stadbild {
  /** Alla rader i crm.people för bolaget. Nämnaren i varje påstående på sidan. */
  totalt: number;
  grupper: Namngrupp[];
  epostnamn: StadPerson[];
  ovriga: StadPerson[];
}

const PERSON_SQL = `
  SELECT p.id, p.name, p.email, p.phone, p.role_title, p.external_ref,
         (p.notes IS NOT NULL) AS har_notes,
         p.organization_id, o.name AS organization_name,
         p.created_at::date::text AS created_at,
         (SELECT max(i.occurred_at)::date::text FROM crm.interactions i
           WHERE i.company_id = p.company_id AND i.person_id = p.id) AS last_contact_at,
         (SELECT count(*)::int FROM crm.interactions i
           WHERE i.company_id = p.company_id AND i.person_id = p.id) AS interactions,
         (SELECT count(*)::int FROM crm.commitments c
           WHERE c.company_id = p.company_id AND c.person_id = p.id) AS commitments
  FROM crm.people p
  LEFT JOIN crm.organizations o ON o.id = p.organization_id AND o.company_id = p.company_id
  WHERE p.company_id = $1
  ORDER BY lower(btrim(p.name)), p.created_at, p.id`;

/** Kanonisk ordning på ett par, så att (A,B) och (B,A) är samma beslut. */
function par(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function normalisera(namn: string): string {
  return namn.trim().toLowerCase();
}

/**
 * Kan en rad med adressen `gone` slås in i en rad som bär `barande`? Samma regel
 * som mergePeople, uträknad i förväg: två OLIKA adresser betyder sannolikt två
 * personer. Regeln speglas här i stället för att gissas, så att sidan aldrig
 * visar en knapp som tjänsten kommer att vägra.
 *
 * `barande` är den adress den kvarvarande raden HAR NÄR TUREN KOMMER — inte den
 * den hade när sidan började ritas. Sammanslagningen körs en rad i taget och
 * fyller en tom e-post från den första inslagna rad som har en, så en rad utan
 * adress som får två olika inslagna skulle annars utlovas och sedan vägras.
 */
function hinder(barande: string | null, gone: StadPerson): string | null {
  if (barande && gone.email && barande.toLowerCase() !== gone.email.toLowerCase()) {
    return `har e-posten ${gone.email} — en annan adress än den som blir kvar, alltså sannolikt en annan person`;
  }
  return null;
}

/**
 * Simulerar mergePeople:s ifyllning, rad för rad i den ordning knappen kör dem.
 *
 * Regeln i tjänsten är "ifyllning, aldrig överskrivning": bara TOMMA fält på den
 * kvarvarande raden fylls, och den första inslagna raden som har ett värde vinner.
 * Att räkna om samma sak här i stället för att gissa "ungefär de här fälten" är
 * poängen — texten på sidan ska vara sann, inte ungefärlig.
 */
function ifyllda(keep: StadPerson, gonePersons: readonly StadPerson[]): string[] {
  const har: Record<string, boolean> = {
    email: keep.email !== null, phone: keep.phone !== null, role_title: keep.role_title !== null,
    external_ref: keep.external_ref !== null, notes: keep.har_notes,
    organization_id: keep.organization_id !== null,
  };
  const finns = (p: StadPerson, f: string): boolean => (
    f === 'email' ? p.email !== null : f === 'phone' ? p.phone !== null
      : f === 'role_title' ? p.role_title !== null : f === 'external_ref' ? p.external_ref !== null
        : f === 'notes' ? p.har_notes : p.organization_id !== null
  );
  const ut: string[] = [];
  for (const g of gonePersons) {
    for (const f of IFYLLBARA) {
      if (har[f] || !finns(g, f)) continue;
      har[f] = true;
      ut.push(f);
    }
  }
  return ut;
}

/**
 * Hela städbilden i EN läsning av tabellen.
 *
 * De tre högarna är en PARTITION av crm.people: varje rad ligger i exakt en av
 * dem, och summan är `totalt`. Det är därför "resten" finns som egen hög — utan
 * den vore sidan en felrapport, och en felrapport svarar inte på frågan "hur
 * mycket är kvar". Ordningen mellan högarna är precedens: en rad som ligger i en
 * öppen namngrupp visas där, även om namnet också råkar vara en e-postadress.
 */
export async function stadbild(client: PoolClient, companyId: string): Promise<Stadbild> {
  const alla = (await client.query<StadPerson>(PERSON_SQL, [companyId])).rows;
  const avfardade = await client.query<{ person_low: string; person_high: string }>(
    'SELECT person_low, person_high FROM crm.person_distinctions WHERE company_id = $1', [companyId]);
  const olika = new Set(avfardade.rows.map((r) => `${r.person_low}|${r.person_high}`));
  const arOlika = (a: string, b: string): boolean => {
    const [low, high] = par(a, b);
    return olika.has(`${low}|${high}`);
  };

  const efterNamn = new Map<string, StadPerson[]>();
  for (const p of alla) {
    const n = normalisera(p.name);
    const lista = efterNamn.get(n);
    if (lista) lista.push(p); else efterNamn.set(n, [p]);
  }

  const grupper: Namngrupp[] = [];
  const iGrupp = new Set<string>();
  for (const [norm, rader] of efterNamn) {
    if (rader.length < 2) continue;
    // Är VARJE par avfärdat är gruppen färdigbedömd och ska inte komma tillbaka.
    // Dyker en ny rad med samma namn upp får den nya par, och gruppen syns igen —
    // vilket är rätt: en ny rad är ny information, inte det gamla beslutet.
    const oppen = rader.some((a, i) => rader.slice(i + 1).some((b) => !arOlika(a.id, b.id)));
    if (!oppen) continue;

    const utfall = rader.map<Utfall>((keep) => {
      const kandidater = rader.filter((o) => o.id !== keep.id && !arOlika(keep.id, o.id));
      const hindrade: { id: string; skal: string }[] = [];
      const gar: StadPerson[] = [];
      // Adressen den kvarvarande raden bär, uppdaterad efter hand precis som
      // mergePeople gör det. Se hinder() ovan.
      let barande = keep.email;
      for (const o of kandidater) {
        const h = hinder(barande, o);
        if (h) { hindrade.push({ id: o.id, skal: h }); continue; }
        gar.push(o);
        if (!barande && o.email) barande = o.email;
      }
      return {
        keep_id: keep.id,
        merge_ids: gar.map((g) => g.id),
        interactions: gar.reduce((s, g) => s + g.interactions, 0),
        commitments: gar.reduce((s, g) => s + g.commitments, 0),
        filled_fields: ifyllda(keep, gar),
        hindrade,
      };
    });

    for (const p of rader) iGrupp.add(p.id);
    grupper.push({
      norm,
      visningsnamn: rader[0]!.name,
      rader,
      interactions: rader.reduce((s, p) => s + p.interactions, 0),
      commitments: rader.reduce((s, p) => s + p.commitments, 0),
      utfall,
      inga_dubbletter: utfall.every((u) => u.merge_ids.length === 0),
    });
  }
  // Störst grupp först: den kostar mest att låta ligga.
  grupper.sort((a, b) => b.rader.length - a.rader.length || a.norm.localeCompare(b.norm, 'sv'));

  const kvar = alla.filter((p) => !iGrupp.has(p.id));
  return {
    totalt: alla.length,
    grupper,
    epostnamn: kvar.filter((p) => NAMN_SOM_AR_EPOST.test(p.name.trim())),
    ovriga: kvar.filter((p) => !NAMN_SOM_AR_EPOST.test(p.name.trim())),
  };
}

async function laddaNamn(client: PoolClient, companyId: string, id: string): Promise<string> {
  const r = await client.query<{ name: string }>(
    'SELECT name FROM crm.people WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('person');
  return r.rows[0].name;
}

export interface SlaIhopResultat {
  merged: number;
  interactions: number;
  commitments: number;
  filled_fields: string[];
}

/**
 * Slår in flera rader i EN som behålls — hela gruppen i ett grepp, i en transaktion.
 *
 * Anroparen skickar med id:na, men de KONTROLLERAS här: samma bolag, samma
 * normaliserade namn, och inte redan avfärdade som olika personer. Listan i
 * formuläret är ett förslag från sidan, aldrig en fullmakt — samma regel som
 * gäller allt annat indata i systemet.
 *
 * Går en enda ihopslagning fel rullas HELA greppet tillbaka (transaktionen ägs av
 * anroparen). Det är avsiktligt: ett halvt utfört grepp på en åtgärd som inte går
 * att ångra vore det sämsta av två världar — några rader borta, resten kvar, och
 * ingen text som säger vilka.
 */
export async function slaIhopPersoner(
  client: PoolClient, companyId: string, userId: string,
  keepId: string, mergeIds: readonly string[],
): Promise<SlaIhopResultat> {
  const unika = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (unika.length === 0) {
    throw new BadRequestError('inget_att_sla_ihop', 'ingen annan rad var vald — det finns ingenting att slå ihop');
  }
  const norm = normalisera(await laddaNamn(client, companyId, keepId));

  const ut: SlaIhopResultat = { merged: 0, interactions: 0, commitments: 0, filled_fields: [] };
  for (const id of unika) {
    if (normalisera(await laddaNamn(client, companyId, id)) !== norm) {
      throw new BadRequestError('annat_namn',
        'raderna delar inte namn — städytan slår bara ihop inom en namngrupp');
    }
    const [low, high] = par(keepId, id);
    const avfardat = await client.query(
      'SELECT 1 FROM crm.person_distinctions WHERE company_id = $1 AND person_low = $2 AND person_high = $3',
      [companyId, low, high]);
    if (avfardat.rowCount) {
      throw new BadRequestError('markerad_som_olika',
        'raden är markerad som en annan person — ta bort den markeringen innan du slår ihop');
    }
    // Kastar BadRequestError('email_conflict') när adresserna skiljer sig. Felet
    // släpps igenom orört: det är ett verksamhetssvar, inte ett tekniskt fel, och
    // vyn har en begriplig text för det.
    const r = await mergePeople(client, companyId, userId, keepId, id);
    ut.merged += 1;
    ut.interactions += r.moved.interactions;
    ut.commitments += r.moved.commitments;
    for (const f of r.filled_fields) if (!ut.filled_fields.includes(f)) ut.filled_fields.push(f);
  }
  return ut;
}

/**
 * "De här är olika personer." Gruppens motsats till sammanslagningen.
 *
 * Ingenting flyttas och ingenting raderas — bara ett omdöme skrivs ned, parvis,
 * så att gruppen slutar dyka upp på städytan. Därför ingen godkännandekö: det
 * finns inget att ångra utom beslutet självt, och det raderas med en DELETE.
 */
export async function markeraOlikaPersoner(
  client: PoolClient, companyId: string, userId: string, personIds: readonly string[],
): Promise<{ pairs: number; people: number }> {
  const unika = [...new Set(personIds)];
  if (unika.length < 2) {
    throw new BadRequestError('for_fa_rader', 'det behövs minst två rader för att säga att de är olika personer');
  }
  const namn = await Promise.all(unika.map((id) => laddaNamn(client, companyId, id)));
  const norm = normalisera(namn[0]!);
  if (namn.some((n) => normalisera(n) !== norm)) {
    throw new BadRequestError('annat_namn', 'raderna delar inte namn — markeringen gäller en namngrupp');
  }

  let pairs = 0;
  for (let i = 0; i < unika.length; i++) {
    for (let j = i + 1; j < unika.length; j++) {
      const [low, high] = par(unika[i]!, unika[j]!);
      const r = await client.query(
        `INSERT INTO crm.person_distinctions (company_id, person_low, person_high, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [companyId, low, high, userId]);
      pairs += r.rowCount ?? 0;
    }
  }
  // Antal, aldrig namnet: crm.audit_log gallras inte och nås inte av
  // GDPR-raderingen (migration 0052) — ett personnamn här hade överlevt den
  // radering det var tänkt att träffas av.
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.people_marked_distinct', entityType: 'person', entityId: unika[0],
    details: { people: unika.length, pairs },
  });
  return { pairs, people: unika.length };
}

export interface NamnrattningResultat {
  person_id: string;
  moved_email: boolean;
}

/**
 * Rättar namnet på EN utpekad rad. Bär också regeln som gör rättningen ofarlig:
 * e-posten får inte försvinna.
 *
 * Sex rader i det verkliga underlaget har en e-postadress DÄR NAMNET SKA STÅ.
 * Skriver man dit personens riktiga namn utan mer omtanke raderar man den enda
 * identifierande uppgift raden hade — och det är dessutom den uppgift som gör
 * nästa synk idempotent. Därför flyttas adressen till e-postfältet när det är
 * tomt, i samma transaktion. Är fältet redan ifyllt (vilket alla sex råkar vara)
 * rörs det inte: ifyllning, aldrig överskrivning, samma regel som överallt annars.
 *
 * upsertPerson duger INTE till det här. Den slår upp raden på e-post eller namn
 * och kan därför inte peka ut en bestämd rad — och i en grupp där tolv rader
 * delar namn är "en bestämd rad" hela poängen.
 */
export async function rattaPersonnamn(
  client: PoolClient, companyId: string, userId: string, personId: string, nyttNamn: string,
): Promise<NamnrattningResultat> {
  const namn = nyttNamn.trim();
  if (!namn) throw new BadRequestError('invalid_name', 'namnet får inte vara tomt');

  const r = await client.query<{ name: string; email: string | null; organization_id: string | null }>(
    'SELECT name, email, organization_id FROM crm.people WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [personId, companyId]);
  const rad = r.rows[0];
  if (!rad) throw new NotFoundError('person');
  if (rad.name === namn) return { person_id: personId, moved_email: false };

  const gammaltNamnArEpost = NAMN_SOM_AR_EPOST.test(rad.name.trim());
  const flyttaEpost = rad.email === null && gammaltNamnArEpost;
  const nyEpost = flyttaEpost ? rad.name.trim() : rad.email;

  if (flyttaEpost) {
    // people_email_uk är unikt per bolag. Krockar adressen är den andra raden
    // samma person — och då är svaret en sammanslagning, inte en namnrättning.
    // Säg det, i stället för att låta indexet kasta ett rått databasfel.
    const upptagen = await client.query(
      'SELECT 1 FROM crm.people WHERE company_id = $1 AND lower(email) = lower($2) AND id <> $3',
      [companyId, nyEpost, personId]);
    if (upptagen.rowCount) {
      throw new BadRequestError('epost_upptagen',
        'e-postadressen finns redan på en annan rad — de två raderna är samma person, slå ihop dem i stället');
    }
  }

  if (nyEpost === null) {
    // people_name_uk: namn är unikt per organisation för rader UTAN e-post.
    const krock = await client.query(
      `SELECT 1 FROM crm.people
        WHERE company_id = $1 AND email IS NULL AND id <> $2
          AND organization_id IS NOT DISTINCT FROM $3::uuid AND lower(name) = lower($4)`,
      [companyId, personId, rad.organization_id, namn]);
    if (krock.rowCount) {
      throw new BadRequestError('namnet_finns',
        'det finns redan en person med det namnet i samma organisation och utan e-post — slå ihop dem i stället');
    }
  }

  await client.query('UPDATE crm.people SET name = $3, email = $4 WHERE id = $1 AND company_id = $2',
    [personId, companyId, namn, nyEpost]);

  // En människa som skriver namnet BESTÄMMER det. Utan ursprunget skulle nästa
  // synkkörning skriva tillbaka gissningen, och ingenting hade sagt till
  // (crmProvenance: människan vinner).
  await recordProvenance(client, companyId, userId, { person_id: personId },
    flyttaEpost
      ? [{ field: 'name', source: 'human' }, { field: 'email', source: 'human' }]
      : [{ field: 'name', source: 'human' }]);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.person_renamed', entityType: 'person', entityId: personId,
    // Inga namn, ingen adress — bara vad som hände. Se regeln i migration 0052.
    details: { moved_email: flyttaEpost },
  });
  return { person_id: personId, moved_email: flyttaEpost };
}
