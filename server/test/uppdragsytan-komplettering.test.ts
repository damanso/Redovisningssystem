// Story 1.15 (B-2, IR-13, FR-41 punkt 2–5): kompletteringen ersätter en väntande
// Övrigt-fråga och är inget beslut. Riskerna, lager för lager: kolumnens skydd i
// databasen (CHECK, FK, UNIQUE och triggern), kärnans läsningar och uteslutning
// ur återförsöket, de rena reglerna (utan databas), kompletteringen genom REST,
// samtidigheten under radlåset och läsvägens ”ändrat sedan förslaget”.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, withAdmin } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { NotFoundError } from '../src/lib/errors.js';
import { beslutHash, ersattGodkannande, listaMottagnaBeslut, listRecentDecisions } from '../src/services/approvals.js';
import { MANDATATGARDER } from '../src/services/uppdragBeslut.js';
import { verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { actionManifest, getAction } from '../src/actions/registry.js';
import type { OvrigtUnderlag } from '../src/lib/beslutsunderlag.js';
import { lasUndantag, type Undantag } from '../src/services/uppdragUndantag.js';
import { act, godkann, koa, nyttBolag, notis, ok, plantera, posta, rest, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, auditFor, forbruka, forslag, iltUppdrag, kopostInput, kopostRad, kopostUtanUnderlag, ovrigtFraga,
  planteraMedStatus, svepa, type Ilt,
} from './ovrigtRigg.js';
import {
  beslutshandelser, ersattning, fragaUtanTimmar, komplettera, koposterForKalla, planteraErsattning, tillstand,
} from './kompletteringRigg.js';
import {
  provaJ1, provaJ2, provaJ3, provaJ4, provaJ5, provaJ6, provaJ7, provaJ8, provaJ9, provaJ10,
} from './kompletteringHelper.js';

type Pgfel = { code?: string; constraint?: string; message?: string };
/** Ett HTTP-svar ur supertest: status, kropp och rubriker. */
type Svar = { status: number; body: { error?: string }; headers: Record<string, string> };
const fel = (p: Promise<unknown>): Promise<Pgfel | null> => p.then(() => null, (e: Pgfel) => e);
const somApp = (b: Bolag, sql: string, varden: unknown[]) =>
  withTenantTransaction(b.user.userId, b.id, (c) => c.query(sql, varden));
const lasUndantagFor = async (b: Bolag): Promise<Undantag> => await ok(b, 'las_undantag', {}) as unknown as Undantag;
/** Kolumnerna i CHECK `action_approvals_ersatt_utan_beslut`, ordagrant ur 0083. */
const ERSATT_UTAN_BESLUT = `CHECK (ersatt_av IS NULL OR (status = 'rejected' AND decided_by IS NULL AND decided_at IS NULL
  AND beslut_hash IS NULL AND beslut_skal IS NULL))`;

describe('J de rena reglerna', () => {
  it('J1 delunderlag mappar en avtalsdel som svepet', provaJ1);
  it('J2 egetTakTimmar är den gällande versionens tak', provaJ2);
  it('J3 inget har ändrats', provaJ3);
  it('J4 taxan och beloppet', provaJ4);
  it('J5 förbrukningen och utrymmet', provaJ5);
  it('J6 en ny version med högre tak', provaJ6);
  it('J7 utan timmar räknas inget belopp på någon sida', provaJ7);
  it('J8 delen finns inte längre', provaJ8);
  it('J9 kastar aldrig', provaJ9);
  it('J10 fälten i fast ordning', provaJ10);
});

describe('E kolumnen ersatt_av och kärnan', () => {
  let b: Bolag;
  let granne: Bolag;
  let ilt: Ilt;
  const korda = new Set<string>();
  const ny = () => plantera(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Prov' });
  beforeAll(async () => {
    b = await nyttBolag('Komplettering E');
    granne = await nyttBolag('Komplettering E granne');
    ilt = await iltUppdrag(b, { namn: 'ILT E' });
  });

  it('E1 kolumnen, de fyra skydden och triggerns fem regler finns', async () => {
    await withAdmin(async (c) => {
      const kolumn = (await c.query(`SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'action_approvals' AND column_name = 'ersatt_av'`)).rows;
      expect(kolumn).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
      const skydd = (await c.query<{ conname: string; contype: string; def: string }>(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'action_approvals'::regclass AND conname = ANY($1) ORDER BY conname`,
        [['action_approvals_ersatt_av_fk', 'action_approvals_ersatt_av_uk', 'action_approvals_ersatt_utan_beslut',
          'action_approvals_ersatt_inte_sig_sjalv']])).rows;
      expect(skydd.map((s) => [s.conname, s.contype])).toEqual([
        ['action_approvals_ersatt_av_fk', 'f'], ['action_approvals_ersatt_av_uk', 'u'],
        ['action_approvals_ersatt_inte_sig_sjalv', 'c'], ['action_approvals_ersatt_utan_beslut', 'c'],
      ]);
      const def = Object.fromEntries(skydd.map((s) => [s.conname, s.def]));
      expect(def.action_approvals_ersatt_av_fk).toMatch(/^FOREIGN KEY \(ersatt_av, company_id\) REFERENCES action_approvals\(id, company_id\)/);
      expect(def.action_approvals_ersatt_av_uk).toBe('UNIQUE (ersatt_av)');
      const funktion = (await c.query<{ d: string }>(
        "SELECT pg_get_functiondef('mottaget_beslut_ar_oforanderligt'::regproc) AS d")).rows[0]!.d;
      for (const text of ['ett mottaget beslut ändras aldrig', 'ett beslut tas bara emot från en väntande post',
        'ett mottaget beslut blir aldrig en obesvarad fråga igen', 'bara en väntande post kan ersättas',
        'en ersättning ändras aldrig']) expect(funktion, text).toContain(text);
    });
    korda.add('E1');
  });

  it('E2 CHECK fäller en ersättning med beslutsfält, och posten är oförändrad', async () => {
    const p = await ny();
    const q = await ny();
    const fore = await kopostRad(p);
    const fall: Array<[string, unknown[], string | null]> = [
      ["UPDATE action_approvals SET status='rejected', ersatt_av=$2, decided_by=$3 WHERE id=$1", [p, q, b.user.userId], 'action_approvals_ersatt_utan_beslut'],
      ["UPDATE action_approvals SET status='rejected', ersatt_av=$2, decided_at=now() WHERE id=$1", [p, q], 'action_approvals_ersatt_utan_beslut'],
      ["UPDATE action_approvals SET status='rejected', ersatt_av=$2, decided_by=$3, decided_at=now(), beslut_hash=$4 WHERE id=$1",
        [p, q, b.user.userId, 'a'.repeat(64)], null],
      ["UPDATE action_approvals SET status='rejected', ersatt_av=$2, decided_by=$3, decided_at=now(), beslut_hash=$4, beslut_skal='x' WHERE id=$1",
        [p, q, b.user.userId, 'a'.repeat(64)], null],
      ['UPDATE action_approvals SET ersatt_av=$2 WHERE id=$1', [p, q], 'action_approvals_ersatt_utan_beslut'],
    ];
    for (const [sql, varden, constraint] of fall) {
      const e = await fel(somApp(b, sql, varden));
      expect(e, sql).toMatchObject({ code: '23514' });
      if (constraint) expect(e!.constraint, sql).toBe(constraint);
      expect(await kopostRad(p)).toEqual(fore);
    }
    korda.add('E2');
  });

  it('E3 triggern fäller en ersättning av en post som inte är väntande', async () => {
    const q = await ny();
    const input = { contract_id: ilt.contractId, notes: 'Prov' };
    for (const status of ['approved', 'executed', 'rejected', 'failed'] as const) {
      const p = await planteraMedStatus(b, 'update_contract', input, status);
      const fore = await kopostRad(p);
      const e = await fel(somApp(b, "UPDATE action_approvals SET status='rejected', ersatt_av=$2 WHERE id=$1", [p, q]));
      expect(e, status).toMatchObject({ code: 'P0001' });
      expect(e!.message, status).toContain('bara en väntande post kan ersättas');
      expect(await kopostRad(p)).toEqual(fore);
    }
    korda.add('E3');
  });

  it('E4 en ersättning ändras aldrig, varken som app eller som ägare', async () => {
    const p = await ny();
    const q = await planteraErsattning(b, p);
    const r = await ny();
    const fore = await kopostRad(p);
    const fall: Array<[string, unknown[], string, string]> = [
      ['UPDATE action_approvals SET ersatt_av=$2 WHERE id=$1', [p, r], 'P0001', 'en ersättning ändras aldrig'],
      ['UPDATE action_approvals SET ersatt_av=NULL WHERE id=$1', [p], 'P0001', 'en ersättning ändras aldrig'],
      ["UPDATE action_approvals SET status='pending' WHERE id=$1", [p], '23514', 'action_approvals_ersatt_utan_beslut'],
      ['UPDATE action_approvals SET decided_by=$2 WHERE id=$1', [p, b.user.userId], '23514', 'action_approvals_ersatt_utan_beslut'],
    ];
    for (const [sql, varden, kod, vad] of fall) {
      for (const [vem, korning] of [['app', () => somApp(b, sql, varden)], ['ägare', () => withAdmin((c) => c.query(sql, varden))]] as const) {
        const e = await fel(korning());
        expect(e, `${vem}: ${sql}`).toMatchObject({ code: kod });
        if (kod === 'P0001') expect(e!.message).toContain(vad);
        else expect(e!.constraint).toBe(vad);
        expect(await kopostRad(p)).toEqual(fore);
      }
    }
    expect((await ersattning(p)).ersatt_av).toBe(q);
    korda.add('E4');
  });

  it('E5 FK: grannens köpost och ett okänt id fälls', async () => {
    const grannens = await plantera(granne, 'update_contract', { contract_id: ilt.contractId, notes: 'Grannens prov' });
    for (const ersattare of [grannens, '0e1a7777-7777-4777-8777-777777777777']) {
      const p = await ny();
      const fore = await kopostRad(p);
      const e = await fel(somApp(b, "UPDATE action_approvals SET status='rejected', ersatt_av=$2 WHERE id=$1", [p, ersattare]));
      expect(e, ersattare).toMatchObject({ code: '23503' });
      expect(await kopostRad(p)).toEqual(fore);
    }
    korda.add('E5');
  });

  it('E6 UNIQUE: en ersättare ersätter högst en post', async () => {
    const p1 = await ny();
    const q = await planteraErsattning(b, p1);
    const p2 = await ny();
    const e = await fel(somApp(b, "UPDATE action_approvals SET status='rejected', ersatt_av=$2 WHERE id=$1", [p2, q]));
    expect(e).toMatchObject({ code: '23505', constraint: 'action_approvals_ersatt_av_uk' });
    expect((await ersattning(p2)).status).toBe('pending');
    korda.add('E6');
  });

  it('E7 en post ersätter aldrig sig själv', async () => {
    const p = await ny();
    const e = await fel(somApp(b, "UPDATE action_approvals SET status='rejected', ersatt_av=$1 WHERE id=$1", [p]));
    expect(e).toMatchObject({ code: '23514', constraint: 'action_approvals_ersatt_inte_sig_sjalv' });
    expect((await ersattning(p)).status).toBe('pending');
    korda.add('E7');
  });

  it('E8 ersattGodkannande: tekniskt slutläge utan beslutsfält, och låsets 409 och 404', async () => {
    const auditantal = async () => withAdmin(async (c) => (await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1', [b.id])).rows[0]!.n);
    const p = await ny();
    const q = await ny();
    const audit = await auditantal();
    const svar = await withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, p, q));
    expect(svar).toMatchObject({ id: p, status: 'rejected', ersatt_av: q, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null });
    expect(Object.hasOwn(svar, 'ersatt_av')).toBe(true);
    expect(await ersattning(p)).toMatchObject({ status: 'rejected', ersatt_av: q, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null });
    expect(await auditantal()).toBe(audit);

    const godkand = await planteraMedStatus(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Prov' }, 'approved');
    const r = await ny();
    expect(await fel(withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, godkand, r))))
      .toMatchObject({ code: 'not_pending' });
    const grannens = await plantera(granne, 'update_contract', { contract_id: ilt.contractId, notes: 'Grannens prov' });
    for (const id of ['0e1a7777-7777-4777-8777-777777777778', grannens]) {
      const e = await fel(withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, id, r)));
      expect(e, id).toBeInstanceOf(NotFoundError);
    }
    expect((await ersattning(r)).status).toBe('pending');
    korda.add('E8');
  });

  it('kontrollvakt: E1–E8 kördes', () =>
    expect([...korda].sort()).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']));
});

describe('E läsvägen, återförsöket, ingångarna och läsningen av en ersatt post', () => {
  let b: Bolag;
  let ilt: Ilt;
  let a = '';
  let q = '';
  const korda = new Set<string>();
  beforeAll(async () => {
    b = await nyttBolag('Komplettering E9');
    ilt = await iltUppdrag(b, { namn: 'ILT E9' });
    a = (await ovrigtFraga(b, ilt)).approvalId;
    q = await planteraErsattning(b, a);
  });

  it('E9 läsvägen och återförsöket väljer aldrig en ersatt post', async () => {
    const u = await lasUndantagFor(b);
    expect(u.poster.map((p) => p.id)).toContain(q);
    expect(u.poster.map((p) => p.id)).not.toContain(a);
    expect(u.hoppade.map((h) => h.id)).not.toContain(a);
    const fore = await kopostRad(a);
    await withTenantTransaction(b.user.userId, b.id, async (c) => {
      expect(await verkstallMottagnaBeslut(c, b.id)).toEqual({ verkstallda: [], kvar: [] });
      const mottagna = (await listaMottagnaBeslut(c, b.id, MANDATATGARDER)).map((r) => r.id);
      expect(mottagna).not.toContain(a);
      expect(mottagna).not.toContain(q);
      expect((await verkstallBeslut(c, b.id, a)).verkstalld).toBe(false);
    });
    expect(await kopostRad(a)).toEqual(fore);
    const svar = await svepa(b);
    expect(svar.tackning.find((r) => r.contract_id === ilt.contractId && r.kalla === 'ovrigt'))
      .toMatchObject({ lage: 'last', saknas: [] });
    korda.add('E9');
  });

  it('E10 en ersatt post går inte att avgöra igen i någon ingång, och ingenting skrivs', async () => {
    const forsok: Array<[string, () => Promise<Svar>, number, string | null]> = [
      ['a REST ja', async () => rest(b, `approvals/${a}/approve`), 409, 'not_pending'],
      ['b REST avvisa', async () => rest(b, `approvals/${a}/reject`, { reason: 'Prov' }), 409, 'not_pending'],
      ['c avboj_beslutsforslag', async () => act(b, 'avboj_beslutsforslag', { approval_id: a, skal: 'Prov' }), 409, 'not_pending'],
      ['d Att göra godkänn', async () => b.ua.post(`/app/c/${b.id}/approvals/${a}/approve`).type('form').send({}), 302, null],
      ['d Att göra avvisa', async () => b.ua.post(`/app/c/${b.id}/approvals/${a}/reject`).type('form').send({ skal: 'Prov' }), 302, null],
      ['e undantagsvyns ja', async () => posta(b, { handling: 'ja', approval_id: a }), 302, null],
      ['e undantagsvyns nej', async () => posta(b, { handling: 'nej', approval_id: a, skal: 'Prov' }), 302, null],
      ['f agentens ja', async () => rest(b, `approvals/${a}/approve`, {}, b.agent), 403, 'human_approval_required'],
      ['f agentens nej', async () => act(b, 'avboj_beslutsforslag', { approval_id: a, skal: 'Prov' }, b.agent), 403, 'human_required'],
    ];
    for (const [namn, kor, status, kod] of forsok) {
      const fore = await tillstand(b.id, a);
      const res = await kor();
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(status);
      if (kod) expect(res.body.error, namn).toBe(kod);
      else expect(res.headers.location ?? '', namn).not.toContain('fel=');
      expect(notis(res.headers.location), namn).toBe('');
      expect(await tillstand(b.id, a), namn).toEqual(fore);
      expect((await ersattning(q)).status, namn).toBe('pending');
    }
    korda.add('E10');
  });

  it('E11 REST:s läsning bär ersatt_av, med och utan status', async () => {
    const lista = async (status?: string) => {
      const res = await api.get(`/api/companies/${b.id}/approvals${status ? `?status=${status}` : ''}`).set(b.auth);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.approvals as Array<Record<string, unknown>>;
    };
    const alla = await lista();
    expect(alla.find((r) => r.id === a)).toMatchObject({ ersatt_av: q, status: 'rejected', beslut_hash: null });
    expect(alla.find((r) => r.id === q)).toMatchObject({ ersatt_av: null });
    const vantande = await lista('pending');
    expect(vantande.map((r) => r.id)).toContain(q);
    expect(vantande.map((r) => r.id)).not.toContain(a);
    expect(Object.hasOwn(vantande.find((r) => r.id === q)!, 'ersatt_av')).toBe(true);
    expect((await lista('rejected')).find((r) => r.id === a)).toMatchObject({ ersatt_av: q });
    korda.add('E11');
  });

  it('kontrollvakt: E9–E11 kördes', () => expect([...korda].sort()).toEqual(['E10', 'E11', 'E9']));
});

// --- K och S: kompletteringen genom REST (Task 3) ----------------------------

/** Beslutsraderna med Övrigt-raden som källa. */
const beslutForKalla = async (b: Bolag, rad: string) => withAdmin(async (c) => (await c.query(
  "SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND kalla_typ='anteckning' AND kalla_id=$2 ORDER BY created_at, id",
  [b.id, rad])).rows);
/** Avtalets alla avtalsdelsrader, kolumn för kolumn. */
const avtalsdelar = async (b: Bolag, contractId: string) => withAdmin(async (c) => (await c.query(
  'SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [b.id, contractId])).rows);
/** Antalet auditrader med en händelse i bolaget. */
const auditrader = async (b: Bolag, handelse: string, entityId?: string) => withAdmin(async (c) => (await c.query<{ n: number }>(
  'SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1 AND action=$2 AND ($3::text IS NULL OR entity_id=$3)',
  [b.id, handelse, entityId ?? null])).rows[0]!.n);
const RADTEXT = 'ILT bad om en extra rapport över fakturorna.';

describe('K kompletteringen av en väntande Övrigt-fråga', () => {
  let b: Bolag;
  let ilt: Ilt;
  let a = '';
  let rad = '';
  let ny = '';
  let aInput: Record<string, unknown> = {};
  let delarFore: unknown[] = [];
  const korda = new Set<string>();
  beforeAll(async () => {
    b = await nyttBolag('Komplettering K');
    ilt = await iltUppdrag(b, { namn: 'ILT K' });
    await forbruka(b, ilt, '2A', 600);
    ({ anteckningId: rad, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A'));
    aInput = await kopostInput(a);
    delarFore = await avtalsdelar(b, ilt.contractId);
  });

  it('K5 agentens nyckel får 403 human_required, och ingenting skrivs', async () => {
    const fore = await tillstand(b.id, a);
    const res = await komplettera(b, a, 8, b.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await tillstand(b.id, a)).toEqual(fore);
    korda.add('K5');
  });

  it('K1 ryms utan timmar ersätts av en väntande fråga med Davids timmar och serverns beräkning', async () => {
    expect((aInput.beslutsunderlag as OvrigtUnderlag).timmar).toBeNull();
    const fore = await ersattning(a);
    const res = await komplettera(b, a, 8);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    ny = res.body.result.ersatt_av as string;
    expect(res.body.result).toEqual({ approval_id: a, ersatt_av: ny });
    const ersattare = await ersattning(ny);
    expect(ersattare).toMatchObject({ status: 'pending', requested_by: fore.requested_by, requested_actor: fore.requested_actor });
    expect((await kopostRad(ny)).action).toBe('registrera_uppdragsbeslut');
    const u = ersattare.input.beslutsunderlag as OvrigtUnderlag;
    const gammal = aInput.beslutsunderlag as OvrigtUnderlag;
    expect(ersattare.input.contract_id).toBe(aInput.contract_id);
    expect(ersattare.input.kalla).toEqual(aInput.kalla);
    expect(u).toMatchObject({ skal: gammal.skal, kallor: gammal.kallor, alternativ: 'ryms', avtalsdel_kod: '2A',
      timmar: 8, minuter: 480, taxa_ore: 100000, belopp_ore: 800000, tak_minuter: 1920, forbrukade_minuter: 600,
      kvar_fore_minuter: 1320, kvar_efter_minuter: 840, giltig_fran: null, nytt_tak_minuter: null });
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(ersattare.input).success).toBe(true);
    expect(await ersattning(a)).toMatchObject({ status: 'rejected', ersatt_av: ny, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null, input: aInput });
    korda.add('K1');
  });

  it('K3 auditraden bär båda id:na och ingen beslutshändelse finns', async () => {
    const rader = (await auditFor(b.id, a)).filter((r) => r.action === 'uppdrag.forslag_kompletterat');
    expect(rader).toHaveLength(1);
    expect(rader[0]!.details).toEqual({ approval_id: a, ersatt_av: ny, atgard: 'registrera_uppdragsbeslut' });
    expect(JSON.stringify(rader[0]!.details)).not.toContain(RADTEXT);
    expect(await beslutshandelser(b.id, [a, ny])).toEqual([]);
    // Bolaget har beslutshändelser ur riggens godkända avtalsdelar, så bara
    // räkningen per köpost säger något om kompletteringen.
    expect(await auditrader(b, 'uppdrag.beslut_registrerat')).toBeGreaterThan(0);
    expect(await auditrader(b, 'action.executed', 'komplettera_beslutsforslag')).toBe(1);
    korda.add('K3');
  });

  it('K4 ingen beslutsrad och ingen avtalsdel', async () => {
    expect(await beslutForKalla(b, rad)).toEqual([]);
    expect(await avtalsdelar(b, ilt.contractId)).toEqual(delarFore);
    korda.add('K4');
  });

  it('K6 den ersatta posten ger 409 not_pending i fyra vägar, och ingenting skrivs', async () => {
    for (const [namn, kor] of [
      ['komplettera', () => komplettera(b, a, 9)],
      ['REST ja', () => rest(b, `approvals/${a}/approve`)],
      ['REST avvisa', () => rest(b, `approvals/${a}/reject`, { reason: 'Prov' })],
      ['avboj_beslutsforslag', () => act(b, 'avboj_beslutsforslag', { approval_id: a, skal: 'Prov' })],
    ] as const) {
      const fore = await tillstand(b.id, a);
      const res = await kor();
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error, namn).toBe('not_pending');
      expect(await tillstand(b.id, a), namn).toEqual(fore);
    }
    korda.add('K6');
  });

  it('K16 REST:s lista visar ersättningen på båda köposterna', async () => {
    const res = await api.get(`/api/companies/${b.id}/approvals`).set(b.auth);
    expect(res.status).toBe(200);
    const lista = res.body.approvals as Array<Record<string, unknown>>;
    expect(lista.find((r) => r.id === a)).toMatchObject({ ersatt_av: ny });
    expect(lista.find((r) => r.id === ny)).toMatchObject({ ersatt_av: null });
    korda.add('K16');
  });

  it('K13 svepet räknar ersättaren som radens förslag och köar inget nytt', async () => {
    const svar = await svepa(b, {});
    expect(svar.arbetslista.ovrigt_kandidater.map((k) => k.id)).not.toContain(rad);
    expect(svar.tackning.find((r) => r.contract_id === ilt.contractId && r.kalla === 'ovrigt'))
      .toMatchObject({ lage: 'last', saknas: [] });
    expect(svar.mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    const igen = await svepa(b, { ovrigt_forslag: [forslag(rad)] });
    expect(igen.ovrigt.redan_koade).toEqual([rad]);
    expect(igen.ovrigt.koade).toEqual([]);
    expect(await koposterForKalla(b.id, rad)).toHaveLength(2);
    korda.add('K13');
  });

  it('K14 läsvägen visar exakt en post för källan, ersättaren', async () => {
    const u = await lasUndantagFor(b);
    const forKallan = u.poster.filter((p) => p.ovrigt?.forfragan.varde?.id === rad);
    expect(forKallan.map((p) => p.id)).toEqual([ny]);
    expect(u.poster.map((p) => p.id)).not.toContain(a);
    expect(u.hoppade.map((h) => h.id)).not.toContain(a);
    korda.add('K14');
  });

  it('K15 Läget och Att göra visar aldrig ersättningen som ett beslut', async () => {
    const l = await ok(b, 'las_uppdragslage', { project_id: ilt.projektId }) as {
      koposter: Array<{ id: string }>;
      beslut: { mottagna: Array<{ approval_id: string }>; registrerade: Array<{ approval_id: string }> };
    };
    expect(l.koposter.map((r) => r.id)).toContain(ny);
    expect(l.koposter.map((r) => r.id)).not.toContain(a);
    expect(l.beslut.mottagna.map((r) => r.approval_id)).not.toContain(a);
    expect(l.beslut.registrerade.map((r) => r.approval_id)).not.toContain(a);
    expect(l.beslut.registrerade.map((r) => r.approval_id)).not.toContain(ny);
    const sidan = await b.ua.get(`/app/c/${b.id}/projects/${ilt.projektId}/laget`);
    expect(sidan.status).toBe(200);
    expect(sidan.text).not.toContain(`id="beslut-${a}"`);
    const kvitton = await withTenantTransaction(b.user.userId, b.id, (c) => listRecentDecisions(c, b.id, 200));
    expect(kvitton.map((r) => r.id)).not.toContain(a);
    korda.add('K15');
  });

  it('K12 en kedja av ersättningar lämnar exakt en väntande fråga', async () => {
    const res = await komplettera(b, ny, 9);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = res.body.result.ersatt_av as string;
    expect(await koposterForKalla(b.id, rad)).toEqual([
      { id: a, action: 'registrera_uppdragsbeslut', status: 'rejected', ersatt_av: ny },
      { id: ny, action: 'registrera_uppdragsbeslut', status: 'rejected', ersatt_av: c },
      { id: c, action: 'registrera_uppdragsbeslut', status: 'pending', ersatt_av: null },
    ]);
    const u = await lasUndantagFor(b);
    const forKallan = u.poster.filter((p) => p.ovrigt?.forfragan.varde?.id === rad);
    expect(forKallan.map((p) => p.id)).toEqual([c]);
    expect(forKallan[0]!.ovrigt!.underlag.varde!.timmar).toBe(9);
    korda.add('K12');
  });

  it('kontrollvakt: K1, K3–K6 och K12–K16 kördes', () => expect([...korda].sort())
    .toEqual(['K1', 'K12', 'K13', 'K14', 'K15', 'K16', 'K3', 'K4', 'K5', 'K6']));
});

describe('K tillägget, prövningarna och definitionen', () => {
  const korda = new Set<string>();

  it('K2 tillägg utan timmar ersätts av en ny version med Davids timmar', async () => {
    const b = await nyttBolag('Komplettering K2');
    const ilt = await iltUppdrag(b, { namn: 'ILT K2' });
    const { approvalId: a } = await fragaUtanTimmar(b, ilt, 'tillagg', '2B');
    const aInput = await kopostInput(a);
    const res = await komplettera(b, a, 8);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ny = await ersattning(res.body.result.ersatt_av as string);
    expect((await kopostRad(res.body.result.ersatt_av as string)).action).toBe('andra_baseline');
    expect(ny.input).toMatchObject({ code: '2B', cap_hours: 20, valid_from: aInput.valid_from, change_reason: aInput.change_reason });
    expect(ny.input.beslutsunderlag).toMatchObject({ nytt_tak_minuter: 1200, giltig_fran: aInput.valid_from,
      belopp_ore: 800000, kvar_efter_minuter: 720 });
    expect(getAction('andra_baseline')!.inputSchema.safeParse(ny.input).success).toBe(true);
    korda.add('K2');
  });

  it('K7 bara en Övrigt-fråga kan kompletteras, och ingenting skrivs', async () => {
    const b = await nyttBolag('Komplettering K7');
    const ilt = await iltUppdrag(b, { namn: 'ILT K7' });
    const utanKalla = await koa(b, 'andra_baseline', {
      contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: '2027-01-01', change_reason: 'Ändring utan källa',
    });
    const utanUnderlag = await plantera(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, await anteckning(b, ilt.contractId)));
    const { approvalId: godkand } = await ovrigtFraga(b, ilt);
    await godkann(b, godkand);
    for (const [id, kod] of [[utanKalla, 'inte_ovrigtforslag'], [utanUnderlag, 'inte_ovrigtforslag'], [godkand, 'not_pending']] as const) {
      const fore = await tillstand(b.id, id);
      const res = await komplettera(b, id, 8);
      expect(res.status, `${kod}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error).toBe(kod);
      expect(await tillstand(b.id, id)).toEqual(fore);
    }
    korda.add('K7');
  });

  it('K8 grannbolaget får 404 åt båda hållen', async () => {
    const b = await nyttBolag('Komplettering K8');
    const granne = await nyttBolag('Komplettering K8 granne');
    const grannens = await plantera(granne, 'registrera_uppdragsbeslut', { contract_id: '0e1a7777-7777-4777-8777-777777777779' });
    const res = await komplettera(b, grannens, 8);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const over = await api.post(`/api/companies/${granne.id}/actions/komplettera_beslutsforslag`).set(b.auth)
      .send({ approval_id: grannens, timmar: 8 });
    expect(over.status, JSON.stringify(over.body)).toBe(404);
    korda.add('K8');
  });

  it('K9 felaktigt indata ger 400 validation_error, och ingenting skrivs', async () => {
    const b = await nyttBolag('Komplettering K9');
    const ilt = await iltUppdrag(b, { namn: 'ILT K9' });
    const { approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const fall: Array<Record<string, unknown>> = [
      ...[0, -1, 8.001, 1_000_000, '8', null].map((timmar) => ({ approval_id: a, timmar })),
      { approval_id: a },
      { approval_id: a, timmar: 8, extra: 1 },
      { approval_id: 'x', timmar: 8 },
    ];
    for (const kropp of fall) {
      const fore = await tillstand(b.id, a);
      const res = await act(b, 'komplettera_beslutsforslag', kropp);
      expect(res.status, `${JSON.stringify(kropp)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe('validation_error');
      expect(await tillstand(b.id, a)).toEqual(fore);
    }
    korda.add('K9');
  });

  it('K10 en upptagen kod avvisar tillägget med 409, men inte ”ryms”', async () => {
    const b = await nyttBolag('Komplettering K10');
    const ilt = await iltUppdrag(b, { namn: 'ILT K10' });
    // (a) en annan baselineändring av 2B väntar.
    const { approvalId: a } = await fragaUtanTimmar(b, ilt, 'tillagg', '2B');
    await koa(b, 'andra_baseline', {
      contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: '2027-01-01', change_reason: 'Annan ändring av 2B',
    });
    const fore = await tillstand(b.id, a);
    const upptagen = await komplettera(b, a, 8);
    expect(upptagen.status, JSON.stringify(upptagen.body)).toBe(409);
    expect(upptagen.body.error).toBe('avtalsdel_upptagen');
    expect(await tillstand(b.id, a)).toEqual(fore);
    expect((await ersattning(a)).status).toBe('pending');
    // (c) ”ryms” på samma kod prövar inte versionen.
    const { approvalId: ryms } = await fragaUtanTimmar(b, ilt, 'ryms', '2B');
    expect((await komplettera(b, ryms, 8)).status).toBe(200);
    // (b) en senare version av 2A har godkänts.
    const { approvalId: a2 } = await fragaUtanTimmar(b, ilt, 'tillagg', '2A');
    const senare = await withAdmin(async (c) => (await c.query<{ d: string }>("SELECT (current_date + 30)::text AS d")).rows[0]!.d);
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: ilt.contractId, code: '2A', name: 'Del 2A', valid_from: senare, cap_hours: 32, cap_confirmed: true,
      change_reason: 'Ny version längre fram (syntetiskt prov)',
    }));
    const fore2 = await tillstand(b.id, a2);
    const senareSvar = await komplettera(b, a2, 8);
    expect(senareSvar.status, JSON.stringify(senareSvar.body)).toBe(409);
    expect(senareSvar.body.error).toBe('avtalsdel_upptagen');
    expect(await tillstand(b.id, a2)).toEqual(fore2);
    korda.add('K10');
  });

  it('K11 ett stängt uppdrag ger 409 uppdraget_stangt, och ingenting skrivs', async () => {
    const b = await nyttBolag('Komplettering K11');
    const ilt = await iltUppdrag(b, { namn: 'ILT K11' });
    const { approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    await ok(b, 'set_project_status', { project_id: ilt.projektId, status: 'closed' });
    const fore = await tillstand(b.id, a);
    const res = await komplettera(b, a, 8);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('uppdraget_stangt');
    expect(await tillstand(b.id, a)).toEqual(fore);
    korda.add('K11');
  });

  it('K17 åtgärdens definition: write, kravManniska, ingen tvåfas och ingen ”inte nu”', async () => {
    const def = getAction('komplettera_beslutsforslag');
    expect(def).toMatchObject({ sensitivity: 'write', kravManniska: true });
    expect(def!.tvafas).toBeFalsy();
    expect(def!.vidAvslag).toBeUndefined();
    const post = actionManifest().find((m) => m.name === 'komplettera_beslutsforslag');
    expect(post).toMatchObject({ requires_approval: false });
    const schema = post!.input_schema as { properties: Record<string, unknown>; additionalProperties: unknown };
    expect(Object.keys(schema.properties).sort()).toEqual(['approval_id', 'timmar']);
    expect(schema.additionalProperties).toBe(false);
    expect((MANDATATGARDER as readonly string[]).includes('komplettera_beslutsforslag')).toBe(false);
    expect(actionManifest().filter((m) => m.name.includes('inte_nu'))).toEqual([]);
    const b = await nyttBolag('Komplettering K17');
    const ilt = await iltUppdrag(b, { namn: 'ILT K17' });
    await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const sidan = await b.ua.get(`/app/c/${b.id}/uppdrag`);
    expect(sidan.status).toBe(200);
    expect(sidan.text).not.toMatch(/<button[^>]*>\s*Inte nu\s*<\/button>/i);
    korda.add('K17');
  });

  it('kontrollvakt: K2 och K7–K11 och K17 kördes', () => expect([...korda].sort())
    .toEqual(['K10', 'K11', 'K17', 'K2', 'K7', 'K8', 'K9']));
});

describe('S samtidiga försök avgörs av låset', () => {
  let b: Bolag;
  let ilt: Ilt;
  const korda = new Set<string>();
  beforeAll(async () => {
    b = await nyttBolag('Komplettering S');
    ilt = await iltUppdrag(b, { namn: 'ILT S' });
  });
  /** Ingen beslutsrad för källan bär ett utkast, och en ersatt post bär inget beslut. */
  async function ingetFalsktAvslag(a: string, rad: string) {
    expect((await beslutForKalla(b, rad)).filter((r) => r.utkast !== null)).toEqual([]);
    const q = await ersattning(a);
    if (q.ersatt_av !== null) {
      expect(q).toMatchObject({ beslut_hash: null, decided_by: null });
      expect((await beslutForKalla(b, rad)).filter((r) => r.approval_id === a)).toEqual([]);
      expect(await beslutshandelser(b.id, [a, q.ersatt_av])).toEqual([]);
    }
  }
  /** Det vinnande svaret syns som beslutshändelser på köposten, i båda formerna. */
  async function beslutSyns(a: string, handelser: string[]) {
    const pa = (await beslutshandelser(b.id, [a])).map((h) => h.action);
    for (const h of handelser) expect(pa, h).toContain(h);
  }

  for (const runda of [1, 2, 3]) it(`S1 runda ${runda}: två kompletteringar av samma post`, async () => {
    const { anteckningId: rad, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const svar = await Promise.all([komplettera(b, a, 8), komplettera(b, a, 9)]);
    expect(svar.map((r) => r.status).sort()).toEqual([200, 409]);
    const vinnare = svar.find((r) => r.status === 200)!;
    expect(svar.find((r) => r.status === 409)!.body.error).toBe('not_pending');
    expect(await koposterForKalla(b.id, rad)).toHaveLength(2);
    expect((await ersattning(a)).ersatt_av).toBe(vinnare.body.result.ersatt_av);
    expect(await beslutForKalla(b, rad)).toEqual([]);
    await ingetFalsktAvslag(a, rad);
    korda.add(`S1.${runda}`);
  });

  for (const runda of [1, 2, 3]) it(`S2 runda ${runda}: en komplettering och ett ja`, async () => {
    const { anteckningId: rad, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const [k, j] = await Promise.all([komplettera(b, a, 8), rest(b, `approvals/${a}/approve`)]);
    const lyckade = [k, j].filter((r) => r.status >= 200 && r.status < 300);
    expect(lyckade, JSON.stringify([k.body, j.body])).toHaveLength(1);
    const forlorare = [k, j].find((r) => !(r.status >= 200 && r.status < 300))!;
    expect(forlorare.status).toBe(409);
    expect(forlorare.body.error).toBe('not_pending');
    if (k.status === 200) {
      expect(await beslutForKalla(b, rad)).toEqual([]);
      expect((await ersattning(a)).beslut_hash).toBeNull();
      expect(await koposterForKalla(b.id, rad)).toHaveLength(2);
    } else {
      expect((await ersattning(a)).status).toBe('executed');
      const rader = await beslutForKalla(b, rad);
      expect(rader.map((r) => r.utfall)).toEqual(['ja']);
      expect(await koposterForKalla(b.id, rad)).toHaveLength(1);
      await beslutSyns(a, ['action.approved', 'uppdrag.beslut_registrerat']);
    }
    expect((await beslutForKalla(b, rad)).filter((r) => r.utfall === 'nej')).toEqual([]);
    await ingetFalsktAvslag(a, rad);
    korda.add(`S2.${runda}`);
  });

  for (const runda of [1, 2, 3]) it(`S3 runda ${runda}: en komplettering och ett nej med skäl`, async () => {
    const { anteckningId: rad, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const [k, n] = await Promise.all([komplettera(b, a, 8), act(b, 'avboj_beslutsforslag', { approval_id: a, skal: 'Prov' })]);
    expect([k.status, n.status].sort(), JSON.stringify([k.body, n.body])).toEqual([200, 409]);
    expect((k.status === 409 ? k : n).body.error).toBe('not_pending');
    if (k.status === 200) {
      expect((await beslutForKalla(b, rad)).filter((r) => r.utfall === 'nej')).toEqual([]);
      expect((await ersattning(a)).beslut_hash).toBeNull();
    } else {
      expect(await ersattning(a)).toMatchObject({ beslut_hash: expect.stringMatching(/^[a-f0-9]{64}$/), beslut_skal: 'Prov', ersatt_av: null });
      const nej = (await beslutForKalla(b, rad)).filter((r) => r.utfall === 'nej');
      expect(nej.map((r) => r.approval_id)).toEqual([a]);
      expect(await koposterForKalla(b.id, rad)).toHaveLength(1);
      await beslutSyns(a, ['action.rejected', 'uppdrag.forslag_avbojt']);
    }
    await ingetFalsktAvslag(a, rad);
    korda.add(`S3.${runda}`);
  });

  it('kontrollvakt: tre rundor per förlopp kördes', () => expect([...korda].sort()).toEqual(
    ['S1.1', 'S1.2', 'S1.3', 'S2.1', 'S2.2', 'S2.3', 'S3.1', 'S3.2', 'S3.3']));
});

// --- T: ”ändrat sedan förslaget” i läsvägen (Task 4) -------------------------

const andratFor = (u: Undantag, id: string) => u.poster.find((p) => p.id === id)?.ovrigt?.andrat;
/** Avtalets timpris, ändrat som ägare (formen av `uppdragsytan-agandegrans-cache.test.ts` rad 216). */
const sattTaxa = (b: Bolag, ilt: Ilt, taxa: number) =>
  withAdmin((c) => c.query('UPDATE contracts SET hourly_rate_ore=$3 WHERE company_id=$1 AND id=$2', [b.id, ilt.contractId, taxa]));
/** En ny, godkänd version av avtalsdelen. */
async function nyVersion(b: Bolag, ilt: Ilt, falt: Record<string, unknown>): Promise<void> {
  await godkann(b, await koa(b, 'upsert_contract_part', {
    contract_id: ilt.contractId, change_reason: 'Ny version efter förslaget (syntetiskt prov)', ...falt,
  }));
}

describe('T ”ändrat sedan förslaget” i läsvägen', () => {
  const korda = new Set<string>();
  /** Ett eget ILT-bolag med 600 förbrukade minuter på 2A. */
  async function iltBolag(namn: string, forbrukat = 600) {
    const b = await nyttBolag(`Komplettering ${namn}`);
    const ilt = await iltUppdrag(b, { namn: `ILT ${namn}` });
    if (forbrukat > 0) await forbruka(b, ilt, '2A', forbrukat);
    return { b, ilt };
  }
  let t2: { b: Bolag; ilt: Ilt; r: string } | null = null;
  let t4: { b: Bolag; ilt: Ilt; t: string } | null = null;

  it('T1 inget har ändrats: läst, delen finns och inga ändringar', async () => {
    const { b, ilt } = await iltBolag('T1');
    const { approvalId: r } = await ovrigtFraga(b, ilt);
    const u = await lasUndantagFor(b);
    expect(andratFor(u, r)).toEqual({ varde: { delen_finns: true, andringar: [] }, kalla: 'redovisning', last_nar: u.last_nar, lage: 'last' });
    korda.add('T1');
  });

  it('T2 ett nytt timpris ger taxan och beloppet med båda värdena', async () => {
    const { b, ilt } = await iltBolag('T2');
    const { approvalId: r } = await ovrigtFraga(b, ilt);
    await sattTaxa(b, ilt, 120_000);
    const u = await lasUndantagFor(b);
    expect(andratFor(u, r)).toMatchObject({ lage: 'last', varde: { delen_finns: true, andringar: [
      { falt: 'taxa_ore', forslag: 100000, nu: 120000 },
      { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
    ] } });
    t2 = { b, ilt, r };
    korda.add('T2');
  });

  it('T3 mer förbrukning ger förbrukningen och utrymmet', async () => {
    const { b, ilt } = await iltBolag('T3');
    const { approvalId: r } = await ovrigtFraga(b, ilt);
    await forbruka(b, ilt, '2A', 60);
    const u = await lasUndantagFor(b);
    expect(andratFor(u, r)?.varde?.andringar).toEqual([
      { falt: 'forbrukade_minuter', forslag: 600, nu: 660 },
      { falt: 'kvar_fore_minuter', forslag: 1320, nu: 1260 },
      { falt: 'kvar_efter_minuter', forslag: 840, nu: 780 },
    ]);
    korda.add('T3');
  });

  it('T4 en ny version med högre tak ger taket, det nya taket och utrymmet', async () => {
    const { b, ilt } = await iltBolag('T4');
    const { approvalId: t } = await ovrigtFraga(b, ilt, { alternativ: 'tillagg', avtalsdel_kod: '2B' });
    await nyVersion(b, ilt, { code: '2B', name: 'Del 2B', valid_from: '2026-10-01', cap_hours: 14, cap_confirmed: true });
    const u = await lasUndantagFor(b);
    expect(andratFor(u, t)?.varde?.andringar).toEqual([
      { falt: 'tak_minuter', forslag: 720, nu: 840 },
      { falt: 'nytt_tak_minuter', forslag: 1200, nu: 1320 },
      { falt: 'kvar_fore_minuter', forslag: 720, nu: 840 },
      { falt: 'kvar_efter_minuter', forslag: 720, nu: 840 },
    ]);
    t4 = { b, ilt, t };
    korda.add('T4');
  });

  it('T5 en inaktiv avtalsdel ger delen_finns falskt', async () => {
    const { b, ilt } = await iltBolag('T5');
    const { approvalId: r } = await ovrigtFraga(b, ilt);
    await nyVersion(b, ilt, { code: '2A', name: 'Del 2A', valid_from: '2026-10-02', cap_hours: 32, cap_confirmed: true, active: false });
    const u = await lasUndantagFor(b);
    expect(andratFor(u, r)?.varde).toEqual({ delen_finns: false, andringar: [] });
    korda.add('T5');
  });

  it('T7 kanalparitet: människan, agenten och direktanropet får samma jämförelse', async () => {
    const { b, r } = t2!;
    const utanTid = (v: unknown) => ({ ...(v as Record<string, unknown>), last_nar: 'X' });
    const manniska = andratFor(await lasUndantagFor(b), r);
    const agent = await act(b, 'las_undantag', {}, b.agent);
    expect(agent.status).toBe(200);
    const direkt = await withTenantTransaction(b.user.userId, b.id, (c) => lasUndantag(c, b.id));
    const forvantat = { varde: { delen_finns: true, andringar: [
      { falt: 'taxa_ore', forslag: 100000, nu: 120000 }, { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
    ] }, kalla: 'redovisning', last_nar: 'X', lage: 'last' };
    expect(utanTid(manniska)).toEqual(forvantat);
    expect(utanTid(andratFor(agent.body.result as Undantag, r))).toEqual(forvantat);
    expect(utanTid(andratFor(direkt, r))).toEqual(forvantat);
    korda.add('T7');
  });

  it('T6 ja godkänner det lagrade förslaget, inte det omräknade', async () => {
    const { b, r } = t2!;
    await godkann(b, r);
    const rad = (await withAdmin((c) => c.query('SELECT underlag FROM uppdrag_beslut WHERE approval_id=$1', [r]))).rows[0];
    expect(rad.underlag.indata.beslutsunderlag).toMatchObject({ taxa_ore: 100000, belopp_ore: 800000 });
    const { b: b4, ilt: ilt4, t } = t4!;
    const input = await kopostInput(t);
    await godkann(b4, t);
    const version = (await withAdmin((c) => c.query(
      "SELECT cap_hours::text AS cap_hours FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code='2B' AND valid_from=$3::date",
      [b4.id, ilt4.contractId, input.valid_from]))).rows;
    expect(version).toEqual([{ cap_hours: '20.00' }]);
    korda.add('T6');
  });

  it('T8 en beräkning som inte går att göra är oläst, och läsvägen svarar ändå', async () => {
    const { b, ilt } = await iltBolag('T8', 0);
    const { approvalId: r } = await ovrigtFraga(b, ilt);
    await sattTaxa(b, ilt, Number.MAX_SAFE_INTEGER);
    const res = await act(b, 'las_undantag', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const u = res.body.result as Undantag;
    expect(andratFor(u, r)).toEqual({ varde: null, kalla: 'redovisning', last_nar: u.last_nar, lage: 'olast' });
    korda.add('T8');
  });

  it('kontrollvakt: T1–T8 kördes', () => expect([...korda].sort())
    .toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']));
});

describe('E12 uteslutningen i återförsöket är uttrycklig', () => {
  it('E12 en ersatt post med beslut_hash väljs aldrig, när CHECK är borta', async () => {
    const b = await nyttBolag('Komplettering E12');
    const ilt = await iltUppdrag(b, { namn: 'ILT E12' });
    const input = { contract_id: ilt.contractId, notes: 'Prov' };
    const p = await plantera(b, 'update_contract', input);
    const r = await plantera(b, 'update_contract', input);
    const q = await plantera(b, 'update_contract', input);
    await withAdmin((c) => c.query('ALTER TABLE action_approvals DROP CONSTRAINT action_approvals_ersatt_utan_beslut'));
    try {
      await withAdmin((c) => c.query(
        "UPDATE action_approvals SET status='approved', decided_by=$2, decided_at=clock_timestamp(), beslut_hash=$3, ersatt_av=$4 WHERE id=$1",
        [p, b.user.userId, beslutHash(input), q]));
      await withAdmin((c) => c.query(
        "UPDATE action_approvals SET status='approved', decided_by=$2, decided_at=clock_timestamp(), beslut_hash=$3 WHERE id=$1",
        [r, b.user.userId, beslutHash(input)]));
      const fore = await kopostRad(p);
      await withTenantTransaction(b.user.userId, b.id, async (c) => {
        const mottagna = (await listaMottagnaBeslut(c, b.id, MANDATATGARDER)).map((x) => x.id);
        expect(mottagna).toContain(r);
        expect(mottagna).not.toContain(p);
      });
      const v = await withTenantTransaction(b.user.userId, b.id, (c) => verkstallMottagnaBeslut(c, b.id));
      expect(v.verkstallda).toContain(r);
      expect(v.verkstallda).not.toContain(p);
      expect(v.kvar).not.toContain(p);
      expect(await kopostRad(p)).toEqual(fore);
    } finally {
      await withAdmin((c) => c.query('DELETE FROM action_approvals WHERE id=$1', [p]));
      await withAdmin((c) => c.query(`ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_ersatt_utan_beslut ${ERSATT_UTAN_BESLUT}`));
    }
    const finns = await withAdmin(async (c) => (await c.query(
      "SELECT 1 FROM pg_constraint WHERE conname='action_approvals_ersatt_utan_beslut' AND conrelid='action_approvals'::regclass")).rows);
    expect(finns).toHaveLength(1);
  });
});
