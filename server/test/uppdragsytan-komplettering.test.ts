// Story 1.15, B-2 och IR-13: kompletteringen ersätter en väntande Övrigt-köpost och
// är inget beslut. Riskerna och lagren: kolumnens skydd i databasen (CHECK, FK,
// UNIQUE och triggern), kärnans läsningar och uttryckliga uteslutning i återförsöket,
// de rena reglerna utan databas, kompletteringen genom REST, samtidigheten under
// låset och läsvägens jämförelse med aktuella källor.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, withAdmin } from './helpers.js';
import { act, godkann, koa, nyttBolag, ok, plantera, posta, rest, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, auditFor, beslutsraderFor, delversioner, forbruka, forslag, iltUppdrag, kopostInput, kopostRad,
  kopostUtanUnderlag, ovrigtFraga, planteraMedStatus, svepa, type Ilt,
} from './ovrigtRigg.js';
import {
  beslutForKalla, ersattning, fragaUtanTimmar, komplettera, koposterForKalla, planteraErsattning, tillstand,
} from './kompletteringRigg.js';
import { provaJ1, provaJ2, provaJ3, provaJ4, provaJ5, provaJ6, provaJ7, provaJ8, provaJ9, provaJ10 } from './kompletteringHelper.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { NotFoundError } from '../src/lib/errors.js';
import { beslutHash, ersattGodkannande, listaMottagnaBeslut, listRecentDecisions } from '../src/services/approvals.js';
import { MANDATATGARDER } from '../src/services/uppdragBeslut.js';
import { verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { actionManifest, getAction } from '../src/actions/registry.js';
import { lasUndantag } from '../src/services/uppdragUndantag.js';

const fel = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; constraint?: string; message?: string }) => e);
const ERSATT_UTAN_BESLUT = 'action_approvals_ersatt_utan_beslut';
/** CHECK-definitionen ur migration 0083, ordagrant, för att lägga tillbaka den i E12. */
const ERSATT_UTAN_BESLUT_DEF = `CHECK (ersatt_av IS NULL OR (status = 'rejected' AND decided_by IS NULL AND decided_at IS NULL
        AND beslut_hash IS NULL AND beslut_skal IS NULL))`;

