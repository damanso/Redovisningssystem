// Story 1.2: formulärets rena tolkning får bara skicka ändrade fält, aldrig gissa om ogiltiga värden.
import { describe, expect, it } from 'vitest';
import { correctedEventFields, dateToTimestamp, correctedOrganizationFields, parseOpenForm, statusAfterLink, linkStatusOutcome, mergeStatusOutcome, isProjectCode, correctedCustomerFields, parseEditTarget, nameTakenOrganization, mergeCandidate } from '../src/lib/crmRules.js';

const now = new Date('2026-10-22T08:00:00Z');
const original = {
  summary: 'Sammanfattning E1.', fore_summary: 'Sammanfattning E1.',
  channel: 'email', fore_channel: 'email', direction: 'inbound', fore_direction: 'inbound',
  occurred_at: '2026-09-07', fore_occurred_at: '2026-09-07',
};
describe('händelseformulärets rättelser', () => {
  it('E1 bara ändrade, ifyllda fält skickas och text trimmas', () => {
    expect(correctedEventFields('interaction', original, now)).toEqual({});
    expect(correctedEventFields('interaction', { ...original, summary: '  Ny sammanfattning E1.  ' }, now))
      .toEqual({ summary: 'Ny sammanfattning E1.' });
    expect(correctedEventFields('interaction', { ...original, summary: '   ', channel: '' }, now)).toEqual({});
  });
  it('E2 kryssrutan tar bort ett datum och ett ogiltigt värde lämnas åt schemat', () => {
    expect(correctedEventFields('commitment', { inget_forfallodatum: 'ja', fore_due_date: '2026-10-31' }, now)).toEqual({ due_date: null });
    expect(correctedEventFields('commitment', { inget_forfallodatum: 'ja', fore_due_date: '' }, now)).toEqual({});
    expect(correctedEventFields('commitment', { body: ['a', 'b'], fore_body: 'Gammal text' }, now)).toEqual({ body: ['a', 'b'] });
    expect(correctedEventFields('commitment', { inget_forfallodatum: 'ja', due_date: '2026-12-01', fore_due_date: '2026-10-31' }, now)).toEqual({ due_date: null });
    expect(correctedEventFields('interaction', { channel: 'ogiltig', direction: ['inbound'], occurred_at: ['2026-09-07'] }, now))
      .toEqual({ channel: 'ogiltig', direction: ['inbound'], occurred_at: ['2026-09-07'] });
  });
  it('E3 datum i dag blir nuet, andra datum blir UTC-middag och ogiltiga datum lämnas oförändrade', () => {
    expect(dateToTimestamp('2026-09-07', now)).toBe('2026-09-07T12:00:00Z');
    expect(dateToTimestamp('2026-10-22', now)).toBe('2026-10-22T08:00:00.000Z');
    expect(correctedEventFields('commitment', { occurred_at: '2026-09-08', fore_occurred_at: '2026-09-07' }, now))
      .toEqual({ occurred_at: '2026-09-08T12:00:00Z' });
    expect(dateToTimestamp('2026-02-30', now)).toBe('2026-02-30');
  });
  it('E4 negativ kontroll: saknade fore-fält skickar allt; prototypvärden skickas aldrig', () => {
    expect(correctedEventFields('interaction', {
      summary: 'Sammanfattning E1.', channel: 'email', direction: 'inbound', occurred_at: '2026-09-07',
    }, now)).toEqual({ summary: 'Sammanfattning E1.', channel: 'email', direction: 'inbound', occurred_at: '2026-09-07T12:00:00Z' });
    expect(correctedEventFields('interaction', Object.create({ summary: 'Ärvt värde' }), now)).toEqual({});
    for (const body of [null, undefined, 'text', 42, []]) expect(correctedEventFields('interaction', body, now)).toEqual({});
  });
});


