// AC 5/FR-40: samma rena beteendeprov körs i Vitest och utan databas när
// sandlådan nekar anslutningen. Inga tabeller eller skrivvägar mockas.
import assert from 'node:assert/strict';
import { beskrivBaselineandring } from '../src/services/uppdragUndantag.js';
import { arRenBekraftelse } from '../src/services/contracts.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';

const tid = '2026-10-07T12:00:00.000Z';
const uppdrag = { project_id: 'p', number: 1, name: 'Uppdrag', contract_id: 'c', contract_name: 'Avtal' };
export function beskrivProv(input: Record<string, unknown>, action = 'andra_baseline', extra: object = {}) {
  return beskrivBaselineandring({ uppdrag, kopost: {
    id: 'q', action, input: { contract_id: 'c', code: 'L1', valid_from: '2026-10-01', change_reason: 'Kunden ändrar omfattningen', ...input },
    requested_actor: 'agent', created_at: new Date(tid),
  }, ...extra }, '/app/c/bolag', tid);
}

/** Alla precisioner och båda intervallgränserna är läsbara och särskiljbara. */
export function provaLasbaraFalt() {
  for (const [precision, etikett] of [['ar', 'år'], ['halvar', 'halvår'], ['kvartal', 'kvartal'], ['manad', 'månad'], ['dag', 'dag']]) {
    assert.ok(beskrivProv({ date_precision: precision }).forslag.varde?.till.includes(`precision: ${etikett}`));
  }
  for (const input of [{ start_date: '2026-09-01' }, { end_date: '2026-12-31' }]) {
    const till = beskrivProv(input).forslag.varde!.till;
    assert.ok(till.includes(Object.hasOwn(input, 'start_date') ? 'start: 2026-09-01' : 'slut: 2026-12-31'));
    assert.ok(!till.includes('datum saknas'), 'utelämnat fält är ingen ändring till saknat datum');
  }
  const fore = { cap_hours: 0, cap_amount_ore: 0, hourly_rate_ore: 0, cap_confirmed: false };
  for (const [falt, varde] of Object.entries({ cap_hours: 1, cap_amount_ore: 100, hourly_rate_ore: 100, cap_confirmed: true })) {
    assert.notDeepEqual(beskrivProv(fore).forslag, beskrivProv({ ...fore, [falt]: varde }).forslag);
  }
}