describe('E kolumnen ersatt_av och kärnan', () => {
  const korda = new Set<string>();
  let b: Bolag;
  let ilt: Ilt;
  let granne: Bolag;
  let grannQ: string;
  // E9–E11: en Övrigt-fråga A (”ryms” på 2A med 8 h) som ersatts av Q.
  let o: Bolag;
  let iltO: Ilt;
  let A: string;
  let Q: string;
  const input = () => ({ contract_id: ilt.contractId, notes: 'Prov' });
  const ny = () => plantera(b, 'update_contract', input());
  const somApp = (sql: string, varden: unknown[]) => withTenantTransaction(b.user.userId, b.id, (c) => c.query(sql, varden));

  beforeAll(async () => {
    b = await nyttBolag('Komplettering E');
    ilt = await iltUppdrag(b);
    granne = await nyttBolag('Komplettering E granne');
    grannQ = await plantera(granne, 'update_contract', { contract_id: randomUUID(), notes: 'Grannens' });
    o = await nyttBolag('Komplettering E9');
    iltO = await iltUppdrag(o);
    A = (await ovrigtFraga(o, iltO)).approvalId;
    Q = await planteraErsattning(o, A);
  });

  it('E1 kolumnen, de fyra skydden och triggerns fem regler finns', async () => {
    const kol = (await withAdmin((c) => c.query(
      "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='action_approvals' AND column_name='ersatt_av'",
    ))).rows;
    expect(kol).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
    const villkor = (await withAdmin((c) => c.query<{ conname: string; contype: string; def: string }>(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='action_approvals'::regclass AND conname = ANY($1::text[])`,
      [['action_approvals_ersatt_av_fk', 'action_approvals_ersatt_av_uk', ERSATT_UTAN_BESLUT, 'action_approvals_ersatt_inte_sig_sjalv']],
    ))).rows;
    const per = new Map(villkor.map((v) => [v.conname, v]));
    expect([...per.keys()].sort()).toEqual(['action_approvals_ersatt_av_fk', 'action_approvals_ersatt_av_uk',
      'action_approvals_ersatt_inte_sig_sjalv', ERSATT_UTAN_BESLUT]);
    expect(per.get('action_approvals_ersatt_av_fk')!.contype).toBe('f');
    expect(per.get('action_approvals_ersatt_av_fk')!.def).toMatch(/^FOREIGN KEY \(ersatt_av, company_id\) REFERENCES action_approvals\s*\(id, company_id\)/);
    expect(per.get('action_approvals_ersatt_av_uk')!.contype).toBe('u');
    expect(per.get('action_approvals_ersatt_av_uk')!.def).toBe('UNIQUE (ersatt_av)');
    expect(per.get(ERSATT_UTAN_BESLUT)!.contype).toBe('c');
    expect(per.get('action_approvals_ersatt_inte_sig_sjalv')!.contype).toBe('c');
    const def = (await withAdmin((c) => c.query<{ def: string }>(
      "SELECT pg_get_functiondef('mottaget_beslut_ar_oforanderligt'::regproc) AS def",
    ))).rows[0]!.def;
    for (const meddelande of ['ett mottaget beslut ändras aldrig', 'ett beslut tas bara emot från en väntande post',
      'ett mottaget beslut blir aldrig en obesvarad fråga igen', 'bara en väntande post kan ersättas', 'en ersättning ändras aldrig']) {
      expect(def, meddelande).toContain(meddelande);
    }
    korda.add('E1');
  });

  it('E2 CHECK fäller en ersättning med beslutsfält, och posten är oförändrad', async () => {
    const p = await ny(); const q = await ny(); const fore = await kopostRad(p);
    const hash = 'a'.repeat(64);
    const fall: Array<[string, string, unknown[], string | null]> = [
      ['a', "status='rejected', ersatt_av=$3, decided_by=$4", [q, b.user.userId], ERSATT_UTAN_BESLUT],
      ['b', "status='rejected', ersatt_av=$3, decided_at=now()", [q], ERSATT_UTAN_BESLUT],
      ['c', "status='rejected', ersatt_av=$3, decided_by=$4, decided_at=now(), beslut_hash=$5", [q, b.user.userId, hash], null],
      ['d', "status='rejected', ersatt_av=$3, decided_by=$4, decided_at=now(), beslut_hash=$5, beslut_skal='x'", [q, b.user.userId, hash], null],
      ['e', 'ersatt_av=$3', [q], ERSATT_UTAN_BESLUT],
    ];
    for (const [namn, satt, varden, namnVillkor] of fall) {
      const e = await fel(somApp(`UPDATE action_approvals SET ${satt} WHERE company_id=$1 AND id=$2`, [b.id, p, ...varden]));
      expect(e?.code, namn).toBe('23514');
      if (namnVillkor) expect(e?.constraint, namn).toBe(namnVillkor);
      expect(await kopostRad(p), namn).toEqual(fore);
    }
    korda.add('E2');
  });

  it('E3 triggern fäller en ersättning av en post som inte är väntande', async () => {
    for (const [namn, status] of [['a', 'approved'], ['b', 'executed'], ['c', 'rejected'], ['d', 'failed']] as const) {
      const p = await planteraMedStatus(b, 'update_contract', input(), status);
      const q = await ny(); const fore = await kopostRad(p);
      const e = await fel(somApp("UPDATE action_approvals SET status='rejected', ersatt_av=$3 WHERE company_id=$1 AND id=$2", [b.id, p, q]));
      expect(e?.code, namn).toBe('P0001');
      expect(e?.message, namn).toContain('bara en väntande post kan ersättas');
      expect(await kopostRad(p), namn).toEqual(fore);
    }
    korda.add('E3');
  });

  it('E4 en ersättning ändras aldrig, som app och som ägarrollen', async () => {
    const p = await ny(); const q = await planteraErsattning(b, p); const r = await ny();
    expect((await kopostRad(p)).ersatt_av).toBe(q);
    const fall: Array<[string, string, unknown[], string, string]> = [
      ['a', 'ersatt_av=$3', [r], 'P0001', 'en ersättning ändras aldrig'],
      ['b', 'ersatt_av=NULL', [], 'P0001', 'en ersättning ändras aldrig'],
      ['c', "status='pending'", [], '23514', ERSATT_UTAN_BESLUT],
      ['d', 'decided_by=$3', [b.user.userId], '23514', ERSATT_UTAN_BESLUT],
    ];
    const fore = await kopostRad(p);
    for (const [namn, satt, varden, kod, vad] of fall) {
      const sql = `UPDATE action_approvals SET ${satt} WHERE company_id=$1 AND id=$2`;
      for (const [vem, e] of [['app', await fel(somApp(sql, [b.id, p, ...varden]))],
        ['admin', await fel(withAdmin((c) => c.query(sql, [b.id, p, ...varden])))]] as const) {
        expect(e?.code, `${namn} ${vem}`).toBe(kod);
        if (kod === 'P0001') expect(e?.message, `${namn} ${vem}`).toContain(vad);
        else expect(e?.constraint, `${namn} ${vem}`).toBe(vad);
        expect(await kopostRad(p), `${namn} ${vem}`).toEqual(fore);
      }
    }
    korda.add('E4');
  });

  it('E5 FK: grannens köpost och ett slumpat id fälls', async () => {
    for (const [namn, mal] of [['a', grannQ], ['b', randomUUID()]] as const) {
      const p = await ny(); const fore = await kopostRad(p);
      const e = await fel(somApp("UPDATE action_approvals SET status='rejected', ersatt_av=$3 WHERE company_id=$1 AND id=$2", [b.id, p, mal]));
      expect(e?.code, namn).toBe('23503');
      expect(await kopostRad(p), namn).toEqual(fore);
    }
    korda.add('E5');
  });

  it('E6 UNIQUE: en ersättare ersätter bara en post', async () => {
    const p1 = await ny(); const q = await planteraErsattning(b, p1); const p2 = await ny(); const fore = await kopostRad(p2);
    const e = await fel(somApp("UPDATE action_approvals SET status='rejected', ersatt_av=$3 WHERE company_id=$1 AND id=$2", [b.id, p2, q]));
    expect(e?.code).toBe('23505'); expect(e?.constraint).toBe('action_approvals_ersatt_av_uk');
    expect(await kopostRad(p2)).toEqual(fore);
    korda.add('E6');
  });

  it('E7 en post ersätter aldrig sig själv', async () => {
    const p = await ny(); const fore = await kopostRad(p);
    const e = await fel(somApp("UPDATE action_approvals SET status='rejected', ersatt_av=$2 WHERE company_id=$1 AND id=$2", [b.id, p]));
    expect(e?.code).toBe('23514'); expect(e?.constraint).toBe('action_approvals_ersatt_inte_sig_sjalv');
    expect(await kopostRad(p)).toEqual(fore);
    korda.add('E7');
  });

  it('E8 ersattGodkannande märker en väntande post utan beslutsfält och utan auditrad', async () => {
    const audit = async () => (await withAdmin((c) => c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1', [b.id]))).rows[0]!.n;
    const p = await ny(); const q = await ny(); const auditFore = await audit();
    const r = await withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, p, q));
    expect(Object.hasOwn(r, 'ersatt_av')).toBe(true);
    expect(r).toMatchObject({ id: p, status: 'rejected', ersatt_av: q, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null });
    expect(await kopostRad(p)).toMatchObject({ status: 'rejected', ersatt_av: q, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null });
    expect(await audit()).toBe(auditFore);
    const godkand = await planteraMedStatus(b, 'update_contract', input(), 'approved');
    await expect(withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, godkand, q)))
      .rejects.toMatchObject({ code: 'not_pending' });
    for (const okand of [randomUUID(), grannQ]) {
      await expect(withTenantTransaction(b.user.userId, b.id, (c) => ersattGodkannande(c, b.id, okand, q)))
        .rejects.toBeInstanceOf(NotFoundError);
    }
    korda.add('E8');
  });

  it('E9 läsvägen, täckningen och återförsöket väljer aldrig en ersatt post', async () => {
    const u = await act(o, 'las_undantag', {});
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    const ids = (u.body.result.poster as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(Q); expect(ids).not.toContain(A);
    expect((u.body.result.hoppade as Array<{ id: string }>).map((h) => h.id)).not.toContain(A);
    const s = await svepa(o);
    expect(s.tackning.find((r: { contract_id: string; kalla: string }) => r.contract_id === iltO.contractId && r.kalla === 'ovrigt'))
      .toMatchObject({ lage: 'last', saknas: [] });
    const fore = await kopostRad(A);
    await withTenantTransaction(o.user.userId, o.id, async (c) => {
      expect(await verkstallMottagnaBeslut(c, o.id)).toEqual({ verkstallda: [], kvar: [] });
      const mottagna = (await listaMottagnaBeslut(c, o.id, MANDATATGARDER)).map((r) => r.id);
      expect(mottagna).not.toContain(A); expect(mottagna).not.toContain(Q);
      expect((await verkstallBeslut(c, o.id, A)).verkstalld).toBe(false);
    });
    expect(await kopostRad(A)).toEqual(fore);
    korda.add('E9');
  });

  it('E10 en ersatt post går inte att avgöra igen i någon ingång, och ingenting skrivs', async () => {
    const fore = await tillstand(o.id, A);
    const lika = async (namn: string) => expect(await tillstand(o.id, A), namn).toEqual(fore);
    for (const [namn, res] of [
      ['a', await rest(o, `approvals/${A}/approve`)],
      ['b', await rest(o, `approvals/${A}/reject`, { reason: 'Prov' })],
      ['c', await act(o, 'avboj_beslutsforslag', { approval_id: A, skal: 'Prov' })],
    ] as const) {
      expect(res.status, `${namn} ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error, namn).toBe('not_pending');
      await lika(namn);
    }
    for (const [namn, res] of [
      ['d godkänn', await o.ua.post(`/app/c/${o.id}/approvals/${A}/approve`).type('form').send({})],
      ['d avvisa', await o.ua.post(`/app/c/${o.id}/approvals/${A}/reject`).type('form').send({ skal: 'Prov' })],
      ['e ja', await posta(o, { handling: 'ja', approval_id: A })],
      ['e nej', await posta(o, { handling: 'nej', approval_id: A, skal: 'Prov' })],
    ] as const) {
      expect(res.status, namn).toBe(302);
      expect(res.headers.location ?? '', namn).not.toContain('fel=');
      await lika(namn);
    }
    const agentJa = await rest(o, `approvals/${A}/approve`, {}, o.agent);
    expect(agentJa.status).toBe(403); expect(agentJa.body.error).toBe('human_approval_required');
    const agentNej = await act(o, 'avboj_beslutsforslag', { approval_id: A, skal: 'Prov' }, o.agent);
    expect(agentNej.status).toBe(403); expect(agentNej.body.error).toBe('human_required');
    await lika('f');
    expect((await kopostRad(Q)).status).toBe('pending');
    korda.add('E10');
  });

  it('E11 REST:s läsning av köposterna bär ersatt_av', async () => {
    const lista = async (fraga = '') => {
      const r = await api.get(`/api/companies/${o.id}/approvals${fraga}`).set(o.auth);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.approvals as Array<Record<string, unknown>>;
    };
    const alla = await lista();
    expect(alla.find((q) => q.id === A)).toMatchObject({ ersatt_av: Q, status: 'rejected', beslut_hash: null });
    expect(alla.find((q) => q.id === Q)).toMatchObject({ ersatt_av: null });
    const vantande = await lista('?status=pending');
    expect(vantande.map((q) => q.id)).toContain(Q); expect(vantande.map((q) => q.id)).not.toContain(A);
    expect(Object.hasOwn(vantande.find((q) => q.id === Q)!, 'ersatt_av')).toBe(true);
    expect((await lista('?status=rejected')).find((q) => q.id === A)).toMatchObject({ ersatt_av: Q });
    korda.add('E11');
  });

  it('E12 återförsöket utesluter en ersatt post uttryckligen, också utan CHECK', async () => {
    const e = await nyttBolag('Komplettering E12');
    const ilt12 = await iltUppdrag(e);
    const in12 = { contract_id: ilt12.contractId, notes: 'Prov' };
    const P = await plantera(e, 'update_contract', in12);
    const R = await plantera(e, 'update_contract', in12);
    const Q12 = await plantera(e, 'update_contract', in12);
    await withAdmin((c) => c.query(`ALTER TABLE action_approvals DROP CONSTRAINT ${ERSATT_UTAN_BESLUT}`));
    try {
      await withAdmin((c) => c.query(`UPDATE action_approvals SET status='approved', decided_by=$3, decided_at=clock_timestamp(),
        beslut_hash=$4, ersatt_av=$5 WHERE company_id=$1 AND id=$2`, [e.id, P, e.user.userId, beslutHash(in12), Q12]));
      await withAdmin((c) => c.query(`UPDATE action_approvals SET status='approved', decided_by=$3, decided_at=clock_timestamp(),
        beslut_hash=$4 WHERE company_id=$1 AND id=$2`, [e.id, R, e.user.userId, beslutHash(in12)]));
      const fore = await kopostRad(P);
      await withTenantTransaction(e.user.userId, e.id, async (c) => {
        const mottagna = (await listaMottagnaBeslut(c, e.id, MANDATATGARDER)).map((r) => r.id);
        expect(mottagna).toContain(R); expect(mottagna).not.toContain(P);
        const v = await verkstallMottagnaBeslut(c, e.id);
        expect(v.verkstallda).toContain(R);
        expect([...v.verkstallda, ...v.kvar]).not.toContain(P);
      });
      expect(await kopostRad(P)).toEqual(fore);
    } finally {
      await withAdmin(async (c) => {
        await c.query('DELETE FROM uppdrag_beslut WHERE approval_id=$1', [P]);
        await c.query('DELETE FROM action_approvals WHERE id=$1', [P]);
        await c.query(`ALTER TABLE action_approvals ADD CONSTRAINT ${ERSATT_UTAN_BESLUT} ${ERSATT_UTAN_BESLUT_DEF}`);
      });
      const finns = (await withAdmin((c) => c.query("SELECT 1 FROM pg_constraint WHERE conname=$1 AND contype='c'", [ERSATT_UTAN_BESLUT]))).rows;
      expect(finns).toHaveLength(1);
    }
    korda.add('E12');
  });

  it('kontrollvakt: alla tolv fall kördes', () => expect([...korda].sort()).toEqual(
    ['E1', 'E10', 'E11', 'E12', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9']));
});

describe('J de rena reglerna', () => {
  it('J1 delunderlag mappar en avtalsdel som svepet gör', provaJ1);
  it('J2 egetTakTimmar läser den gällande versionens tak', provaJ2);
  it('J3 ingen ändring ger tomma andringar', provaJ3);
  it('J4 ny taxa ändrar taxan och beloppet', provaJ4);
  it('J5 mer förbrukning ändrar förbrukningen och utrymmet', provaJ5);
  it('J6 ett nytt tak ändrar taket, det nya taket och utrymmet', provaJ6);
  it('J7 utan timmar räknas null på båda sidor inte som ändrat', provaJ7);
  it('J8 en saknad del ger delen_finns falskt', provaJ8);
  it('J9 jämförelsen kastar aldrig', provaJ9);
  it('J10 ändringarna följer de sju fältens ordning', provaJ10);
});

/** Avtalets avtalsdelar, kolumn för kolumn, för ”ingen domänhandling”. */
async function avtalsdelar(b: Bolag, ilt: Ilt) {
  return (await withAdmin((c) => c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [b.id, ilt.contractId]))).rows;
}
/** Antalet auditrader med en viss händelse i bolaget. */
async function auditAntal(bolagId: string, handelse: string): Promise<number> {
  return (await withAdmin((c) => c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_log WHERE company_id=$1 AND action=$2', [bolagId, handelse]))).rows[0]!.n;
}
/** Databasens datum om n dagar, som `valid_from`. */
async function omDagar(n: number): Promise<string> {
  return (await withAdmin((c) => c.query<{ d: string }>('SELECT (current_date + $1::int)::text AS d', [n]))).rows[0]!.d;
}
/** Läsvägens poster vars Övrigt-rad är källan. */
async function posterForKalla(b: Bolag, anteckningId: string): Promise<Array<Record<string, any>>> {
  const u = await act(b, 'las_undantag', {});
  expect(u.status, JSON.stringify(u.body)).toBe(200);
  return (u.body.result.poster as Array<Record<string, any>>).filter((p) => p.ovrigt?.forfragan?.varde?.id === anteckningId);
}
const orsak = 'Ändrad omfattning (syntetiskt prov)';

describe('K kompletteringen', () => {
  const korda = new Set<string>();
  // K1, K3, K4, K6 och K13–K16: en ”ryms” på 2A utan timmar som kompletteras med 8 h.
  let b: Bolag;
  let ilt: Ilt;
  let rad: string;
  let A: string;
  let B: string;
  let svar: Awaited<ReturnType<typeof komplettera>>;
  let inputA: Record<string, any>;
  let rowA: Record<string, any>;
  let delarFore: Record<string, unknown>[];
  const auditFore: Record<string, number> = {};
  // K5, K7 och K9: ett bolag där inget lyckas.
  let x: Bolag;
  let iltX: Ilt;
  let granne: Bolag;
  let grannQ: string;

  beforeAll(async () => {
    b = await nyttBolag('Komplettering K');
    ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    ({ anteckningId: rad, approvalId: A } = await fragaUtanTimmar(b, ilt, 'ryms', '2A'));
    rowA = await kopostRad(A);
    inputA = rowA.input as Record<string, any>;
    delarFore = await avtalsdelar(b, ilt);
    for (const h of ['uppdrag.forslag_avbojt', 'uppdrag.beslut_registrerat']) auditFore[h] = await auditAntal(b.id, h);
    svar = await komplettera(b, A, 8);
    B = svar.body?.result?.ersatt_av as string;
    x = await nyttBolag('Komplettering K inget lyckas');
    iltX = await iltUppdrag(x);
    granne = await nyttBolag('Komplettering K granne');
    grannQ = await plantera(granne, 'registrera_uppdragsbeslut', { contract_id: randomUUID(), kalla: { typ: 'anteckning', id: randomUUID() } });
  });

  it('K1 ”ryms” utan timmar ersätts av en väntande post med Davids timmar och serverns beräkning', async () => {
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    expect(svar.body.result).toEqual({ approval_id: A, ersatt_av: B });
    const nyRad = await kopostRad(B);
    expect(nyRad).toMatchObject({ status: 'pending', action: 'registrera_uppdragsbeslut', requested_by: rowA.requested_by,
      requested_actor: rowA.requested_actor, ersatt_av: null });
    const inB = nyRad.input as Record<string, any>;
    expect(inB.contract_id).toBe(inputA.contract_id);
    expect(inB.kalla).toEqual(inputA.kalla);
    expect(inB.beslutsunderlag).toMatchObject({ skal: inputA.beslutsunderlag.skal, kallor: inputA.beslutsunderlag.kallor,
      alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8, minuter: 480, taxa_ore: 100000, belopp_ore: 800000,
      tak_minuter: 1920, forbrukade_minuter: 600, kvar_fore_minuter: 1320, kvar_efter_minuter: 840, giltig_fran: null, nytt_tak_minuter: null });
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(inB).success).toBe(true);
    expect(await ersattning(A)).toMatchObject({ status: 'rejected', ersatt_av: B, decided_by: null, decided_at: null,
      beslut_hash: null, beslut_skal: null, result: null, input: inputA });
    korda.add('K1');
  });

  it('K2 ett tillägg på 2B utan timmar ersätts med en ny version från samma dag och det nya taket', async () => {
    const k = await nyttBolag('Komplettering K2');
    const iltK = await iltUppdrag(k);
    const { approvalId: a } = await fragaUtanTimmar(k, iltK, 'tillagg', '2B');
    const inA = await kopostInput(a);
    const r = await komplettera(k, a, 8);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const nyRad = await kopostRad(r.body.result.ersatt_av as string);
    expect(nyRad).toMatchObject({ status: 'pending', action: 'andra_baseline' });
    const inB = nyRad.input as Record<string, any>;
    expect(inB).toMatchObject({ code: '2B', cap_hours: 20, valid_from: inA.valid_from, change_reason: inA.change_reason });
    expect(inB.beslutsunderlag).toMatchObject({ nytt_tak_minuter: 1200, giltig_fran: inA.valid_from, belopp_ore: 800000, kvar_efter_minuter: 720 });
    expect(getAction('andra_baseline')!.inputSchema.safeParse(inB).success).toBe(true);
    korda.add('K2');
  });

  it('K3 auditraden bär båda köposterna och inget beslut', async () => {
    const audA = await auditFor(b.id, A);
    const audB = await auditFor(b.id, B);
    const komp = audA.filter((r) => r.action === 'uppdrag.forslag_kompletterat');
    expect(komp).toHaveLength(1);
    expect(komp[0]!.details).toEqual({ approval_id: A, ersatt_av: B, atgard: 'registrera_uppdragsbeslut' });
    expect(JSON.stringify(komp[0]!.details)).not.toContain('extra rapport');
    for (const r of [...audA, ...audB]) {
      expect(['action.rejected', 'action.approved', 'action.approved_executed', 'action.rejected_executed']).not.toContain(r.action);
    }
    for (const h of ['uppdrag.forslag_avbojt', 'uppdrag.beslut_registrerat']) {
      expect(await auditAntal(b.id, h), h).toBe(auditFore[h]);
      const egna = (await withAdmin((c) => c.query("SELECT id FROM audit_log WHERE company_id=$1 AND action=$2 AND details->>'approval_id' = ANY($3::text[])",
        [b.id, h, [A, B]]))).rows;
      expect(egna, h).toEqual([]);
    }
    expect((await auditFor(b.id, 'komplettera_beslutsforslag')).filter((r) => r.action === 'action.executed')).toHaveLength(1);
    korda.add('K3');
  });

  it('K4 ingen beslutsrad och ingen avtalsdel', async () => {
    expect(await beslutForKalla(b.id, rad)).toEqual([]);
    expect(await avtalsdelar(b, ilt)).toEqual(delarFore);
    korda.add('K4');
  });

  it('K5 agentens nyckel får 403 human_required och ingenting skrivs', async () => {
    const { approvalId: a } = await fragaUtanTimmar(x, iltX, 'ryms', '2A');
    const fore = await tillstand(x.id, a);
    const r = await komplettera(x, a, 8, x.agent);
    expect(r.status, JSON.stringify(r.body)).toBe(403); expect(r.body.error).toBe('human_required');
    expect(await tillstand(x.id, a)).toEqual(fore);
    korda.add('K5');
  });

  it('K6 en ersatt post ger 409 not_pending i fyra vägar, och ingenting skrivs', async () => {
    const fore = await tillstand(b.id, A);
    for (const [namn, forsok] of [
      ['komplettera', () => komplettera(b, A, 9)],
      ['ja', () => rest(b, `approvals/${A}/approve`)],
      ['avvisa', () => rest(b, `approvals/${A}/reject`, { reason: 'Prov' })],
      ['avböj', () => act(b, 'avboj_beslutsforslag', { approval_id: A, skal: 'Prov' })],
    ] as const) {
      const r = await forsok();
      expect(r.status, `${namn} ${JSON.stringify(r.body)}`).toBe(409); expect(r.body.error, namn).toBe('not_pending');
      expect(await tillstand(b.id, A), namn).toEqual(fore);
    }
    korda.add('K6');
  });

  it('K7 bara en Övrigt-fråga kan kompletteras', async () => {
    const baseline = await koa(x, 'andra_baseline', { contract_id: iltX.contractId, code: '1A', name: 'Del 1A', valid_from: '2027-01-01', change_reason: orsak });
    const utanUnderlag = await plantera(x, 'registrera_uppdragsbeslut', kopostUtanUnderlag(iltX.contractId, await anteckning(x, iltX.contractId)));
    for (const [namn, id] of [['a', baseline], ['b', utanUnderlag]] as const) {
      const fore = await tillstand(x.id, id);
      const r = await komplettera(x, id, 8);
      expect(r.status, `${namn} ${JSON.stringify(r.body)}`).toBe(409); expect(r.body.error, namn).toBe('inte_ovrigtforslag');
      expect(await tillstand(x.id, id), namn).toEqual(fore);
    }
    const { approvalId: godkand } = await ovrigtFraga(x, iltX);
    await godkann(x, godkand);
    const fore = await tillstand(x.id, godkand);
    const r = await komplettera(x, godkand, 8);
    expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('not_pending');
    expect(await tillstand(x.id, godkand)).toEqual(fore);
    korda.add('K7');
  });

  it('K8 grannbolaget får 404 åt båda hållen', async () => {
    const r1 = await komplettera(b, grannQ, 8);
    expect(r1.status, JSON.stringify(r1.body)).toBe(404);
    const r2 = await api.post(`/api/companies/${granne.id}/actions/komplettera_beslutsforslag`).set(b.auth).send({ approval_id: grannQ, timmar: 8 });
    expect(r2.status, JSON.stringify(r2.body)).toBe(404);
    korda.add('K8');
  });

  it('K9 felaktiga indata ger 400 validation_error, och ingenting skrivs', async () => {
    const { approvalId: a } = await fragaUtanTimmar(x, iltX, 'ryms', '2B');
    const fore = await tillstand(x.id, a);
    const kroppar: Array<Record<string, unknown>> = [
      ...[0, -1, 8.001, 1_000_000, '8', null].map((timmar) => ({ approval_id: a, timmar })),
      { approval_id: a },
      { approval_id: a, timmar: 8, extra: 'x' },
      { approval_id: 'x', timmar: 8 },
    ];
    for (const kropp of kroppar) {
      const r = await act(x, 'komplettera_beslutsforslag', kropp);
      expect(r.status, `${JSON.stringify(kropp)} ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, JSON.stringify(kropp)).toBe('validation_error');
      expect(await tillstand(x.id, a), JSON.stringify(kropp)).toEqual(fore);
    }
    korda.add('K9');
  });

  it('K10 en upptagen kod ger 409 avtalsdel_upptagen för ett tillägg men inte för ”ryms”', async () => {
    const k = await nyttBolag('Komplettering K10');
    const iltK = await iltUppdrag(k);
    // (a) en annan baselineändring väntar på 2B.
    const { approvalId: a } = await fragaUtanTimmar(k, iltK, 'tillagg', '2B');
    await koa(k, 'andra_baseline', { contract_id: iltK.contractId, code: '2B', name: 'Del 2B', valid_from: '2027-01-01', change_reason: orsak });
    const foreA = await tillstand(k.id, a);
    const ra = await komplettera(k, a, 8);
    expect(ra.status, JSON.stringify(ra.body)).toBe(409); expect(ra.body.error).toBe('avtalsdel_upptagen');
    expect(await tillstand(k.id, a)).toEqual(foreA);
    expect((await kopostRad(a)).status).toBe('pending');
    // (b) en version av 2A börjar senare än den gällande.
    const { approvalId: a2 } = await fragaUtanTimmar(k, iltK, 'tillagg', '2A');
    await godkann(k, await koa(k, 'upsert_contract_part', { contract_id: iltK.contractId, code: '2A', name: 'Del 2A',
      valid_from: await omDagar(30), change_reason: orsak }));
    const foreA2 = await tillstand(k.id, a2);
    const rb = await komplettera(k, a2, 8);
    expect(rb.status, JSON.stringify(rb.body)).toBe(409); expect(rb.body.error).toBe('avtalsdel_upptagen');
    expect(await tillstand(k.id, a2)).toEqual(foreA2);
    // (c) ”ryms” prövar inte versionen.
    const { approvalId: a3 } = await fragaUtanTimmar(k, iltK, 'ryms', '2B');
    const rc = await komplettera(k, a3, 8);
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    korda.add('K10');
  });

  it('K11 ett stängt uppdrag ger 409 uppdraget_stangt, och ingenting skrivs', async () => {
    const k = await nyttBolag('Komplettering K11');
    const iltK = await iltUppdrag(k);
    const { approvalId: a } = await fragaUtanTimmar(k, iltK, 'ryms', '2A');
    await ok(k, 'set_project_status', { project_id: iltK.projektId, status: 'closed' });
    const fore = await tillstand(k.id, a);
    const r = await komplettera(k, a, 8);
    expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('uppdraget_stangt');
    expect(await tillstand(k.id, a)).toEqual(fore);
    korda.add('K11');
  });

  it('K12 en kedja av ersättningar visar bara den sista', async () => {
    const k = await nyttBolag('Komplettering K12');
    const iltK = await iltUppdrag(k);
    const { anteckningId, approvalId: a } = await fragaUtanTimmar(k, iltK, 'ryms', '2A');
    const r1 = await komplettera(k, a, 8); expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const bb = r1.body.result.ersatt_av as string;
    const r2 = await komplettera(k, bb, 9); expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const cc = r2.body.result.ersatt_av as string;
    expect(await koposterForKalla(k.id, anteckningId)).toEqual([
      { id: a, action: 'registrera_uppdragsbeslut', status: 'rejected', ersatt_av: bb },
      { id: bb, action: 'registrera_uppdragsbeslut', status: 'rejected', ersatt_av: cc },
      { id: cc, action: 'registrera_uppdragsbeslut', status: 'pending', ersatt_av: null },
    ]);
    const poster = await posterForKalla(k, anteckningId);
    expect(poster.map((p) => p.id)).toEqual([cc]);
    expect(poster[0]!.ovrigt.underlag.varde.timmar).toBe(9);
    korda.add('K12');
  });

  it('K13 svepet efter en komplettering köar inget och räknar raden täckt', async () => {
    const s = await svepa(b, {});
    expect((s.ovrigt?.koade ?? []).map((k: { anteckning_id: string }) => k.anteckning_id)).not.toContain(rad);
    expect(s.tackning.find((r: { contract_id: string; kalla: string }) => r.contract_id === ilt.contractId && r.kalla === 'ovrigt'))
      .toMatchObject({ lage: 'last', saknas: [] });
    expect(s.mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    const igen = await svepa(b, { ovrigt_forslag: [forslag(rad)] });
    expect(igen.ovrigt.redan_koade).toEqual([rad]); expect(igen.ovrigt.koade).toEqual([]);
    expect(await koposterForKalla(b.id, rad)).toHaveLength(2);
    korda.add('K13');
  });

  it('K14 läsvägen har exakt en post för källan, ersättaren', async () => {
    expect((await posterForKalla(b, rad)).map((p) => p.id)).toEqual([B]);
    const u = await act(b, 'las_undantag', {});
    expect((u.body.result.poster as Array<{ id: string }>).map((p) => p.id)).not.toContain(A);
    expect((u.body.result.hoppade as Array<{ id: string }>).map((h) => h.id)).not.toContain(A);
    korda.add('K14');
  });

  it('K15 Läget och Att göra visar aldrig ersättningen som beslut', async () => {
    const l = await act(b, 'las_uppdragslage', { project_id: ilt.projektId });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    const koposterL = (l.body.result.koposter as Array<{ id: string }>).map((q) => q.id);
    expect(koposterL).toContain(B); expect(koposterL).not.toContain(A);
    expect((l.body.result.beslut.mottagna as Array<{ approval_id: string }>).map((m) => m.approval_id)).not.toContain(A);
    const registrerade = (l.body.result.beslut.registrerade as Array<{ approval_id: string }>).map((m) => m.approval_id);
    expect(registrerade).not.toContain(A); expect(registrerade).not.toContain(B);
    const sida = await b.ua.get(`/app/c/${b.id}/projects/${ilt.projektId}/laget`);
    expect(sida.status).toBe(200);
    expect(sida.text).not.toContain(`id="beslut-${A}"`);
    const kvitto = await withTenantTransaction(b.user.userId, b.id, (c) => listRecentDecisions(c, b.id));
    expect(kvitto.map((q) => q.id)).not.toContain(A);
    korda.add('K15');
  });

  it('K16 REST:s köposter bär ersatt_av', async () => {
    const r = await api.get(`/api/companies/${b.id}/approvals`).set(b.auth);
    expect(r.status).toBe(200);
    const alla = r.body.approvals as Array<Record<string, unknown>>;
    expect(alla.find((q) => q.id === A)).toMatchObject({ ersatt_av: B });
    expect(alla.find((q) => q.id === B)).toMatchObject({ ersatt_av: null });
    korda.add('K16');
  });

  it('K17 definitionen: write med kravManniska, två fält och ingen ”inte nu”', async () => {
    const a = getAction('komplettera_beslutsforslag');
    expect(a).toBeDefined();
    expect(a!.sensitivity).toBe('write'); expect(a!.kravManniska).toBe(true);
    expect(a!.tvafas).toBeFalsy(); expect(a!.vidAvslag).toBeUndefined();
    const post = actionManifest().find((m) => m.name === 'komplettera_beslutsforslag');
    expect(post).toBeDefined();
    expect(post!.requires_approval).toBe(false);
    expect(Object.keys(post!.input_schema.properties as Record<string, unknown>).sort()).toEqual(['approval_id', 'timmar']);
    expect(post!.input_schema.additionalProperties).toBe(false);
    expect((MANDATATGARDER as readonly string[]).includes('komplettera_beslutsforslag')).toBe(false);
    expect(actionManifest().filter((m) => m.name.includes('inte_nu'))).toEqual([]);
    const sida = await b.ua.get(`/app/c/${b.id}/uppdrag`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(`id="post-${B}"`);
    expect(sida.text).not.toMatch(/<button[^>]*>\s*Inte nu\s*</i);
    korda.add('K17');
  });

  it('kontrollvakt: alla sjutton fall kördes', () => expect([...korda].sort()).toEqual(
    ['K1', 'K10', 'K11', 'K12', 'K13', 'K14', 'K15', 'K16', 'K17', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9']));
});

describe('S samtidiga försök avgörs av låset', () => {
  const korda = new Set<string>();
  let b: Bolag;
  let ilt: Ilt;
  beforeAll(async () => {
    b = await nyttBolag('Komplettering S');
    ilt = await iltUppdrag(b);
  });
  /** Exakt ett svar i 2xx och ett 409 not_pending; ger om den första vann. */
  const ettVinner = (svar: Array<{ status: number; body: any }>): boolean => {
    const vunna = svar.filter((r) => r.status >= 200 && r.status < 300);
    const forlorade = svar.filter((r) => r.status === 409);
    expect(vunna, JSON.stringify(svar.map((r) => [r.status, r.body]))).toHaveLength(1);
    expect(forlorade).toHaveLength(1); expect(forlorade[0]!.body.error).toBe('not_pending');
    return vunna[0] === svar[0];
  };
  const inget = async (anteckningId: string, a: string) => {
    const r = await ersattning(a);
    if (r.ersatt_av !== null) { expect(r.beslut_hash).toBeNull(); expect(r.decided_by).toBeNull(); }
    const rader = await beslutForKalla(b.id, anteckningId);
    // Story 1.16: kompletteringen ger aldrig ett utkast; bara Davids eget mottagna nej på a gör det.
    for (const rad of rader) if (!(rad.utfall === 'nej' && rad.approval_id === a)) expect(rad.utkast).toBeNull();
    return rader;
  };

  it('S1 två kompletteringar av samma post', async () => {
    for (let runda = 0; runda < 3; runda++) {
      const { anteckningId, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
      const svar = await Promise.all([komplettera(b, a, 8), komplettera(b, a, 9)]);
      expect(svar.map((r) => r.status).sort()).toEqual([200, 409]);
      ettVinner(svar);
      const vinnare = svar.find((r) => r.status === 200)!;
      expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(2);
      expect((await ersattning(a)).ersatt_av).toBe(vinnare.body.result.ersatt_av);
      expect(await inget(anteckningId, a)).toEqual([]);
    }
    korda.add('S1');
  });

  it('S2 en komplettering och ett ja', async () => {
    for (let runda = 0; runda < 3; runda++) {
      const { anteckningId, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
      const svar = await Promise.all([komplettera(b, a, 8), rest(b, `approvals/${a}/approve`)]);
      const kompletteringVann = ettVinner(svar);
      const rader = await inget(anteckningId, a);
      if (kompletteringVann) {
        expect(rader).toEqual([]);
        expect((await ersattning(a)).beslut_hash).toBeNull();
        expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(2);
      } else {
        expect((await ersattning(a)).status).toBe('executed');
        expect(rader).toHaveLength(1); expect(rader[0]).toMatchObject({ approval_id: a, utfall: 'ja' });
        expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(1);
      }
      expect(rader.filter((r) => r.utfall === 'nej')).toEqual([]);
    }
    korda.add('S2');
  });

  it('S3 en komplettering och ett nej med skäl', async () => {
    for (let runda = 0; runda < 3; runda++) {
      const { anteckningId, approvalId: a } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
      const svar = await Promise.all([komplettera(b, a, 8), act(b, 'avboj_beslutsforslag', { approval_id: a, skal: 'Prov' })]);
      const kompletteringVann = ettVinner(svar);
      const rader = await inget(anteckningId, a);
      const r = await ersattning(a);
      if (kompletteringVann) {
        expect(rader.filter((x) => x.utfall === 'nej')).toEqual([]);
        expect(r.beslut_hash).toBeNull();
      } else {
        expect(r.beslut_hash).toMatch(/^[a-f0-9]{64}$/); expect(r.beslut_skal).toBe('Prov'); expect(r.ersatt_av).toBeNull();
        expect(rader).toHaveLength(1); expect(rader[0]).toMatchObject({ approval_id: a, utfall: 'nej' });
        expect(rader[0]!.utkast).not.toBeNull(); expect(rader[0]!.utkast_markor).toMatch(/^\[ref U\d+-B\d+\]$/);
        expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(1);
      }
    }
    korda.add('S3');
  });

  it('kontrollvakt: alla tre förlopp kördes', () => expect([...korda].sort()).toEqual(['S1', 'S2', 'S3']));
});

describe('T ändrat sedan förslaget', () => {
  const korda = new Set<string>();
  // T6 och T7 använder T2:s och T4:s bolag.
  const t2: { b?: Bolag; ilt?: Ilt; R?: string } = {};
  const t4: { b?: Bolag; ilt?: Ilt; T?: string } = {};
  const nyttIlt = async (namn: string, forbrukning = true) => {
    const b = await nyttBolag(namn); const ilt = await iltUppdrag(b);
    if (forbrukning) await forbruka(b, ilt, '2A', 600);
    return { b, ilt };
  };
  const koaR = async (b: Bolag, ilt: Ilt) => (await ovrigtFraga(b, ilt)).approvalId;
  const koaT = async (b: Bolag, ilt: Ilt) => (await ovrigtFraga(b, ilt, { alternativ: 'tillagg', avtalsdel_kod: '2B' })).approvalId;
  /** Postens `ovrigt.andrat` och svarets lästid, med människans nyckel som standard. */
  const andrat = async (b: Bolag, id: string, headers = b.auth): Promise<{ andrat: Record<string, any>; last_nar: string }> => {
    const u = await act(b, 'las_undantag', {}, headers);
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    const p = (u.body.result.poster as Array<Record<string, any>>).find((x) => x.id === id);
    expect(p, `posten ${id}`).toBeDefined();
    return { andrat: p!.ovrigt.andrat, last_nar: u.body.result.last_nar as string };
  };
  const andringar = async (b: Bolag, id: string) => (await andrat(b, id)).andrat.varde.andringar;
  const nyVersion = async (b: Bolag, ilt: Ilt, falt: Record<string, unknown>) =>
    godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, change_reason: orsak, ...falt }));

  it('T1 inget har ändrats', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T1');
    const R = await koaR(b, ilt);
    const { andrat: v, last_nar } = await andrat(b, R);
    expect(v).toEqual({ varde: { delen_finns: true, upptagen: false, andringar: [] }, kalla: 'redovisning', last_nar, lage: 'last' });
    korda.add('T1');
  });

  it('T2 en ny taxa visas med båda värdena', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T2');
    const R = await koaR(b, ilt);
    await withAdmin((c) => c.query('UPDATE contracts SET hourly_rate_ore=120000 WHERE company_id=$1 AND id=$2', [b.id, ilt.contractId]));
    expect(await andringar(b, R)).toEqual([
      { falt: 'taxa_ore', forslag: 100000, nu: 120000 }, { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
    ]);
    Object.assign(t2, { b, ilt, R });
    korda.add('T2');
  });

  it('T3 mer förbrukning visas med båda värdena', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T3');
    const R = await koaR(b, ilt);
    await forbruka(b, ilt, '2A', 60);
    expect(await andringar(b, R)).toEqual([
      { falt: 'forbrukade_minuter', forslag: 600, nu: 660 }, { falt: 'kvar_fore_minuter', forslag: 1320, nu: 1260 },
      { falt: 'kvar_efter_minuter', forslag: 840, nu: 780 },
    ]);
    korda.add('T3');
  });

  it('T4 en ny version av 2B med högre tak visas för tillägget', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T4');
    const T = await koaT(b, ilt);
    await nyVersion(b, ilt, { code: '2B', name: 'Del 2B', valid_from: '2026-10-01', cap_hours: 14, cap_confirmed: true });
    expect(await andringar(b, T)).toEqual([
      { falt: 'tak_minuter', forslag: 720, nu: 840 }, { falt: 'nytt_tak_minuter', forslag: 1200, nu: 1320 },
      { falt: 'kvar_fore_minuter', forslag: 720, nu: 840 }, { falt: 'kvar_efter_minuter', forslag: 720, nu: 840 },
    ]);
    Object.assign(t4, { b, ilt, T });
    korda.add('T4');
  });

  it('T5 en inaktiv del ger delen_finns falskt', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T5');
    const R = await koaR(b, ilt);
    await nyVersion(b, ilt, { code: '2A', name: 'Del 2A', valid_from: '2026-10-02', active: false });
    expect((await andrat(b, R)).andrat.varde).toEqual({ delen_finns: false, upptagen: false, andringar: [] });
    korda.add('T5');
  });

  it('T7 samma ändring i REST som människa, som agent och direkt', async () => {
    const { b, R } = t2 as Required<typeof t2>;
    const utanTid = (v: Record<string, any>) => ({ ...v, last_nar: null });
    const manniska = (await andrat(b, R)).andrat;
    const agent = (await andrat(b, R, b.agent)).andrat;
    const direkt = (await withTenantTransaction(b.user.userId, b.id, (c) => lasUndantag(c, b.id))).poster.find((p) => p.id === R)!.ovrigt!.andrat!;
    expect(utanTid(manniska)).toEqual({ varde: { delen_finns: true, upptagen: false, andringar: [
      { falt: 'taxa_ore', forslag: 100000, nu: 120000 }, { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
    ] }, kalla: 'redovisning', last_nar: null, lage: 'last' });
    expect(utanTid(agent)).toEqual(utanTid(manniska));
    expect(utanTid(direkt as unknown as Record<string, any>)).toEqual(utanTid(manniska));
    korda.add('T7');
  });

  it('T6 ja godkänner alltid det lagrade förslaget', async () => {
    const { b, R } = t2 as Required<typeof t2>;
    await godkann(b, R);
    const rad = (await beslutsraderFor(R))[0]!;
    expect(rad.underlag.indata.beslutsunderlag).toMatchObject({ taxa_ore: 100000, belopp_ore: 800000 });
    const f = t4 as Required<typeof t4>;
    const inT = await kopostInput(f.T);
    await godkann(f.b, f.T);
    const versioner = await delversioner(f.b.id, f.ilt.contractId, '2B');
    expect(versioner.find((v) => v.valid_from === inT.valid_from)).toMatchObject({ cap_hours: '20.00' });
    korda.add('T6');
  });

  it('T8 en beräkning som inte går att göra är oläst, och läsvägen svarar ändå', async () => {
    const { b, ilt } = await nyttIlt('Komplettering T8', false);
    const R = await koaR(b, ilt);
    await withAdmin((c) => c.query('UPDATE contracts SET hourly_rate_ore=$3 WHERE company_id=$1 AND id=$2', [b.id, ilt.contractId, Number.MAX_SAFE_INTEGER]));
    const { andrat: v, last_nar } = await andrat(b, R);
    expect(v).toEqual({ varde: null, kalla: 'redovisning', last_nar, lage: 'olast' });
    korda.add('T8');
  });

  it('T9 en upptagen kod prövas med samma funktion som kompletteringen', async () => {
    // (a) utan annan baselineändring: postens egen köpost gör inte koden upptagen.
    const a = await nyttIlt('Komplettering T9 a');
    const Ta = await koaT(a.b, a.ilt); const Ra = await koaR(a.b, a.ilt);
    expect((await andrat(a.b, Ta)).andrat.varde.upptagen).toBe(false);
    expect((await andrat(a.b, Ra)).andrat.varde.upptagen).toBe(false);
    // (b) en annan baselineändring för 2B väntar.
    const bb = await nyttIlt('Komplettering T9 b');
    const Tb = await koaT(bb.b, bb.ilt); const Rb = await koaR(bb.b, bb.ilt);
    await koa(bb.b, 'andra_baseline', { contract_id: bb.ilt.contractId, code: '2B', name: 'Del 2B', valid_from: '2027-01-01', change_reason: orsak });
    expect((await andrat(bb.b, Tb)).andrat.varde.upptagen).toBe(true);
    expect((await andrat(bb.b, Rb)).andrat.varde.upptagen).toBe(false);
    const rb = await komplettera(bb.b, Tb, 8);
    expect(rb.status, JSON.stringify(rb.body)).toBe(409); expect(rb.body.error).toBe('avtalsdel_upptagen');
    // (c) en version av 2B börjar senare än den gällande.
    const c = await nyttIlt('Komplettering T9 c');
    const Tc = await koaT(c.b, c.ilt); await koaR(c.b, c.ilt);
    await nyVersion(c.b, c.ilt, { code: '2B', name: 'Del 2B', valid_from: await omDagar(30) });
    expect((await andrat(c.b, Tc)).andrat.varde.upptagen).toBe(true);
    const rc = await komplettera(c.b, Tc, 8);
    expect(rc.status, JSON.stringify(rc.body)).toBe(409); expect(rc.body.error).toBe('avtalsdel_upptagen');
    korda.add('T9');
  });

  it('kontrollvakt: alla nio fall kördes', () => expect([...korda].sort()).toEqual(
    ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']));
});