describe('organisationsformulärets rättelser och adressens formulär (story 1.4)', () => {
  const KUND_A = '00000000-0000-4000-8000-000000000001';
  const KUND_B = '00000000-0000-4000-8000-000000000002';
  const F = {
    name: 'Bolaget AB', fore_name: 'Bolaget AB', org_number: '556914-0009', fore_org_number: '556914-0009',
    website: '', fore_website: '', status: 'prospect', fore_status: 'prospect',
    customer_id: '', fore_customer_id: '', roll: '', fore_roll: '',
  };
  it('R1 bara ändrat namn skickas, trimmat; blankt och oförändrat utelämnas', () => {
    expect(correctedOrganizationFields(F)).toEqual({});
    expect(correctedOrganizationFields({ ...F, name: '  Nytt Namn AB  ' })).toEqual({ name: 'Nytt Namn AB' });
    expect(correctedOrganizationFields({ ...F, name: '   ' })).toEqual({});
    expect(correctedOrganizationFields({ ...F, name: ' Bolaget AB ' })).toEqual({});
  });
  it('R2 tillåtelselistan släpper bara egna formulärfält och ignorerar andra kroppar', () => {
    expect(correctedOrganizationFields({ ...F, status: 'partner', roll: 'kund', website: 'https://ny.example', org_number: '556914-0010' }))
      .toEqual({ status: 'partner', roll: 'kund', website: 'https://ny.example', org_number: '556914-0010' });
    expect(correctedOrganizationFields({ ...F, sfar: 'privat', notes: 'x', source: 'y', organization_id: KUND_B, customer_number: '7', fore_sfar: 'foretag' })).toEqual({});
    expect(correctedOrganizationFields(Object.create({ name: 'Ärvt AB' }))).toEqual({});
    for (const body of [null, undefined, 'text', 42, []]) expect(correctedOrganizationFields(body)).toEqual({});
  });
  it('R3 kundval skickas vid ändring; tomt utelämnas och ogiltiga värden lämnas åt schemat', () => {
    expect(correctedOrganizationFields({ ...F, customer_id: KUND_A })).toEqual({ customer_id: KUND_A });
    expect(correctedOrganizationFields({ ...F, customer_id: KUND_B, fore_customer_id: KUND_A })).toEqual({ customer_id: KUND_B });
    expect(correctedOrganizationFields({ ...F, customer_id: '', fore_customer_id: KUND_A })).toEqual({});
    expect(correctedOrganizationFields({ ...F, customer_id: [KUND_A, KUND_B] })).toEqual({ customer_id: [KUND_A, KUND_B] });
    expect(correctedOrganizationFields({ ...F, status: 'ogiltig' })).toEqual({ status: 'ogiltig' });
  });
  it('R4 negativ kontroll: utan fore-fält skickas alla sex ifyllda fält', () => {
    const alla = { name: 'Bolaget AB', org_number: '556914-0009', website: 'https://b.example', status: 'prospect', customer_id: KUND_A, roll: 'kund' };
    expect(correctedOrganizationFields(alla)).toEqual(alla);
  });
  it('R5 bara uppgifter öppnas; prototypnycklar, okända och andra typer ignoreras', () => {
    expect(parseOpenForm('uppgifter')).toBe('uppgifter');
    for (const value of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'dubblett', '', 'UPPGIFTER', 'uppgifter ', ' uppgifter', undefined, null, 42, ['uppgifter'], { uppgifter: 'uppgifter' }]) {
      expect(parseOpenForm(value)).toBeNull();
    }
  });
});