// Varje skalärt verksamhetsfält har flera värden, även noll och false.
// Vitest jämför nycklarna med det verkliga actions-schemat: nya fält kan
// aldrig smyga in utan ett prov av beslutsunderlaget.
export const DELFALTPROV: Readonly<Record<string, readonly unknown[]>> = {
  name: ['Leverans A', 'Leverans B'], description: ['Omfattning A', 'Omfattning B'],
  billable: [true, false], active: [true, false], sort_order: [0, 2],
  cap_hours: [0, 12], cap_amount_ore: [0, 100], hourly_rate_ore: [0, 240000],
  cap_confirmed: [false, true], start_date: ['2026-09-01', '2026-09-02'],
  end_date: ['2026-12-30', '2026-12-31'], date_precision: ['ar', 'halvar', 'kvartal', 'manad', 'dag'],
};
export const AVTALSFALTPROV: Readonly<Record<string, readonly unknown[]>> = {
  name: ['Avtal A', 'Avtal B'], signed_date: ['2026-09-01', '2026-09-02'],
  payment_terms_days: [0, 30], notes: ['Villkor A', 'Villkor B'],
};
/** Ett nytt tillåtet fält kräver uttryckligt prov av sitt beslutsvärde. */
export function provaScheman() {
  const avtal = ACTIONS.find((a) => a.name === 'update_contract')!;
  const avtalsschema = actionManifest().find((a) => a.name === 'update_contract')!.input_schema;
  assert.deepEqual(Object.keys(avtalsschema.properties as object).filter((k) => !avtal.kraverNyVersion?.includes(k)).sort(), [
    ...Object.keys(AVTALSFALTPROV), 'contract_id', 'customer_id', 'source_file_id',
  ].sort());
  const grund = { contract_id: '11111111-1111-1111-1111-111111111111', code: 'NY', name: 'Ny avtalsdel', valid_from: '2026-10-01', change_reason: 'Kunden bad om mer underlag' };
  for (const [falt, varden] of Object.entries(AVTALSFALTPROV)) for (const varde of varden) {
    assert.ok(avtal.inputSchema.safeParse({ contract_id: grund.contract_id, [falt]: varde }).success);
  }
  for (const name of ['andra_baseline', 'upsert_contract_part']) {
    const schema = actionManifest().find((a) => a.name === name)!.input_schema;
    assert.deepEqual(Object.keys(schema.properties as object).sort(), [
      ...Object.keys(DELFALTPROV), 'contract_id', 'code', 'parent_part_id', 'valid_from', 'change_reason',
      ...(name === 'andra_baseline' ? ['signal_id'] : []),
    ].sort());
    const action = ACTIONS.find((a) => a.name === name)!;
    for (const [falt, varden] of Object.entries(DELFALTPROV)) for (const varde of varden) {
      assert.ok(action.inputSchema.safeParse({ ...grund, [falt]: varde }).success);
    }
  }
}
export function provaAllaDelfalt() {
  for (const [falt, varden] of Object.entries(AVTALSFALTPROV)) {
    const svar = varden.map((v) => beskrivProv({ [falt]: v }, 'update_contract').forslag.varde!.till);
    assert.equal(new Set(svar).size, varden.length, `update_contract: ${falt} måste särskilja alla verksamhetsvärden`);
  }
  for (const action of ['andra_baseline', 'upsert_contract_part']) {
    for (const [falt, varden] of Object.entries(DELFALTPROV)) {
      const svar = varden.map((v) => beskrivProv({ [falt]: v }, action).forslag.varde!.till);
      assert.equal(new Set(svar).size, varden.length, `${action}: ${falt} måste särskilja alla verksamhetsvärden`);
    }
    const ja = beskrivProv({ billable: true, active: true, description: 'Leverans för fakturering', sort_order: 0 }, action);
    const nej = beskrivProv({ billable: false, active: false, description: 'Avslutad intern del', sort_order: 1 }, action);
    for (const fragment of ['ej debiterbar', 'inaktiv', 'Avslutad intern del', 'ordning: 1']) assert.ok(nej.forslag.varde?.till.includes(fragment));
    assert.notDeepEqual(ja.forslag, nej.forslag);
    assert.ok(!beskrivProv(Object.create({ description: 'ärvt' }), action).forslag.varde?.till.includes('ärvt'));
  }
}

