// FR-26 kräver RLS med FORCE på varje tabell, inte bara på dem som någon kom
// ihåg att pröva. Utan ett prov över katalogen fälls inte nästa migration som
// glömmer FORCE ROW LEVEL SECURITY: tabellens ägare läser då förbi policyerna
// i tysthet, och grannbolagets rader blir nåbara (AD-13). Provet läser därför
// pg_class för schemana public och crm i stället för att räkna upp tabellerna,
// och varje regel bär en planterad negativ kontroll i en transaktion som
// rullas tillbaka. Listan «saknar RLS och FORCE — åtgärdas i Story 5.5» är
// provets enda undantag; Story 5.5 tömmer den.
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withAdmin } from './helpers.js';

/**
 * En tabell i katalogen, läst av lasKatalogen. Ett typalias och inget
 * interface, så att typen uppfyller pg:s QueryResultRow (som Innehavare i
 * globalSetup.ts).
 */
type Katalograd = {
  tabell: string; // schema.tabell
  rls: boolean;
  force: boolean;
  harBolag: boolean;
  policyer: string[]; // sorterad
};

type Regel = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';

interface Avvikelse {
  tabell: string;
  regel: Regel;
  text: string;
}

interface Listor {
  ovriga: Record<string, { policyer: string[]; skal: string }>;
  atgardasI55: Record<string, { skal: string }>;
}

const LISTOR: Listor = {
  // De övriga tabellerna: utan company_id men med RLS och FORCE, var och en med
  // sina policyer (regeln A4 håller namnen sanna mot katalogen) och sitt skäl.
  ovriga: {
    'public.companies': {
      policyer: ['companies_insert', 'companies_select', 'companies_update'],
      skal:
        'Raden är bolaget självt och saknar därför company_id. Läsning och ändring kräver medlemskap genom app_has_company_access(id), och skapandet kräver id = app_current_company_id() (0002). Ingen DELETE-policy: app kan inte radera ett bolag.',
    },
    'public.email_outbox': {
      policyer: ['email_outbox_insert', 'email_outbox_select'],
      skal:
        'Utkorgen gäller en användare, inte ett bolag: en användare läser bara sina egna rader (user_id = app_current_user_id()), och app har bara SELECT och INSERT (0021). E-postleveransen byggs inte enligt Davids svar 2026-10-16 (FR-24), så tabellen får ingen company_id.',
    },
  },
  // «Saknar RLS och FORCE — åtgärdas i Story 5.5»: provets enda undantag.
  // Reglerna A5 och A6 håller listan exakt lika med de oskyddade tabellerna,
  // och Story 5.5 tömmer den.
  atgardasI55: {
    'public.schema_migrations': {
      skal:
        'Migrationsregistret skapas av migrate() som ägarrollen och saknar RLS. Story 5.5 ger det en policy som bara släpper fram ägarrollen, och app får ingen rättighet.',
    },
    'public.users': {
      skal:
        'Inloggning, registrering och inbjudan slår upp e-post innan någon användarkontext finns (0002, kommentaren rad 73–75). Story 5.5 ger tabellen RLS med FORCE och flyttar uppslagen till avgränsade SECURITY DEFINER-funktioner (mönstret godkänt av David 2026-10-16).',
    },
  },
};

const SCHEMAN = ['public', 'crm'];

/**
 * Provets enda väg in i katalogen: varje vanlig eller partitionerad tabell i
 * public och crm, med flaggorna, en levande kolumn company_id och policynamnen.
 * Utan ::text blir policynamnen en lista av typen name, som drivrutinen inte
 * tolkar som en lista.
 */
async function lasKatalogen(client: pg.Client): Promise<Katalograd[]> {
  const { rows } = await client.query<Katalograd>(
    `SELECT n.nspname::text || '.' || c.relname::text AS tabell,
            c.relrowsecurity AS rls,
            c.relforcerowsecurity AS force,
            EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid
                AND a.attname = 'company_id'
                AND a.attnum > 0
                AND NOT a.attisdropped
            ) AS "harBolag",
            (SELECT COALESCE(array_agg(p.polname::text ORDER BY p.polname), '{}')
               FROM pg_policy p
              WHERE p.polrelid = c.oid) AS policyer
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[])
        AND c.relkind IN ('r', 'p')
      ORDER BY tabell`,
    [SCHEMAN],
  );
  return rows;
}

/**
 * Den slutna regeln A1–A7 som ren funktion: läser ingen databas, så att de
 * planterade fallen och listfallen prövar samma regel som huvudfallen.
 */