describe('statusregeln vid kundkoppling (story 1.6)', () => {
  const statusfacit = [
    ['prospect', 'human', 'prospect'],
    ['prospect', 'sync', 'customer'],
    ['prospect', 'ai', 'customer'],
    ['prospect', 'import', 'customer'],
    ['prospect', 'accounting', 'customer'],
    ['prospect', null, 'customer'],
    ['prospect', undefined, 'customer'],
    ['customer', 'human', 'customer'],
    ['customer', 'sync', 'customer'],
    ['customer', 'ai', 'customer'],
    ['customer', 'import', 'customer'],
    ['customer', 'accounting', 'customer'],
    ['customer', null, 'customer'],
    ['customer', undefined, 'customer'],
    ['partner', 'human', 'partner'],
    ['partner', 'sync', 'partner'],
    ['partner', 'ai', 'partner'],
    ['partner', 'import', 'partner'],
    ['partner', 'accounting', 'partner'],
    ['partner', null, 'partner'],
    ['partner', undefined, 'partner'],
    ['former', 'human', 'former'],
    ['former', 'sync', 'former'],
    ['former', 'ai', 'former'],
    ['former', 'import', 'former'],
    ['former', 'accounting', 'former'],
    ['former', null, 'former'],
    ['former', undefined, 'former'],
    ['archived', 'human', 'archived'],
    ['archived', 'sync', 'archived'],
    ['archived', 'ai', 'archived'],
    ['archived', 'import', 'archived'],
    ['archived', 'accounting', 'archived'],
    ['archived', null, 'archived'],
    ['archived', undefined, 'archived'],
  ] as const;
  const linkfacit = [
    ['prospect', 'human', { status: 'prospect', kept: true }],
    ['prospect', 'sync', { status: 'customer', kept: false }],
    ['prospect', null, { status: 'customer', kept: false }],
    ['partner', 'human', { status: 'partner', kept: false }],
    ['partner', 'sync', { status: 'partner', kept: false }],
    ['customer', 'human', { status: 'customer', kept: false }],
  ] as const;
  const K = '00000000-0000-4000-8000-000000000001';
  const mergefacit = [
    [{ status: 'prospect', customer_id: null }, { customer_id: K }, 'human', { linkMoves: true, from: 'prospect', to: 'prospect', kept: true }],
    [{ status: 'prospect', customer_id: null }, { customer_id: K }, 'sync', { linkMoves: true, from: 'prospect', to: 'customer', kept: false }],
    [{ status: 'prospect', customer_id: null }, { customer_id: K }, null, { linkMoves: true, from: 'prospect', to: 'customer', kept: false }],
    [{ status: 'prospect', customer_id: K }, { customer_id: null }, 'sync', { linkMoves: false, from: 'prospect', to: 'prospect', kept: false }],
    [{ status: 'prospect', customer_id: null }, { customer_id: null }, 'sync', { linkMoves: false, from: 'prospect', to: 'prospect', kept: false }],
    [{ status: 'partner', customer_id: null }, { customer_id: K }, 'sync', { linkMoves: true, from: 'partner', to: 'partner', kept: false }],
  ] as const;
  it.each(statusfacit)('S1 %s med ursprung %s ger %s', (status, source, expected) => {
    expect(statusAfterLink(status, source)).toBe(expected);
  });
  it.each(['HUMAN', '', 'manual'])('S2 exakt ursprungsjämförelse: %s', (source) => {
    expect(statusAfterLink('prospect', source)).toBe('customer');
  });
  it.each(linkfacit)('L1 kopplingsutfallet för %s och %s', (status, source, expected) => {
    expect(linkStatusOutcome(status, source)).toEqual(expected);
  });
  it.each(mergefacit)('M1 sammanslagningens utfall %#', (keep, gone, source, expected) => {
    expect(mergeStatusOutcome(keep, gone, source)).toEqual(expected);
  });
});

describe('projektkodsmönstret (story 2.2)', () => {
  const projektkoder = ['NVR-001', 'ILT-123', 'ÅÄÖ-999', '  NVR-001  ', 'AB-000', 'ABCDEF-999'];
  const andraNamn = ['nvr-001', 'NVR-0012', 'NVR001', 'A-001', 'ABCDEFG-001', 'Nordic Vision Retail AB',
    '', 'NVR-001 AB', 'NVR–001', 'NVR-0O1', 'ILT-Education'];
  it.each(projektkoder)('P1 %s är en projektkod efter trimning', (name) => {
    expect(isProjectCode(name)).toBe(true);
  });
  it.each(andraNamn)('P2 %s är inte en projektkod', (name) => {
    expect(isProjectCode(name)).toBe(false);
  });
});