/** Målens identiteter bevaras, även när namn råkar vara lika. */
export function provaMal() {
  const last = <T>(varde: T) => ({ varde, kalla: 'redovisning', last_nar: tid, lage: 'last' });
  for (const [falt, action, varden] of [
    ['customer_id', 'update_contract', [{ id: 'kund-a', customer_number: 1, name: 'Kund A', org_number: null }, { id: 'kund-b', customer_number: 2, name: 'Kund B', org_number: '556123-4567' }]],
    ['source_file_id', 'update_contract', [{ id: 'fil-a', original_name: 'Avtal A.pdf', sha256: 'a'.repeat(64), size_bytes: 10 }, { id: 'fil-b', original_name: 'Avtal B.pdf', sha256: 'b'.repeat(64), size_bytes: 20 }]],
    ['parent_part_id', 'andra_baseline', [{ id: 'del-a', code: 'S1', name: 'Steg A', valid_from: '2026-09-01' }, { id: 'del-b', code: 'S2', name: 'Steg B', valid_from: '2026-09-02' }]],
  ] as const) {
    for (const atgard of falt === 'parent_part_id' ? ['andra_baseline', 'upsert_contract_part'] : [action]) {
      const svar = varden.map((v) => {
        const mal = { [falt]: last(v) };
        const p = beskrivProv({ [falt]: v.id }, atgard, { mal });
        assert.ok(p.forslag.varde?.till.includes(Reflect.get(v, 'name') ?? Reflect.get(v, 'original_name')));
        assert.deepEqual(Object.getOwnPropertyDescriptor(p.forslag.varde, 'mal')?.value, mal);
        return p;
      });
      assert.notDeepEqual(svar[0]!.forslag, svar[1]!.forslag);
      const sammaNamn = varden.map((v) => {
        const identitet = { ...v, name: 'Samma namn', original_name: 'Samma namn.pdf' };
        return beskrivProv({ [falt]: v.id }, atgard, { mal: { [falt]: last(identitet) } });
      });
      assert.notDeepEqual(sammaNamn[0]!.forslag, sammaNamn[1]!.forslag, 'identiteten skiljer även likadant namngivna mål åt');
      const saknat = { [falt]: { varde: null, kalla: 'redovisning', last_nar: tid, lage: 'saknas' } };
      const p = beskrivProv({ [falt]: 'okänt-id' }, atgard, { mal: saknat });
      assert.ok(p.forslag.varde?.till.includes('saknas i underlaget'));
      assert.deepEqual(Object.getOwnPropertyDescriptor(p.forslag.varde, 'mal')?.value, saknat);
      assert.ok(!JSON.stringify(p.forslag).includes('okänt-id'));
    }
  }
}

/** Läsningen måste välja samma verkan som skrivvägens slutna fältlista. */
export function provaVerkan() {
  const ren = { contract_id: 'c', code: 'L1', valid_from: '2026-10-01', cap_confirmed: true, change_reason: undefined };
  const prov: Record<string, unknown>[] = [ren, { ...ren, valid_from: undefined }];
  for (const [falt, varden] of Object.entries({ ...DELFALTPROV, parent_part_id: ['p'], change_reason: ['Kunden begär tillägg'], signal_id: ['s'] })) {
    for (const varde of varden) prov.push({ ...ren, [falt]: varde });
    prov.push({ ...ren, [falt]: undefined });
  }
  for (const input of prov) for (const action of ['upsert_contract_part', 'andra_baseline']) {
    const p = beskrivProv(input, action);
    if (action === 'upsert_contract_part' && arRenBekraftelse(input)) {
      assert.ok(p.ja_registrerar.includes('befintlig version'), `ren takbekräftelse: ${JSON.stringify(input)}`);
      assert.ok(!p.ja_registrerar.includes('En ny version'));
    } else {
      assert.ok(p.ja_registrerar.includes('En ny version'), `versionsskapande: ${JSON.stringify(input)}`);
      assert.ok(!p.ja_registrerar.includes('befintlig version'));
    }
  }
}

/** Effektivt datum är läst från avtalet, aldrig gissat ur kötid eller klocka. */
export function provaDatum() {
  for (const action of ['upsert_contract_part', 'andra_baseline']) {
    for (const cap_confirmed of [false, true]) {
      for (const datum of ['2026-09-03', '2027-01-12']) {
        const p = beskrivProv({ valid_from: undefined, change_reason: undefined, cap_confirmed }, action, { giltigFran: datum });
        assert.ok(p.forslag.varde?.till.includes(`från ${datum}`));
        assert.ok(p.ja_registrerar.includes(`från ${datum}`));
        assert.ok(!JSON.stringify(p.forslag).includes('datum saknas'));
      }
      for (const datum of ['2026-11-05', '2027-02-16']) {
        const p = beskrivProv({ valid_from: datum, cap_confirmed }, action);
        assert.ok(p.forslag.varde?.till.includes(`från ${datum}`));
        assert.ok(p.ja_registrerar.includes(`från ${datum}`));
      }
      const p = beskrivProv({ valid_from: undefined, cap_confirmed }, action, { giltigFran: null });
      assert.ok(p.ja_registrerar.includes('datum saknas'));
      assert.ok(!p.ja_registrerar.includes(tid.slice(0, 10)));
    }
  }
}
