// Story 1.2: formulärets rena tolkning får bara skicka ändrade fält, aldrig gissa om ogiltiga värden.
import { describe, expect, it } from 'vitest';
import { correctedEventFields, dateToTimestamp, correctedOrganizationFields, parseOpenForm, statusAfterLink, linkStatusOutcome, mergeStatusOutcome, isProjectCode, correctedCustomerFields, parseEditTarget, nameTakenOrganization, mergeCandidate, nameVariantOrganization, companyFormSuffix, syncedCommitmentStatus, parseThreadCursor, formatThreadCursor, THREAD_CURSOR_KINDS, parsePersonParam, correctedPersonFields, daysSince } from '../src/lib/crmRules.js';
import { isThreadTime, THREAD_FILTERS } from '../src/services/crmThread.js';

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

describe('bolagsformsvariantens regler (story 2.3)', () => {
  const A = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
  it('BR1 bara variantfelets egna giltiga id och namn leder till ett förslag', () => {
    const facit = { organization_id: A, name: 'Alliance Optikk' };
    expect(nameVariantOrganization({ code: 'name_variant_of', details: facit })).toEqual(facit);
    expect(nameVariantOrganization({ code: 'name_variant_of', details: {
      organization_id: A.toUpperCase(), name: '  Alliance Optikk  ',
    } })).toEqual(facit);
    for (const error of [
      { code: 'name_variant_of' },
      { code: 'name_variant_of', details: null },
      { code: 'name_variant_of', details: [A] },
      { code: 'name_variant_of', details: { organization_id: A } },
      { code: 'name_variant_of', details: { organization_id: A, name: '   ' } },
      { code: 'name_variant_of', details: { organization_id: A, name: 7 } },
      { code: 'name_variant_of', details: { organization_id: 'inte-ett-id', name: 'X' } },
      { code: 'name_variant_of', details: Object.create({ organization_id: A, name: 'X' }) },
      { code: 'name_variant_of', details: Object.assign(Object.create({ name: 'X' }), { organization_id: A }) },
      { code: 'name_taken', details: { organization_id: A, name: 'X' } },
      { code: 'NAME_VARIANT_OF', details: { organization_id: A, name: 'X' } },
      { code: 'name_variant_ambiguous' },
    ]) expect(nameVariantOrganization(error)).toBeNull();
  });
  it('BR2 bolagsformen hämtas ur databasens nyckel med sin egen stavning', () => {
    for (const [name, norm, suffix] of [
      ['Alliance Optikk AS', 'alliance optikk', 'AS'],
      ['  Bolaget   AB (publ) ', 'bolaget', 'AB (publ)'],
      ['Firma A/S', 'firma', 'A/S'], ['Optikko Kivinen Oy', 'optikko kivinen', 'Oy'],
      ['Alliance Optikk', 'alliance optikk', null], ['Alliance OptikkAS', 'alliance optikk', null],
      ['Annat Bolag AB', 'alliance optikk', null], ['', '', null],
    ] as const) expect(companyFormSuffix(name, norm), name).toBe(suffix);
  });
});