describe('fakturauppgifternas formulär och grenvalet (story 1.5)', () => {
  const F = {
    email: 'faktura@kund.example', fore_email: 'faktura@kund.example',
    phone: '08-123', fore_phone: '08-123', address: 'Kundgatan 1', fore_address: 'Kundgatan 1',
    postal_code: '111 11', fore_postal_code: '111 11', city: 'Stockholm', fore_city: 'Stockholm',
    vat_number: 'SE556915001501', fore_vat_number: 'SE556915001501', payment_terms: '30', fore_payment_terms: '30',
  };
  const EMAIL_ERROR = 'Fakturamejlet är ingen giltig e-postadress. Inget sparades.';
  const TERMS_ERROR = 'Betalningsvillkoret anges i hela dagar från 0 till 365. Inget sparades.';
  it('FK1 bara ändrade, trimmade fält skickas', () => {
    expect(correctedCustomerFields(F)).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields({ ...F, address: '  Nya gatan 1  ' })).toEqual({ ok: true, fields: { address: 'Nya gatan 1' } });
    for (const address of ['   ', ' Kundgatan 1 ']) {
      expect(correctedCustomerFields({ ...F, address })).toEqual({ ok: true, fields: {} });
    }
  });
  it('FK2 tillåtelselistan läser bara egna fält och ignorerar främmande kroppar', () => {
    expect(correctedCustomerFields({ ...F, name: 'x', customer_id: 'x',
      is_active: 'false', organization_id: 'x', fore_name: 'x' })).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields(Object.create({ address: 'Ärvt' }))).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields(Object.assign(Object.create({ fore_address: 'Ny' }), { address: 'Ny' })))
      .toEqual({ ok: true, fields: { address: 'Ny' } });
    for (const body of [null, undefined, 'text', 42, []]) expect(correctedCustomerFields(body)).toEqual({ ok: true, fields: {} });
  });
  it('FK3 fakturamejlet valideras bara vid ändring och normaliseras', () => {
    expect(correctedCustomerFields({ ...F, email: '  Ny@Kund.Example ' })).toEqual({ ok: true, fields: { email: 'ny@kund.example' } });
    for (const email of ['inte-en-adress', 'a@', '@kund.example']) {
      expect(correctedCustomerFields({ ...F, email })).toEqual({ ok: false, error: EMAIL_ERROR });
    }
    expect(correctedCustomerFields({ ...F, email: 'fel', fore_email: 'fel', address: 'Ny' }))
      .toEqual({ ok: true, fields: { address: 'Ny' } });
  });
  it('FK4 betalningsvillkoret måste vara hela dagar 0–365', () => {
    for (const [payment_terms, expected] of [['45', 45], ['0', 0], ['365', 365]] as const) {
      expect(correctedCustomerFields({ ...F, payment_terms })).toEqual({ ok: true, fields: { payment_terms: expected } });
    }
    for (const payment_terms of ['366', '-1', 'abc', '30.5', '1e2', '3 0', ['30', '45']]) {
      expect(correctedCustomerFields({ ...F, payment_terms })).toEqual({ ok: false, error: TERMS_ERROR });
    }
    expect(correctedCustomerFields({ ...F, payment_terms: ['30'], fore_payment_terms: ['30'] }))
      .toEqual({ ok: false, error: TERMS_ERROR });
    expect(correctedCustomerFields(F)).toEqual({ ok: true, fields: {} });
  });
  it('FK5 negativ kontroll utan fore-fält skickar alla sju i ordning', () => {
    const alla = { email: 'faktura@kund.example', phone: '08-123', address: 'Kundgatan 1',
      postal_code: '111 11', city: 'Stockholm', vat_number: 'SE556915001501', payment_terms: '30' };
    const result = correctedCustomerFields(alla);
    expect(result).toEqual({ ok: true, fields: { ...alla, payment_terms: 30 } });
    if (result.ok) expect(Object.keys(result.fields)).toEqual(['email', 'phone', 'address', 'postal_code', 'city', 'vat_number', 'payment_terms']);
  });
  it('FK6 andra typer i textfält lämnas till åtgärdens schema', () => {
    expect(correctedCustomerFields({ ...F, address: ['a', 'b'] })).toEqual({ ok: true, fields: { address: ['a', 'b'] } });
    expect(correctedCustomerFields({ email: ['a', 'b'] })).toEqual({ ok: true, fields: { email: ['a', 'b'] } });
  });
  it('GV1 grenvalet är slutet och avvisar ärvda nycklar och andra typer', () => {
    expect(parseEditTarget(undefined)).toBe('organisation');
    expect(parseEditTarget('kundkort')).toBe('kundkort');
    for (const value of ['', 'KUNDKORT', 'kundkort ', ' kundkort', 'constructor', '__proto__', 'toString',
      'hasOwnProperty', null, 42, ['kundkort'], { kundkort: 'kundkort' }]) expect(parseEditTarget(value)).toBeNull();
  });
});


