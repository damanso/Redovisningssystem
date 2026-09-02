// Kategoribilagan: sida 2 utan datumkolumn.
//
// Fakturan till ILT för augusti 2026 skulle visa VAD arbetet gällde — "Fas 2A —
// Commercial Cockpit, OKRs Tool, Customer Support" — inte vilken dag det
// utfördes. Den formen fanns inte. 'time' kräver ett datum per rad, så bilagan
// fick fakturadatumet upprepat på varje rad: ett datum som inte betydde något
// men såg ut som en uppgift. Och eftersom en rad bara fick bära ANTINGEN minuter
// ELLER ören kunde tidsraderna inte visa sitt belopp.
//
// Varianten är avsiktligt smal — datumlösa rader tillåts BARA för 'category'.
// 'time' och 'expense' är specifikationer per datum; där ska ett saknat datum
// fortsätta vara ett fel. Provet mäter båda halvorna av den gränsen, för en
// ändring som bara gjorde entry_date valfritt överallt hade sett likadan ut
// härifrån och tyst tagit bort en riktig kontroll.
//
// Det här provet går mot REGISTRET och behöver ingen databas (samma form som
// bankgiro-validering.test.ts). Reglerna som beror på fakturans sort —
// "kategori får inte ha datum", "tid måste ha datum" — bor i
// setInvoiceAppendix() och prövas i det databasdrivna provet.
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';

function action(namn: string) {
  const a = ACTIONS.find((x) => x.name === namn);
  if (!a) throw new Error(`action saknas i registret: ${namn}`);
  return a;
}

const INVOICE_ID = '0f03137a-1ea1-498b-bb04-616483759522';
const bas = { invoice_id: INVOICE_ID, title: 'Bilaga – specifikation' };

describe('set_invoice_appendix tar emot kategoribilagor', () => {
  it("kind 'category' accepteras", () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas,
      kind: 'category',
      rows: [{ description: 'Fas 2A – Strategiska AI-projekt', minutes: 1690, amount_ore: 3098333 }],
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('en kategorirad får bära både timmar och belopp', () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas,
      kind: 'category',
      rows: [{ description: 'Fas 1A – Ambassadörsprogram', minutes: 420, amount_ore: 770000 }],
    });
    expect(r.success).toBe(true);
    // Schemat får inte tyst kasta bort något av värdena.
    if (r.success) {
      const rad = (r.data as { rows: { minutes?: number; amount_ore?: number }[] }).rows[0]!;
      expect(rad.minutes).toBe(420);
      expect(rad.amount_ore).toBe(770000);
    }
  });

  it('entry_date får utelämnas', () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas,
      kind: 'category',
      rows: [{ description: 'Möten med Customer Support', minutes: 120 }],
    });
    expect(r.success).toBe(true);
  });

  // Negativa kontroller: utan dem kunde proven ovan vara gröna av fel skäl —
  // ett schema som släpper igenom allt hade klarat dem alla.
  it('okänd bilagesort avvisas fortfarande', () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas,
      kind: 'sammanfattning',
      rows: [{ description: 'x', minutes: 60 }],
    });
    expect(r.success).toBe(false);
  });

  it('ogiltigt datum avvisas fortfarande när det ANGES', () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas,
      kind: 'time',
      rows: [{ entry_date: '31 augusti', description: 'x', minutes: 60 }],
    });
    expect(r.success).toBe(false);
  });

  it('minuter måste vara ett positivt heltal', () => {
    const halvminut = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas, kind: 'category', rows: [{ description: 'x', minutes: 12.5 }],
    });
    const noll = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas, kind: 'category', rows: [{ description: 'x', minutes: 0 }],
    });
    expect(halvminut.success, 'flyttal ska avvisas — tid lagras i hela minuter').toBe(false);
    expect(noll.success, 'noll minuter är ingen rad').toBe(false);
  });

  it('okända fält på raden avvisas (strict)', () => {
    const r = action('set_invoice_appendix').inputSchema.safeParse({
      ...bas, kind: 'category', rows: [{ description: 'x', minutes: 60, timmar: 1 }],
    });
    expect(r.success).toBe(false);
  });
});
