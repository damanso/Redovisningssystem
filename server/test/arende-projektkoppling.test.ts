// K-5 (tidpost -> ärende) och K-6 (faktura -> projekt), migration 0060.
//
// Proven mäter REGLERNA, inte de rader som råkade finnas i produktion när
// migrationen kördes:
//
//   * Ifyllnadsregeln LÄSES UR MIGRATIONSFILEN och körs mot färsk fixturdata.
//     Därmed finns bara EN kopia av regeln; skrivs migrationen om utan att
//     regeln håller, blir provet rött. En egen SQL-kopia i testet hade varit en
//     andra sanning, och de två hade glidit isär.
//   * Den negativa kontrollen är inbyggd i samma prov: en kund med TVÅ projekt
//     får INTE kopplas. Ett prov som bara visar att åtta fakturor fick ett
//     projekt hade varit grönt även för en regel som gissar.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

const MIGRATION = new URL('../migrations/0060_arende_och_projektkoppling.sql', import.meta.url);

let user: TestUser;
let companyId: string;
let userId: string;

/** Plockar ut fakturans ifyllnads-UPDATE ur migrationen — regelns enda kopia. */
async function ifyllnadsregeln(): Promise<string> {
  const sql = await readFile(MIGRATION, 'utf8');
  const m = /(UPDATE invoices i\b[\s\S]*?;)/.exec(sql);
  if (!m) throw new Error('hittade inte fakturans UPDATE i migration 0060');
  return m[1] as string;
}

async function nyKund(namn: string, nummer: number): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO customers (company_id, customer_number, name) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, nummer, namn],
    );
    return r.rows[0].id as string;
  });
}

async function nyttProjekt(namn: string, nummer: number, kundId: string): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO projects (company_id, number, name, customer_id) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [companyId, nummer, namn, kundId],
    );
    return r.rows[0].id as string;
  });
}

async function nyFaktura(kundId: string, nummer: number): Promise<string> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date,
                             created_by)
       VALUES ($1, $2, $3, current_date, current_date + 30, $4) RETURNING id`,
      [companyId, kundId, nummer, userId],
    );
    return r.rows[0].id as string;
  });
}

beforeAll(async () => {
  user = await registerUser('arendeprojekt');
  companyId = await createCompany(user.token, 'Locollabs AB');
  userId = user.userId;
});

describe('K-6: faktura -> projekt', () => {
  it('kopplar när kunden har exakt ETT projekt — och avstår när hon har två', async () => {
    // Entydig kund: ett projekt.
    const entydig = await nyKund('Entydig Kund AB', 9001);
    const projekt = await nyttProjekt('Entydigt uppdrag', 9001, entydig);
    const fEntydig = await nyFaktura(entydig, 9001);

    // Tvetydig kund: TVÅ projekt. Det är den negativa kontrollen — regeln ska
    // TIGA här, inte välja det ena.
    const tvetydig = await nyKund('Tvetydig Kund AB', 9002);
    await nyttProjekt('Första uppdraget', 9002, tvetydig);
    await nyttProjekt('Andra uppdraget', 9003, tvetydig);
    const fTvetydig = await nyFaktura(tvetydig, 9002);

    // Kund helt utan projekt (Ethos-fallet i produktion).
    const utan = await nyKund('Projektlös Kund AB', 9003);
    const fUtan = await nyFaktura(utan, 9003);

    // Regeln hamtas ur migrationen sjalv - en andra kopia i testet hade
    // blivit en andra sanning.
    const regel = await ifyllnadsregeln();
    await withAdmin((c) => c.query(regel));

    const rader = await withAdmin(async (c) => {
      const r = await c.query(
        'SELECT id, project_id FROM invoices WHERE id = ANY($1::uuid[])',
        [[fEntydig, fTvetydig, fUtan]],
      );
      return new Map(r.rows.map((x) => [x.id as string, x.project_id as string | null]));
    });

    expect(rader.get(fEntydig)).toBe(projekt);
    // Gissar inte. Ett tomt fält är ärligare än ett påhittat.
    expect(rader.get(fTvetydig)).toBeNull();
    expect(rader.get(fUtan)).toBeNull();
  });

  it('en faktura kan inte peka på ett annat bolags projekt', async () => {
    const annatBolag = await createCompany(user.token, 'Annat Bolag AB');
    const kund = await nyKund('Egen Kund AB', 9010);
    const faktura = await nyFaktura(kund, 9010);
    const frammande = await withAdmin(async (c) => {
      const k = await c.query(
        `INSERT INTO customers (company_id, customer_number, name)
         VALUES ($1, 1, 'Främmande Kund AB') RETURNING id`,
        [annatBolag],
      );
      const p = await c.query(
        `INSERT INTO projects (company_id, number, name, customer_id)
         VALUES ($1, 1, 'Främmande uppdrag', $2) RETURNING id`,
        [annatBolag, k.rows[0].id],
      );
      return p.rows[0].id as string;
    });

    // Sammansatt FK (id, company_id): det här ska vara omöjligt, inte bara
    // ogjort. En koppling över bolagsgränsen är alltid ett fel.
    await expect(
      withAdmin((c) =>
        c.query('UPDATE invoices SET project_id = $2 WHERE id = $1', [faktura, frammande]),
      ),
    ).rejects.toThrow(/invoices_project_fk/);
  });
});

describe('K-5: tidpost -> ärende', () => {
  it('ett halvfyllt ärendepar är omöjligt', async () => {
    const kund = await nyKund('Tidkund AB', 9020);
    const projekt = await nyttProjekt('Tiduppdrag', 9020, kund);
    const tid = await withAdmin(async (c) => {
      const r = await c.query(
        // status/billable_minutes saknar DEFAULT med flit (0062): en tidpost
        // måste säga hur mycket av den som är debiterbar.
        `INSERT INTO time_entries (company_id, project_id, work_date, minutes, billable_minutes, description, status)
         VALUES ($1, $2, current_date, 60, 60, 'Arbete', 'godkand') RETURNING id`,
        [companyId, projekt],
      );
      return r.rows[0].id as string;
    });

    // Id utan källa: ett id vars system är okänt är inte ett id.
    await expect(
      withAdmin((c) =>
        c.query(
          `UPDATE time_entries SET arende_id = gen_random_uuid() WHERE id = $1`,
          [tid],
        ),
      ),
    ).rejects.toThrow(/time_entries_arende_komplett_check/);

    // Nyckel utan id: en läsbar etikett utan identitet är precis den proxy
    // kopplingen finns för att undvika.
    await expect(
      withAdmin((c) =>
        c.query(`UPDATE time_entries SET arende_nyckel = 'LOC-316' WHERE id = $1`, [tid]),
      ),
    ).rejects.toThrow(/time_entries_arende_komplett_check/);

    // Komplett par går in.
    await expect(
      withAdmin((c) =>
        c.query(
          `UPDATE time_entries SET arende_id = gen_random_uuid(), arende_kalla = 'arenden',
                                   arende_nyckel = 'LOC-316' WHERE id = $1`,
          [tid],
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('ingen främmande nyckel mot ärendeplattformen — systemen ska kunna leva var för sig', async () => {
    const fk = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'time_entries'::regclass AND contype = 'f'
            AND pg_get_constraintdef(oid) ILIKE '%arende%'`,
      );
      return r.rows[0].n as number;
    });
    // En FK hade gjort faktureringen beroende av att ärendeplattformen lever.
    expect(fk).toBe(0);
  });
});