describe('kundnumret i fakturaformuläret (story 1.7)', () => {
  const K = {
    customer_number: '7', fore_customer_number: '7',
    email: 'faktura@kund.example', fore_email: 'faktura@kund.example',
    phone: '08-123', fore_phone: '08-123', address: 'Kundgatan 1', fore_address: 'Kundgatan 1',
    postal_code: '111 11', fore_postal_code: '111 11', city: 'Stockholm', fore_city: 'Stockholm',
    vat_number: 'SE556915001501', fore_vat_number: 'SE556915001501', payment_terms: '30', fore_payment_terms: '30',
  };
  const NUMBER_ERROR = 'Kundnumret anges som ett heltal från 1. Inget sparades.';
  it('KN1 ändrat nummer blir ett tal och oförändrat utelämnas', () => {
    for (const customer_number of ['1007', ' 1007 ', '2147483645']) {
      expect(correctedCustomerFields({ ...K, customer_number }))
        .toEqual({ ok: true, fields: { customer_number: Number(customer_number) } });
    }
    for (const customer_number of ['007', '7', '', '   ']) {
      expect(correctedCustomerFields({ ...K, customer_number })).toEqual({ ok: true, fields: {} });
    }
    expect(correctedCustomerFields(K)).toEqual({ ok: true, fields: {} });
  });
  it('KN2 ogiltiga nummer ger fast feltext men orörda värden hindrar inte andra rättelser', () => {
    for (const customer_number of ['0', '-1', 'abc', '1.5', '1e3', '12 3', '+5', '2147483646', '99999999999', ['5']]) {
      expect(correctedCustomerFields({ ...K, customer_number })).toEqual({ ok: false, error: NUMBER_ERROR });
    }
    expect(correctedCustomerFields({ ...K, customer_number: ['7'], fore_customer_number: ['7'] }))
      .toEqual({ ok: false, error: NUMBER_ERROR });
    expect(correctedCustomerFields({ ...K, customer_number: '0', fore_customer_number: '0', address: 'Ny adress' }))
      .toEqual({ ok: true, fields: { address: 'Ny adress' } });
  });
  it('KN3 kundnumret står först och negativ kontroll utan före-fält skickar alla åtta', () => {
    const result = correctedCustomerFields({ ...K, customer_number: '1007', address: 'Ny adress' });
    expect(result).toEqual({ ok: true, fields: { customer_number: 1007, address: 'Ny adress' } });
    if (result.ok) expect(Object.keys(result.fields)).toEqual(['customer_number', 'address']);
    expect(correctedCustomerFields({ ...K, customer_number: 'abc', email: 'inte-en-adress' }))
      .toEqual({ ok: false, error: NUMBER_ERROR });
    const alla = { customer_number: '7', email: 'faktura@kund.example', phone: '08-123', address: 'Kundgatan 1',
      postal_code: '111 11', city: 'Stockholm', vat_number: 'SE556915001501', payment_terms: '30' };
    const utanFore = correctedCustomerFields(alla);
    expect(utanFore).toEqual({ ok: true, fields: { ...alla, customer_number: 7, payment_terms: 30 } });
    if (utanFore.ok) expect(Object.keys(utanFore.fields))
      .toEqual(['customer_number', 'email', 'phone', 'address', 'postal_code', 'city', 'vat_number', 'payment_terms']);
  });
});