describe('löftets status från synken (story 3.3)', () => {
  it('LR1 regelns tabell: bara human och en stängd status utan ursprungsrad står emot synken', () => {
    for (const [nuvarande, ursprung, inkommande, utfall] of [
      ['open', null, undefined, 'omitted'],
      ['done', 'human', undefined, 'omitted'],
      ['open', null, 'done', 'write'],
      ['open', null, 'open', 'write'],
      ['done', null, 'open', 'kept_human'],
      ['dropped', null, 'open', 'kept_human'],
      ['done', null, 'done', 'kept_human'],
      ['done', 'human', 'open', 'kept_human'],
      ['open', 'human', 'done', 'kept_human'],
      ['done', 'sync', 'open', 'write'],
      ['dropped', 'sync', 'open', 'write'],
      ['done', 'ai', 'open', 'write'],
      ['open', 'accounting', 'dropped', 'write'],
      ['done', 'import', 'open', 'write'],
      ['done', undefined, 'open', 'kept_human'],
    ] as const) {
      expect(syncedCommitmentStatus(nuvarande, ursprung, inkommande), `${nuvarande} ${ursprung} ${inkommande}`).toBe(utfall);
    }
  });
  it('LR2 negativ kontroll: utan undantaget hade synken skrivit över de sex stängda paren', () => {
    const statusar = ['open', 'done', 'dropped'] as const;
    const skiljer: [string, string][] = [];
    for (const nuvarande of statusar) {
      for (const inkommande of statusar) {
        const utanRad = syncedCommitmentStatus(nuvarande, null, inkommande);
        const medSync = syncedCommitmentStatus(nuvarande, 'sync', inkommande);
        if (utanRad === medSync) continue;
        skiljer.push([nuvarande, inkommande]);
        expect([utanRad, medSync], `${nuvarande} ${inkommande}`).toEqual(['kept_human', 'write']);
      }
    }
    expect(skiljer).toEqual([['done', 'open'], ['done', 'done'], ['done', 'dropped'], ['dropped', 'open'], ['dropped', 'done'], ['dropped', 'dropped']]);
  });
});

