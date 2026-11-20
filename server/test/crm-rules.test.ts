// Story 1.2: formulärets rena tolkning får bara skicka ändrade fält, aldrig gissa om ogiltiga värden.
import { describe, expect, it } from 'vitest';
import { correctedEventFields, dateToTimestamp, correctedOrganizationFields, parseOpenForm, statusAfterLink, linkStatusOutcome, mergeStatusOutcome, isProjectCode, correctedCustomerFields, parseEditTarget } from '../src/lib/crmRules.js';

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
    phone: '08-123', fore_phone: '08-123', address: 'Gatan 1', fore_address: 'Gatan 1',
    postal_code: '111 15', fore_postal_code: '111 15', city: 'Stockholm', fore_city: 'Stockholm',
    vat_number: 'SE556915001501', fore_vat_number: 'SE556915001501', payment_terms: '30', fore_payment_terms: '30',
  };
  const EMAIL_ERROR = 'Fakturamejlet är ingen giltig e-postadress. Inget sparades.';
  const TERMS_ERROR = 'Betalningsvillkoret anges i hela dagar från 0 till 365. Inget sparades.';
  it('FK1 bara ändrade fält skickas, trimmade', () => {
    expect(correctedCustomerFields(F)).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields({ ...F, address: '  Nya gatan 1  ' })).toEqual({ ok: true, fields: { address: 'Nya gatan 1' } });
    for (const address of ['   ', ' Gatan 1 ']) {
      expect(correctedCustomerFields({ ...F, address })).toEqual({ ok: true, fields: {} });
    }
  });
  it('FK2 bara egna tillåtna nycklar läses', () => {
    expect(correctedCustomerFields({ ...F, name: 'X', org_number: '1', customer_id: 'x', customer_number: '7',
      is_active: 'false', organization_id: 'x', fore_name: 'y' })).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields(Object.create({ address: 'Ärvt' }))).toEqual({ ok: true, fields: {} });
    for (const body of [null, undefined, 'text', 42, []]) expect(correctedCustomerFields(body)).toEqual({ ok: true, fields: {} });
    const inheritedBefore = Object.assign(Object.create({ fore_address: 'Gatan 1' }), { address: 'Gatan 1' });
    expect(correctedCustomerFields(inheritedBefore)).toEqual({ ok: true, fields: { address: 'Gatan 1' } });
  });
  it('FK3 fakturamejlet normaliseras och bara ändrat mejl valideras', () => {
    expect(correctedCustomerFields({ ...F, email: '  Ny@Kund.Example ' })).toEqual({ ok: true, fields: { email: 'ny@kund.example' } });
    for (const email of ['inte-en-adress', 'a@', '@kund.example']) {
      expect(correctedCustomerFields({ ...F, email })).toEqual({ ok: false, error: EMAIL_ERROR });
    }
    expect(correctedCustomerFields({ ...F, email: 'fel', fore_email: 'fel', address: 'Ny gatan' }))
      .toEqual({ ok: true, fields: { address: 'Ny gatan' } });
  });
  it('FK4 betalningsvillkoret blir ett heltal 0–365; första felet vinner', () => {
    for (const [text, number] of [['45', 45], ['0', 0], ['365', 365]] as const) {
      expect(correctedCustomerFields({ ...F, payment_terms: text })).toEqual({ ok: true, fields: { payment_terms: number } });
    }
    for (const payment_terms of ['366', '-1', 'abc', '30.5', '1e2', '3 0', ['30', '45']]) {
      expect(correctedCustomerFields({ ...F, payment_terms })).toEqual({ ok: false, error: TERMS_ERROR });
    }
    expect(correctedCustomerFields({ ...F, payment_terms: '30' })).toEqual({ ok: true, fields: {} });
    expect(correctedCustomerFields({ ...F, email: 'fel', payment_terms: 'fel' })).toEqual({ ok: false, error: EMAIL_ERROR });
  });
  it('FK5 negativ kontroll: utan fore-fält skickas alla sju i ordning', () => {
    const body = { email: 'faktura@kund.example', phone: '08-123', address: 'Gatan 1', postal_code: '111 15',
      city: 'Stockholm', vat_number: 'SE556915001501', payment_terms: '30' };
    const result = correctedCustomerFields(body);
    expect(result).toEqual({ ok: true, fields: { ...body, payment_terms: 30 } });
    if (result.ok) expect(Object.keys(result.fields)).toEqual(['email', 'phone', 'address', 'postal_code', 'city', 'vat_number', 'payment_terms']);
  });
  it('FK6 andra typer i textfält lämnas åt åtgärdens schema', () => {
    expect(correctedCustomerFields({ ...F, address: ['a', 'b'] })).toEqual({ ok: true, fields: { address: ['a', 'b'] } });
    expect(correctedCustomerFields({ ...F, email: ['a', 'b'] })).toEqual({ ok: true, fields: { email: ['a', 'b'] } });
  });
  it('GV1 bara känt grenval godtas, även bland prototypnycklar', () => {
    expect(parseEditTarget(undefined)).toBe('organisation');
    expect(parseEditTarget('kundkort')).toBe('kundkort');
    for (const value of ['', 'KUNDKORT', 'kundkort ', ' kundkort', 'constructor', '__proto__', 'toString',
      'hasOwnProperty', null, 42, ['kundkort'], { kundkort: 'kundkort' }]) expect(parseEditTarget(value)).toBeNull();
  });
});