function avvikelser(rader: Katalograd[], listor: Listor): Avvikelse[] {
  const ut: Avvikelse[] = [];
  // Object.hasOwn, aldrig `in`: en tabell som heter som en Object-egenskap
  // får inte räknas som listad (lärdom 9 i docs/STATUS.md).
  const i55 = (tabell: string): boolean => Object.hasOwn(listor.atgardasI55, tabell);
  const ov = (tabell: string): boolean => Object.hasOwn(listor.ovriga, tabell);

  for (const r of rader) {
    // FORCE utan ENABLE skyddar ingenting: skyddad kräver båda flaggorna.
    const skyddad = r.rls && r.force;
    if (r.harBolag && !skyddad && !i55(r.tabell)) {
      ut.push({ tabell: r.tabell, regel: 'A1', text: `${r.tabell}: har company_id men saknar RLS med FORCE` });
    }
    if (!r.harBolag && !skyddad && !i55(r.tabell)) {
      ut.push({
        tabell: r.tabell,
        regel: 'A2',
        text: `${r.tabell}: saknar RLS med FORCE och står inte i listan för Story 5.5`,
      });
    }
    if (!r.harBolag && skyddad && !ov(r.tabell) && !i55(r.tabell)) {
      ut.push({
        tabell: r.tabell,
        regel: 'A3',
        text: `${r.tabell}: har RLS med FORCE men saknar policy och skäl i provets lista`,
      });
    }
    if (ov(r.tabell) && r.harBolag) {
      // En bolagstabell bärs av A1; i listan över övriga hör den inte hemma,
      // och då prövas inte dess policyer (A4).
      ut.push({
        tabell: r.tabell,
        regel: 'A7',
        text: `${r.tabell}: har company_id och hör inte till listan över övriga tabeller`,
      });
    } else if (ov(r.tabell)) {
      const katalogens = [...r.policyer].sort(jamfor);
      const listans = [...listor.ovriga[r.tabell]!.policyer].sort(jamfor);
      const lika = katalogens.length === listans.length && katalogens.every((p, i) => p === listans[i]);
      if (!lika) {
        ut.push({
          tabell: r.tabell,
          regel: 'A4',
          text: `${r.tabell}: policyerna i katalogen (${katalogens.join(', ')}) är inte listans (${listans.join(', ')})`,
        });
      }
    }
    if (i55(r.tabell) && skyddad) {
      ut.push({ tabell: r.tabell, regel: 'A6', text: `${r.tabell}: har RLS med FORCE — ta bort raden ur listan för Story 5.5` });
    }
  }

  // A5: varje listpost ska finnas i katalogen, annars är listan osann.
  const iKatalogen = new Set(rader.map((r) => r.tabell));
  for (const tabell of [...Object.keys(listor.ovriga), ...Object.keys(listor.atgardasI55)]) {
    if (!iKatalogen.has(tabell)) {
      ut.push({ tabell, regel: 'A5', text: `${tabell}: står i provets lista men finns inte i katalogen` });
    }
  }

  return ut.sort((a, b) => jamfor(a.tabell, b.tabell) || jamfor(a.regel, b.regel));
}