describe('trådens markör (story 4.1)', () => {
  const TID = '2026-01-02T09:00:00.000Z';
  const UUID = '3f2b6c1e-8a4d-4e2f-9b1a-0c5d7e9f1a2b';
  const markor = (tid: string, slag: string, id: string): string => `${tid}|${slag}|${id}`;
  const GILTIG = markor(TID, 'interaction', UUID);

  it('TC1 en giltig markör ger sina tre värden, och uuid:n med versaler ger gemener', () => {
    expect(parseThreadCursor(GILTIG)).toEqual({ at: TID, kind: 'interaction', ref_id: UUID });
    expect(parseThreadCursor(markor(TID, 'interaction', UUID.toUpperCase()))).toEqual({ at: TID, kind: 'interaction', ref_id: UUID });
  });

  it('TC2 markörens slag är exakt trådens slag, och vart och ett godtas', () => {
    const tradensSlag = new Set<string>();
    for (const lista of Object.values(THREAD_FILTERS)) for (const slag of lista ?? []) tradensSlag.add(slag);
    expect([...tradensSlag].sort()).toEqual(Object.keys(THREAD_CURSOR_KINDS).sort());
    for (const slag of tradensSlag) {
      expect(parseThreadCursor(markor(TID, slag, UUID)), slag).toEqual({ at: TID, kind: slag, ref_id: UUID });
    }
  });

  it('TC3 sjutton ogiltiga värden ger null utan att kasta', () => {
    const lang = `${GILTIG}${'0'.repeat(101 - GILTIG.length)}`;
    expect(lang).toHaveLength(101);
    const ogiltiga: Array<[string, unknown]> = [
      ['M1', undefined],
      ['M2', [GILTIG, markor(TID, 'payment', UUID)]],
      ['M3', 1],
      ['M4', { at: TID, kind: 'interaction', ref_id: UUID }],
      ['M5', ''],
      ['M6', markor('2026-02-30T09:00:00.000Z', 'interaction', UUID)],
      ['M7', markor('2026-01-02T09:00:00Z', 'interaction', UUID)],
      ['M8', markor('2026-01-02T09:00:00.000+01:00', 'interaction', UUID)],
      ['M9', markor(TID, 'constructor', UUID)],
      ['M10', markor(TID, 'INTERACTION', UUID)],
      ['M11', `${TID}|interaction`],
      ['M12', `${GILTIG}|interaction`],
      ['M13', lang],
      ['M14', markor(TID, 'interaction', 'inte-en-uuid')],
      ['M15', markor('2026-01-02T09:00:00.000000Z', 'interaction', UUID)],
      ['M16', markor('2026-13-01T09:00:00.000Z', 'interaction', UUID)],
      ['M17', markor('0000-01-01T00:00:00.000Z', 'interaction', UUID)],
    ];
    expect(ogiltiga).toHaveLength(17);
    for (const [namn, varde] of ogiltiga) {
      expect(() => parseThreadCursor(varde), namn).not.toThrow();
      expect(parseThreadCursor(varde), namn).toBeNull();
    }
  });

  it('TC4 rundgång: det formatThreadCursor bygger läser parseThreadCursor, och trasiga rader ger null', () => {
    const somDatum = { at: new Date(TID), kind: 'commitment', ref_id: UUID };
    expect(parseThreadCursor(formatThreadCursor(somDatum))).toEqual({ at: TID, kind: 'commitment', ref_id: UUID });
    const somText = { at: '2026-01-02T09:00:00.123456Z', kind: 'payment', ref_id: UUID };
    expect(parseThreadCursor(formatThreadCursor(somText))).toEqual({ at: '2026-01-02T09:00:00.123Z', kind: 'payment', ref_id: UUID });
    for (const [namn, rad] of [
      ['slaget constructor', { at: new Date(TID), kind: 'constructor', ref_id: UUID }],
      ['ref_id null', { at: new Date(TID), kind: 'interaction', ref_id: null }],
      ['at som ogiltig text', { at: 'inte-en-tid', kind: 'interaction', ref_id: UUID }],
      ['at som ogiltigt Date', { at: new Date('inte-en-tid'), kind: 'interaction', ref_id: UUID }],
    ] as const) {
      expect(() => formatThreadCursor(rad), namn).not.toThrow();
      expect(formatThreadCursor(rad), namn).toBeNull();
    }
  });

  it('TC5 negativ kontroll: prototypens namn finns på ett vanligt objekt men godtas aldrig som slag', () => {
    expect(parseThreadCursor(markor(TID, 'commitment_closed', UUID))).toEqual({ at: TID, kind: 'commitment_closed', ref_id: UUID });
    for (const namn of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(namn in {}, namn).toBe(true);
      expect(parseThreadCursor(markor(TID, namn, UUID)), namn).toBeNull();
    }
  });

  it('TC6 vyns markör och åtgärdens before godtar exakt samma tidpunkter, och bara sådana som Postgres tolkar', () => {
    // Två vägar in, en regel. Listan bär zonerna som Date.parse godtar men Postgres
    // avvisar (22009), datum som inte finns och år som markörens form inte bär.
    const giltiga = [TID, '0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z', '2024-02-29T00:00:00.000Z'];
    const ogiltiga = [
      '2026-01-02T09:00:00.000+16:00', '2026-01-02T09:00:00.000-16:00', '2026-01-02T09:00:00.000+23:59',
      '2026-01-02T09:00:00+1600', '2026-01-02T09:00:00.000+01:00', '2026-01-02T09:00:00Z',
      '2026-01-02T09:00:00.000000Z', '0000-01-01T00:00:00.000Z', '-000001-01-01T00:00:00.000Z',
      '+012026-01-02T09:00:00.000Z', '2026-02-30T09:00:00.000Z', '2025-02-29T09:00:00.000Z',
      '2026-13-01T09:00:00.000Z', '2026-01-02T24:00:00.000Z', '2026-01-02T09:00:60.000Z', '',
    ];
    for (const tid of giltiga) {
      expect(isThreadTime(tid), tid).toBe(true);
      expect(parseThreadCursor(markor(tid, 'interaction', UUID)), tid).toEqual({ at: tid, kind: 'interaction', ref_id: UUID });
    }
    for (const tid of ogiltiga) {
      expect(() => isThreadTime(tid), tid).not.toThrow();
      expect(isThreadTime(tid), tid).toBe(false);
      expect(parseThreadCursor(markor(tid, 'interaction', UUID)), tid).toBeNull();
    }
  });

  it('TC7 en giltig Date utanför åren 1–9999 går inte att skriva som markör', () => {
    // Postgres lagrar år före vår tideräkning och efter 9999; markörens form bär dem
    // inte, så vyn måste klara en äldre rad utan markör (story 4.1, granskningen).
    for (const tid of ['0000-06-01T12:00:00.000Z', '-000001-06-01T12:00:00.000Z', '+012026-01-01T09:00:00.000Z']) {
      const at = new Date(tid);
      expect(Number.isNaN(at.getTime()), tid).toBe(false);
      expect(() => formatThreadCursor({ at, kind: 'interaction', ref_id: UUID }), tid).not.toThrow();
      expect(formatThreadCursor({ at, kind: 'interaction', ref_id: UUID }), tid).toBeNull();
    }
  });
});

