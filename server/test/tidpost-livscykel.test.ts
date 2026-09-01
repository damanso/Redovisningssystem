// PRD_TIDSRAPPORTERING §9 steg 1: tidspostens livscykel.
//
// Felet som allt hänger på (PRD §1): julifakturan skickades och betalades, men
// posterna låg kvar som ofakturerade — samma timmar gick att fakturera igen —
// och två poster som inte skulle faktureras kunde inte omklassas. Proven nedan
// är det felet uttryckt baklänges: registrerad tid är inte debiterbar tid,
// statusen styr vad som får hamna på en faktura, och det som ligger på en
// faktura är låst.
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { appendixFromTimeEntries } from '../src/services/invoiceAppendix.js';
import {
  arFakturerad, arGodkannande, arIgnorerad, speglingar, TIME_ENTRY_STATUSES, type TimeEntryStatus,
} from '../src/services/projects.js';

let user: TestUser;
let companyId: string;
let customerId: string;
let projectId: string;
let agentToken: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string } };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

/** Registrerar tid och returnerar postens id (misslyckas testet högt). */
async function loggaTid(kropp: Record<string, unknown>, headers = auth()): Promise<string> {
  const res = await act('log_time', { project_id: projectId, description: 'Arbete', ...kropp }, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function rad(id: string): Promise<Record<string, unknown>> {
  const res = await act('list_time_entries', {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const funnen = (res.body.result as unknown as Record<string, unknown>[]).find((r) => r.id === id);
  expect(funnen, `tidpost ${id} hittades inte`).toBeTruthy();
  return funnen!;
}

async function nyFaktura(): Promise<string> {
  const res = await act('create_invoice', {
    customer_id: customerId, invoice_date: '2026-08-31', due_date: '2026-09-30',
    lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

beforeAll(async () => {
  user = await registerUser('tidlivscykel');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Education AB' });
  customerId = k.body.customer.id;
  const p = await act('create_project', { name: 'Fas 2A', customer_id: customerId, hourly_rate_ore: 110_000 });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  projectId = p.body.result.id as string;
  const t = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  agentToken = t.body.token;
});

describe('hjälpfunktionerna är regeln — inte en inline-jämförelse per läsare', () => {
  it('godkännande, lås och ignorering avgörs på ett ställe', () => {
    expect(TIME_ENTRY_STATUSES.filter(arGodkannande)).toEqual(['godkand', 'justerad']);
    expect(TIME_ENTRY_STATUSES.filter(arFakturerad)).toEqual(['fakturerad']);
    expect(TIME_ENTRY_STATUSES.filter(arIgnorerad)).toEqual(['ignorerad']);
  });

  it('speglingarna billable/invoiced följer statusen', () => {
    expect(speglingar('forslag')).toEqual({ billable: true, invoiced: false });
    expect(speglingar('godkand')).toEqual({ billable: true, invoiced: false });
    expect(speglingar('justerad')).toEqual({ billable: true, invoiced: false });
    expect(speglingar('ignorerad')).toEqual({ billable: false, invoiced: false });
    expect(speglingar('fakturerad')).toEqual({ billable: true, invoiced: true });
  });
});

describe('log_time: vem som skriver avgör statusen', () => {
  it('en människas post är godkänd med sina minuter som debiterbara', async () => {
    const id = await loggaTid({ work_date: '2026-08-03', minutes: 120, description: 'Arkitektur' });
    const r = await rad(id);
    expect(r.status).toBe('godkand');
    expect(r.minutes).toBe(120);
    expect(r.billable_minutes).toBe(120);
    expect(r.source).toBe('manuell');
    expect(r.approved_by).toBe(user.userId);
    expect(r.approved_at).toBeTruthy();
    expect(r.invoice_id).toBeNull();
  });

  it('AI:ts post är ett FÖRSLAG utan godkännandespår', async () => {
    const id = await loggaTid({ work_date: '2026-08-04', minutes: 60, description: 'AI-förslag' }, agent());
    const r = await rad(id);
    expect(r.status).toBe('forslag');
    expect(r.approved_by).toBeNull();
    expect(r.approved_at).toBeNull();
  });

  it('debiterbara minuter som skiljer sig kräver ett skäl', async () => {
    const utan = await act('log_time', {
      project_id: projectId, work_date: '2026-08-05', minutes: 120,
      description: 'Möte som drog över', billable_minutes: 90,
    });
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('adjustment_reason_required');

    const med = await loggaTid({
      work_date: '2026-08-05', minutes: 120, description: 'Möte som drog över',
      billable_minutes: 90, adjustment_reason: 'Överdraget bärs av oss',
    });
    const r = await rad(med);
    expect(r.minutes).toBe(120);
    expect(r.billable_minutes).toBe(90);
    expect(r.adjustment_reason).toBe('Överdraget bärs av oss');
  });

  it('billable: false betyder ignorerad — och speglingen följer med', async () => {
    const id = await loggaTid({ work_date: '2026-08-06', minutes: 45, description: 'Internt', billable: false });
    const r = await rad(id);
    expect(r.status).toBe('ignorerad');
    expect(r.billable_minutes).toBe(0);
    expect(r.minutes).toBe(45);
    const db = await withAdmin((c) => c.query<{ billable: boolean; invoiced: boolean }>(
      'SELECT billable, invoiced FROM time_entries WHERE id = $1', [id]));
    expect(db.rows[0]).toEqual({ billable: false, invoiced: false });
  });
});

describe('update_time_entry: varje tillåtet och otillåtet statusbyte', () => {
  // Startläget sätts genom att gå dit via tillåtna byten, aldrig genom att
  // skriva i databasen förbi tjänstelagret.
  async function postMedStatus(status: TimeEntryStatus, minuter = 60): Promise<string> {
    if (status === 'forslag') {
      return loggaTid({ work_date: '2026-08-10', minutes: minuter, description: 'Förslag' }, agent());
    }
    const id = await loggaTid({ work_date: '2026-08-10', minutes: minuter, description: 'Post' });
    if (status === 'godkand') return id;
    const res = await act('update_time_entry', {
      time_entry_id: id, status, adjustment_reason: 'startläge för provet',
      ...(status === 'justerad' ? { billable_minutes: minuter } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return id;
  }

  const TILLATNA: [TimeEntryStatus, TimeEntryStatus][] = [
    ['forslag', 'godkand'], ['forslag', 'justerad'], ['forslag', 'ignorerad'],
    ['godkand', 'justerad'], ['godkand', 'ignorerad'],
    ['justerad', 'godkand'], ['justerad', 'ignorerad'],
    ['ignorerad', 'godkand'], ['ignorerad', 'justerad'],
  ];

  it.each(TILLATNA)('%s → %s är tillåtet', async (fran, till) => {
    const id = await postMedStatus(fran);
    const res = await act('update_time_entry', {
      time_entry_id: id, status: till, adjustment_reason: 'omklassning',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rad(id)).status).toBe(till);
  });

  const OTILLATNA: [TimeEntryStatus, TimeEntryStatus][] = [
    ['godkand', 'forslag'], ['justerad', 'forslag'], ['ignorerad', 'forslag'],
    ['forslag', 'fakturerad'], ['godkand', 'fakturerad'],
    ['justerad', 'fakturerad'], ['ignorerad', 'fakturerad'],
  ];

  it.each(OTILLATNA)('%s → %s avvisas', async (fran, till) => {
    const id = await postMedStatus(fran);
    const res = await act('update_time_entry', {
      time_entry_id: id, status: till, adjustment_reason: 'försök',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('invalid_status_transition');
    expect((await rad(id)).status).toBe(fran);
  });

  it("'justerad' och 'ignorerad' kräver ett skäl", async () => {
    const id = await postMedStatus('godkand');
    for (const status of ['justerad', 'ignorerad'] as const) {
      const res = await act('update_time_entry', { time_entry_id: id, status });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('adjustment_reason_required');
    }
  });

  it('godkännandespåret sätts när posten blir godkänd', async () => {
    const id = await postMedStatus('forslag');
    expect((await rad(id)).approved_by).toBeNull();
    const res = await act('update_time_entry', { time_entry_id: id, status: 'godkand' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await rad(id);
    expect(r.approved_by).toBe(user.userId);
    expect(r.approved_at).toBeTruthy();
  });

  it('speglingarna skrivs i samma transaktion som statusen', async () => {
    const id = await postMedStatus('godkand');
    await act('update_time_entry', { time_entry_id: id, status: 'ignorerad', adjustment_reason: 'internt' });
    const efterIgnorera = await withAdmin((c) => c.query<{ billable: boolean; invoiced: boolean }>(
      'SELECT billable, invoiced FROM time_entries WHERE id = $1', [id]));
    expect(efterIgnorera.rows[0]).toEqual({ billable: false, invoiced: false });

    await act('update_time_entry', { time_entry_id: id, status: 'godkand' });
    const efterAter = await withAdmin((c) => c.query<{ billable: boolean; invoiced: boolean }>(
      'SELECT billable, invoiced FROM time_entries WHERE id = $1', [id]));
    expect(efterAter.rows[0]).toEqual({ billable: true, invoiced: false });
  });

  it('en tidpost i ett annat bolag går inte att nå', async () => {
    const utomstaende = await registerUser('utom-tid');
    const id = await postMedStatus('godkand');
    const res = await api.post(`${co()}/actions/update_time_entry`)
      .set({ Authorization: `Bearer ${utomstaende.token}` })
      .send({ time_entry_id: id, description: 'kapad' });
    expect(res.status).toBe(404);
  });
});

describe('debiterbara minuter skrivs aldrig tyst (varv 3, fynd 1)', () => {
  it('ändrad registrerad tid lämnar debiterbar tid orörd — och kräver då justerad', async () => {
    const id = await loggaTid({ work_date: '2026-08-12', minutes: 60, description: 'Underhåll' });

    const tyst = await act('update_time_entry', { time_entry_id: id, minutes: 120 });
    expect(tyst.status, JSON.stringify(tyst.body)).toBe(400);
    expect(tyst.body.error).toBe('adjustment_required');
    // Ingenting skrevs: varken registrerad eller debiterbar tid ändrades.
    const oforandrad = await rad(id);
    expect(oforandrad.minutes).toBe(60);
    expect(oforandrad.billable_minutes).toBe(60);

    const uttalat = await act('update_time_entry', {
      time_entry_id: id, minutes: 120, status: 'justerad',
      adjustment_reason: 'Dubbelarbete efter avbrott debiteras inte',
    });
    expect(uttalat.status, JSON.stringify(uttalat.body)).toBe(200);
    const r = await rad(id);
    expect(r.minutes).toBe(120);
    expect(r.billable_minutes).toBe(60); // orörd, precis som utlovat
    expect(r.status).toBe('justerad');
  });

  it('debiterbar tid som sätts uttryckligen följer med', async () => {
    const id = await loggaTid({ work_date: '2026-08-13', minutes: 90, description: 'Workshop' });
    const res = await act('update_time_entry', {
      time_entry_id: id, minutes: 120, billable_minutes: 120,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await rad(id);
    expect(r.minutes).toBe(120);
    expect(r.billable_minutes).toBe(120);
    expect(r.status).toBe('godkand'); // lika minuter → ingen justering behövs
  });
});

describe('fakturering: urvalet, låset och bilagans minuter', () => {
  let projekt = '';
  const period = { from: '2026-09-01', to: '2026-09-30' };

  async function tid(kropp: Record<string, unknown>, headers = auth()): Promise<string> {
    const res = await act('log_time', { project_id: projekt, ...kropp }, headers);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result.id as string;
  }

  beforeAll(async () => {
    const p = await act('create_project', { name: 'Fas 2B', customer_id: customerId, hourly_rate_ore: 110_000 });
    projekt = p.body.result.id as string;
  });

  it('bara godkänd och justerad tid utan faktura kommer med — och bilagan räknar debiterbara minuter', async () => {
    const godkand = await tid({ work_date: '2026-09-01', minutes: 180, description: 'Modellstart' });
    const justerad = await tid({ work_date: '2026-09-02', minutes: 120, description: 'Körplan' });
    const jRes = await act('update_time_entry', {
      time_entry_id: justerad, status: 'justerad', billable_minutes: 60,
      adjustment_reason: 'Halva tiden var eget lärande',
    });
    expect(jRes.status, JSON.stringify(jRes.body)).toBe(200);
    const forslag = await tid({ work_date: '2026-09-03', minutes: 60, description: 'AI-förslag' }, agent());
    const ignorerad = await tid({ work_date: '2026-09-04', minutes: 30, description: 'Egen administration' });
    await act('update_time_entry', {
      time_entry_id: ignorerad, status: 'ignorerad', adjustment_reason: 'Egen administration',
    });

    const faktura = await nyFaktura();
    const res = await act('invoice_appendix_from_time_entries', {
      invoice_id: faktura, project_id: projekt, ...period,
      title: 'Bilaga – tidsspecifikation september 2026',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 180 + 60 (de justerade, inte de registrerade 120). Förslaget och den
    // ignorerade posten finns inte på bilagan alls.
    expect(res.body.result.total_minutes).toBe(240);
    expect(res.body.result.rows).toHaveLength(2);

    expect((await rad(godkand)).status).toBe('fakturerad');
    expect((await rad(godkand)).invoice_id).toBe(faktura);
    expect((await rad(justerad)).invoice_id).toBe(faktura);
    expect((await rad(forslag)).invoice_id).toBeNull();
    expect((await rad(ignorerad)).invoice_id).toBeNull();
    const db = await withAdmin((c) => c.query<{ invoiced: boolean }>(
      'SELECT invoiced FROM time_entries WHERE id = $1', [godkand]));
    expect(db.rows[0]!.invoiced).toBe(true);
  });

  it('en fakturerad post är låst (409 time_entry_locked)', async () => {
    const last = (await act('list_time_entries', { project_id: projekt, status: 'fakturerad' }))
      .body.result as unknown as { id: string }[];
    expect(last.length).toBeGreaterThan(0);
    for (const falt of [{ minutes: 30 }, { description: 'omskrivet' }, { status: 'godkand' as const }]) {
      const res = await act('update_time_entry', { time_entry_id: last[0]!.id, ...falt });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('time_entry_locked');
    }
  });

  it('samma timmar kan inte faktureras igen', async () => {
    const res = await act('invoice_appendix_from_time_entries', {
      invoice_id: await nyFaktura(), project_id: projekt, ...period,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_time_entries');
  });

  it('list_time_entries filtrerar på uppdrag, status och period', async () => {
    const alla = await act('list_time_entries', { project_id: projekt });
    expect((alla.body.result as unknown as unknown[]).length).toBe(4);
    const forslag = await act('list_time_entries', { project_id: projekt, status: 'forslag' });
    expect((forslag.body.result as unknown as { status: string }[]).map((r) => r.status)).toEqual(['forslag']);
    const dag = await act('list_time_entries', {
      project_id: projekt, from: '2026-09-02', to: '2026-09-02',
    });
    const rader = dag.body.result as unknown as Record<string, unknown>[];
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ minutes: 120, billable_minutes: 60, status: 'fakturerad' });
    expect(rader[0]!.source).toBe('manuell');
    expect(rader[0]!.source_ref).toBeNull();
  });
});

describe('två samtidiga faktureringar av samma period', () => {
  /**
   * Väntar tills NÅGON anslutning i testdatabasen blockerats av ett lås.
   * Utan den vore provet en tidsgissning: den andra transaktionen måste hinna
   * göra sin räkning innan den första committar, annars provas inte
   * kapplöpningen utan bara ordningsföljden.
   */
  async function vantaPaLasvantan(admin: pg.Client): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const r = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if ((r.rows[0]?.n ?? 0) > 0) return;
      await new Promise((klar) => setTimeout(klar, 25));
    }
    throw new Error('ingen transaktion blockerades — kapplöpningen uppstod aldrig');
  }

  it('exakt en lyckas, den andra får 409 time_entries_changed', async () => {
    const p = await act('create_project', { name: 'Fas 1C', customer_id: customerId, hourly_rate_ore: 110_000 });
    const projekt = p.body.result.id as string;
    for (const [d, m] of [['2026-10-01', 120], ['2026-10-02', 60]] as const) {
      const r = await act('log_time', {
        project_id: projekt, work_date: d, minutes: m, description: `Oktober ${d}`,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const period = { from: '2026-10-01', to: '2026-10-31' };
    const fakturaA = await nyFaktura();
    const fakturaB = await nyFaktura();

    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.connect();
    const a = await pool.connect();
    const b = await pool.connect();
    let bUtfall: Promise<unknown> = Promise.resolve(null);
    try {
      await a.query('BEGIN');
      await setTenantContext(a, user.userId, companyId);
      await b.query('BEGIN');
      await setTenantContext(b, user.userId, companyId);

      // A gör hela sitt arbete men committar inte — posterna är låsta.
      await appendixFromTimeEntries(a, companyId, user.userId, {
        invoiceId: fakturaA, projectId: projekt, ...period,
      });
      // B startar medan A håller låset: B ser posterna i sin ögonblicksbild och
      // fastnar sedan på FOR UPDATE.
      bUtfall = appendixFromTimeEntries(b, companyId, user.userId, {
        invoiceId: fakturaB, projectId: projekt, ...period,
      }).then(() => null, (err: unknown) => err);
      await vantaPaLasvantan(admin);
      await a.query('COMMIT');

      const fel = await bUtfall as { status?: number; code?: string } | null;
      expect(fel, 'båda faktureringarna lyckades — samma timmar fakturerades två gånger').toBeTruthy();
      expect(fel!.status).toBe(409);
      expect(fel!.code).toBe('time_entries_changed');
    } finally {
      // Alltid — även om en assertion fällde provet. Först släpps A:s lås, så
      // att B:s väntande fråga kan gå klart; en anslutning som lämnas tillbaka
      // till poolen mitt i en pågående fråga förgiftar nästa test.
      await a.query('ROLLBACK').catch(() => undefined);
      await bUtfall.catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
      await admin.end();
    }

    // Facit i databasen: posterna hör till A:s faktura, och bara den.
    const rader = (await act('list_time_entries', { project_id: projekt })).body.result as unknown as
      { status: string; invoice_id: string | null }[];
    expect(rader).toHaveLength(2);
    for (const r of rader) {
      expect(r.status).toBe('fakturerad');
      expect(r.invoice_id).toBe(fakturaA);
    }
    const bilagaB = await act('get_invoice_appendix', { invoice_id: fakturaB });
    expect(bilagaB.body.result.rows).toEqual([]);
  });
});