/** Ordning efter kodpunkt, så att utskriften är stabil oberoende av lokal. */
function jamfor(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Planterar DDL i en transaktion på en adminklient, läser katalogen på samma
 * klient och rullar alltid tillbaka. DDL är transaktionell i Postgres, så
 * ingen planterad tabell blir kvar. Satserna är konstanta texter i provet.
 */
async function medPlantering(
  ddl: string[],
  fn: (rader: Katalograd[]) => void | Promise<void>,
): Promise<void> {
  await withAdmin(async (client) => {
    await client.query('BEGIN');
    try {
      for (const sats of ddl) await client.query(sats);
      const rader = await lasKatalogen(client);
      await fn(rader);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** Fallen jämför { tabell, regel }; texten finns för att utskriften ska gå att läsa. */
function tabellOchRegel(lista: Avvikelse[]): { tabell: string; regel: Regel }[] {
  return lista.map(({ tabell, regel }) => ({ tabell, regel }));
}

describe('5.4 katalogprovet: RLS med FORCE på varje tabell', () => {
  it('K1 läsningen bär ankartabellerna i public och crm, med och utan company_id', async () => {
    const rader = await withAdmin(lasKatalogen);
    const namn = rader.map((r) => r.tabell);
    for (const ankare of [
      'public.vouchers',
      'public.audit_log',
      'public.companies',
      'public.users',
      'public.schema_migrations',
      'public.email_outbox',
      'crm.organizations',
      'crm.audit_log',
    ]) {
      expect(namn, ankare).toContain(ankare);
    }
    const harBolag = (tabell: string): boolean => {
      const r = rader.find((x) => x.tabell === tabell);
      expect(r, tabell).toBeDefined();
      return r!.harBolag;
    };
    expect(harBolag('public.vouchers')).toBe(true);
    expect(harBolag('crm.organizations')).toBe(true);
    expect(harBolag('public.users')).toBe(false);
    expect(harBolag('public.companies')).toBe(false);
    expect(namn.some((t) => t.startsWith('crm.'))).toBe(true);
  });

  it('K2 varje tabell med company_id har RLS med FORCE (ingen A1)', async () => {
    const rader = await withAdmin(lasKatalogen);
    expect(avvikelser(rader, LISTOR).filter((a) => a.regel === 'A1')).toEqual([]);
  });

  it('N1 en planterad bolagstabell med ENABLE men utan FORCE fälls (A1)', async () => {
    await medPlantering(
      [
        'CREATE TABLE public.rls_plantering_bolag (id int, company_id uuid)',
        'ALTER TABLE public.rls_plantering_bolag ENABLE ROW LEVEL SECURITY',
      ],
      (rader) => {
        expect(tabellOchRegel(avvikelser(rader, LISTOR))).toEqual([
          { tabell: 'public.rls_plantering_bolag', regel: 'A1' },
        ]);
      },
    );
  });

  it('N3 en planterad bolagstabell i crm utan RLS fälls (A1)', async () => {
    await medPlantering(['CREATE TABLE crm.rls_plantering_crm (id int, company_id uuid)'], (rader) => {
      expect(tabellOchRegel(avvikelser(rader, LISTOR))).toEqual([
        { tabell: 'crm.rls_plantering_crm', regel: 'A1' },
      ]);
    });
  });

  it('K3 hela katalogen mot båda listorna ger noll avvikelser', async () => {
    const rader = await withAdmin(lasKatalogen);
    expect(avvikelser(rader, LISTOR)).toEqual([]);
  });

  it('N2 en planterad tabell utan company_id och utan RLS fälls (A2)', async () => {
    await medPlantering(['CREATE TABLE public.rls_plantering_global (id int)'], (rader) => {
      expect(tabellOchRegel(avvikelser(rader, LISTOR))).toEqual([
        { tabell: 'public.rls_plantering_global', regel: 'A2' },
      ]);
    });
  });

  it('N4 en planterad skyddad tabell utan company_id som saknas i listan fälls (A3)', async () => {
    await medPlantering(
      [
        'CREATE TABLE public.rls_plantering_utan_skal (id int)',
        'ALTER TABLE public.rls_plantering_utan_skal ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE public.rls_plantering_utan_skal FORCE ROW LEVEL SECURITY',
        'CREATE POLICY rls_plantering_select ON public.rls_plantering_utan_skal FOR SELECT USING (true)',
      ],
      (rader) => {
        expect(tabellOchRegel(avvikelser(rader, LISTOR))).toEqual([
          { tabell: 'public.rls_plantering_utan_skal', regel: 'A3' },
        ]);
      },
    );
  });

  describe('N5 listornas egna regler fäller en ändrad kopia av listorna', () => {
    let rader: Katalograd[];

    beforeAll(async () => {
      rader = await withAdmin(lasKatalogen);
    });

    it('N5a en post i listan för Story 5.5 som inte finns i katalogen fälls (A5)', () => {
      const kopia: Listor = {
        ...LISTOR,
        atgardasI55: { ...LISTOR.atgardasI55, 'public.finns_inte': { skal: 'planterad' } },
      };
      expect(tabellOchRegel(avvikelser(rader, kopia))).toEqual([
        { tabell: 'public.finns_inte', regel: 'A5' },
      ]);
    });

    it('N5b listans policyer som inte är katalogens fälls (A4)', () => {
      const post = LISTOR.ovriga['public.companies'];
      expect(post).toBeDefined();
      const kopia: Listor = {
        ...LISTOR,
        ovriga: {
          ...LISTOR.ovriga,
          'public.companies': { ...post!, policyer: ['companies_insert', 'companies_select'] },
        },
      };
      expect(tabellOchRegel(avvikelser(rader, kopia))).toEqual([
        { tabell: 'public.companies', regel: 'A4' },
      ]);
    });

    it('N5c en skyddad tabell i listan för Story 5.5 fälls (A6)', () => {
      const kopia: Listor = {
        ...LISTOR,
        atgardasI55: { ...LISTOR.atgardasI55, 'public.companies': { skal: 'planterad' } },
      };
      expect(tabellOchRegel(avvikelser(rader, kopia))).toEqual([
        { tabell: 'public.companies', regel: 'A6' },
      ]);
    });

    it('N5d en tabell med company_id i listan över övriga tabeller fälls (A7)', () => {
      const kopia: Listor = {
        ...LISTOR,
        ovriga: {
          ...LISTOR.ovriga,
          'public.vouchers': { policyer: ['vouchers_insert', 'vouchers_select'], skal: 'planterad' },
        },
      };
      expect(tabellOchRegel(avvikelser(rader, kopia))).toEqual([
        { tabell: 'public.vouchers', regel: 'A7' },
      ]);
    });
  });
});