describe('personens adress och formulär (story 4.3)', () => {
  const UUID = '3f2b6c1e-8a4d-4e2f-9b1a-0c5d7e9f1a2b';
  const ANDRA = '7a1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
  const VISAT = {
    name: 'Anna Andersson', fore_name: 'Anna Andersson',
    role_title: 'Beställare', fore_role_title: 'Beställare',
    phone: '', fore_phone: '',
  };

  it('PC1 en uuid ger sig själv med gemener; nio andra värden ger null utan att kasta', () => {
    expect(parsePersonParam(UUID)).toBe(UUID);
    expect(parsePersonParam(UUID.toUpperCase())).toBe(UUID);
    const ogiltiga: unknown[] = [undefined, '', 'inte-ett-id', [UUID, ANDRA], 42, { id: UUID }, `${UUID} `, 'constructor', '__proto__'];
    expect(ogiltiga).toHaveLength(9);
    for (const value of ogiltiga) {
      expect(() => parsePersonParam(value), JSON.stringify(value)).not.toThrow();
      expect(parsePersonParam(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('PC2 bara namn, roll och telefon som ändrats mot det visade skickas; tomt är oförändrat', () => {
    // (a) Rollen ändrad, resten som visat.
    expect(correctedPersonFields({ ...VISAT, role_title: 'Inköpschef' })).toEqual({ role_title: 'Inköpschef' });
    // (b) En tom roll mot en ifylld är oförändrad.
    expect(correctedPersonFields({ ...VISAT, role_title: '' })).toEqual({});
    // (c) Ett nytt namn trimmas.
    expect(correctedPersonFields({ ...VISAT, name: '  Anna Berg  ' })).toEqual({ name: 'Anna Berg' });
    // (d) Bara blanktecken runt det visade namnet är ingen ändring.
    expect(correctedPersonFields({ ...VISAT, name: '  Anna Andersson ' })).toEqual({});
    // (e) Telefonen utan visat värde.
    expect(correctedPersonFields({ phone: ' 0701112233 ' })).toEqual({ phone: '0701112233' });
    // (f) En annan typ lämnas åt åtgärdens synliga validering.
    expect(correctedPersonFields({ ...VISAT, role_title: ['Inköpschef', 'Vd'] })).toEqual({ role_title: ['Inköpschef', 'Vd'] });
    // (g) E-post, organisation och personens id tas aldrig med.
    expect(correctedPersonFields({ ...VISAT, email: 'anna@exempel.se', organization_id: UUID, person_id: ANDRA })).toEqual({});
    expect(correctedPersonFields({ email: 'anna@exempel.se', fore_email: '', organization_id: UUID, person_id: ANDRA, role_title: 'Vd' }))
      .toEqual({ role_title: 'Vd' });
    // (h) Ett underlag som inte är ett vanligt objekt.
    for (const underlag of [null, ['role_title', 'Vd'], 'role_title=Vd']) {
      expect(correctedPersonFields(underlag), JSON.stringify(underlag)).toEqual({});
    }
  });

  it('PC3 grenvalet person är slutet som kundkort, och andra stavningar och typer ger null', () => {
    expect(parseEditTarget('person')).toBe('person');
    expect(parseEditTarget('kundkort')).toBe('kundkort');
    for (const value of ['PERSON', 'person ', ' person', 'constructor', ['person']]) {
      expect(parseEditTarget(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('PC4 hela dygn mellan två kalenderdatum, och null för ett datum som inte finns', () => {
    expect(daysSince('2026-02-20', '2026-03-01')).toBe(9);
    expect(daysSince('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysSince('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysSince('2026-03-01', '2026-03-01')).toBe(0);
    for (const [dag, idag] of [['inte-ett-datum', '2026-03-01'], ['2026-02-30', '2026-03-01'], ['2026-03-01', '2026-13-01']] as const) {
      expect(daysSince(dag, idag), `${dag} → ${idag}`).toBeNull();
    }
  });
});
