// Story 1.2: formulärets rena tolkning får bara skicka ändrade fält, aldrig gissa om ogiltiga värden.
import { describe, expect, it } from 'vitest';
import { correctedEventFields, dateToTimestamp } from '../src/lib/crmRules.js';

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