describe('org.nr i kundkortsformuläret (story 1.8)', () => {
  const G = { org_number: '556918-0001', fore_org_number: '556918-0001', address: 'Kundgatan 1', fore_address: 'Kundgatan 1' };
  it('ON1 ändrat skickas trimmat utan normalisering, tomt och oförändrat utelämnas', () => {
    for (const org_number of ['556918-0002', ' 556918-0002 ']) {
      expect(correctedCustomerFields({ ...G, org_number })).toEqual({ ok: true, fields: { org_number: '556918-0002' } });
    }
    expect(correctedCustomerFields({ ...G, org_number: '5569180002' })).toEqual({ ok: true, fields: { org_number: '5569180002' } });
    for (const org_number of ['556918-0001', ' 556918-0001 ', '', '   ']) {
      expect(correctedCustomerFields({ ...G, org_number })).toEqual({ ok: true, fields: {} });
    }
    expect(correctedCustomerFields(G)).toEqual({ ok: true, fields: {} });
  });
  it('ON2 fälten skickas i tillåtelselistans ordning med negativ kontroll', () => {
    const result = correctedCustomerFields({ ...G, customer_number: '8', fore_customer_number: '7', org_number: '556918-0002', address: 'Ny adress' });
    expect(result).toEqual({ ok: true, fields: { customer_number: 8, org_number: '556918-0002', address: 'Ny adress' } });
    if (result.ok) expect(Object.keys(result.fields)).toEqual(['customer_number', 'org_number', 'address']);
    const alla = { customer_number: '7', org_number: '556918-0001', email: 'faktura@kund.example', phone: '08-123',
      address: 'Kundgatan 1', postal_code: '111 11', city: 'Stockholm', vat_number: 'SE556915001501', payment_terms: '30' };
    const utanFore = correctedCustomerFields(alla);
    expect(utanFore).toEqual({ ok: true, fields: { ...alla, customer_number: 7, payment_terms: 30 } });
    if (utanFore.ok) expect(Object.keys(utanFore.fields)).toEqual(['customer_number', 'org_number', 'email', 'phone', 'address', 'postal_code', 'city', 'vat_number', 'payment_terms']);
  });
  it('ON3 andra typer lämnas till schemat och främmande fält ignoreras', () => {
    expect(correctedCustomerFields({ ...G, org_number: ['556918-0002', '556918-0003'] }))
      .toEqual({ ok: true, fields: { org_number: ['556918-0002', '556918-0003'] } });
    expect(correctedCustomerFields({ org_number: '556918-0002', name: 'x', customer_id: 'x', organization_id: 'x', is_active: 'false' }))
      .toEqual({ ok: true, fields: { org_number: '556918-0002' } });
  });
});

describe('namnkrockens adress (story 2.1)', () => {
  const A = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
  const B = '2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e';
  it('NK1 bara namnkrockens eget giltiga id leder vidare', () => {
    expect(nameTakenOrganization({ code: 'name_taken', details: {
      organization_id: A, merge_action: 'merge_crm_organizations',
    } })).toBe(A);
    expect(nameTakenOrganization({ code: 'name_taken', details: { organization_id: A.toUpperCase() } })).toBe(A);
    const ogiltiga = [
      { code: 'name_taken' },
      { code: 'name_taken', details: null },
      { code: 'name_taken', details: [A] },
      { code: 'name_taken', details: { organization_id: 'inte-ett-id' } },
      { code: 'name_taken', details: { organization_id: 42 } },
      { code: 'name_taken', details: Object.create({ organization_id: A }) },
      { code: 'customer_already_linked', details: { organization_id: A } },
      { code: 'NAME_TAKEN', details: { organization_id: A } },
    ];
    for (const error of ogiltiga) expect(nameTakenOrganization(error)).toBeNull();
  });
  it('NK2 bara de exakta formulärnamnen öppnas', () => {
    expect(parseOpenForm('slaihop')).toBe('slaihop');
    expect(parseOpenForm('uppgifter')).toBe('uppgifter');
    for (const value of ['SLAIHOP', 'slaihop ', 'slå ihop', 'slaIhop', ['slaihop']]) {
      expect(parseOpenForm(value)).toBeNull();
    }
  });
  it('NK3 bara en giltig sträng ur bolagets andra relationer blir kandidat', () => {
    expect(mergeCandidate(A, [A, B])).toBe(A);
    expect(mergeCandidate(A.toUpperCase(), [A, B])).toBe(A);
    expect(mergeCandidate(B, [A, B])).toBe(B);
    expect(mergeCandidate(A, [B])).toBeNull();
    for (const value of ['inte-ett-id', '', undefined, null, 42, [A], { id: A }, ' ' + A,
      '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f']) {
      expect(mergeCandidate(value, [A, B])).toBeNull();
    }
  });
});
