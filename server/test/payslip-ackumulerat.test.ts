// Story 4.2 (FR-16, FR-18): lönespecens ackumulering kunde visa andra tal än
// payroll_year_summary, eller sakna nettolön, arbetsgivaravgift och
// semesterersättning. Provet går genom åtgärdslagret och HTTP med supertest:
// specen genereras med generate_payslip_pdf, läses tillbaka med get_document,
// och svaret ur payroll_year_summary binds till specens text rad för rad.
// Varje etikett ritas direkt före sitt belopp, så att pdfText ger dem i följd
// och ett belopp inte kan räknas till fel etikett. P1 anropar renderaren
// direkt och är den negativa kontrollen: andra tal och ett annat år hittas inte.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, pdfText, registerUser, type TestUser } from './helpers.js';
import { generatePayslipPdf } from '../src/services/payslipPdf.js';

let user: TestUser;
let bolagA: string;
let anstalldA: string;
let septemberA: string;
let oktoberA: string;
let bolagB: string;
let januariB: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });

/** Kör en åtgärd som människa och asserterar 200 med kroppen i meddelandet. */
async function atgard(bolag: string, namn: string, body: Record<string, unknown>) {
  const res = await api.post(`/api/companies/${bolag}/actions/${namn}`).set(human()).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

/** Genererar specen för ett lönebesked, hämtar den lagrade filen och ger dess text. */
async function specText(bolag: string, lonebesked: string): Promise<string> {
  const gen = await api.post(`/api/companies/${bolag}/actions/generate_payslip_pdf`).set(human())
    .send({ payslip_id: lonebesked });
  expect(gen.status, JSON.stringify(gen.body)).toBe(200);
  const got = await api.post(`/api/companies/${bolag}/actions/get_document`).set(human())
    .send({ document_id: gen.body.result.id, include_content: true });
  expect(got.status, JSON.stringify(got.body)).toBe(200);
  return pdfText(Buffer.from(got.body.result.content_base64, 'base64'));
}

// Facit för A1 och A2 (bolag A: juli, september och oktober 2026). Talen är de
// lagrade värdena ur createPayslip, belagda i payroll-payment.test.ts; texten
// är mallens kr() av talet. Arbetsgivaravgiften är Math.round(brutto × 3142 /
// 10000) per lönebesked, så september ger 1 988 258.
const FACIT = [
  { falt: 'gross_total_ore', etikett: 'Ack. Bruttolön', ore: 5_650_000 + 6_328_000 + 6_150_000, text: '181 280,000' },
  { falt: 'tax_total_ore', etikett: 'Ack. Skatt', ore: 1_294_300 + 1_634_300 + 1_544_300, text: '44 729,000' },
  { falt: 'net_total_ore', etikett: 'Ack. Nettolön', ore: 4_355_700 + 4_693_700 + 4_605_700, text: '136 551,000' },
  { falt: 'employer_contribution_total_ore', etikett: 'Ack. Arbetsgivaravgift', ore: 1_775_230 + 1_988_258 + 1_932_330, text: '56 958,180' },
  { falt: 'vacation_pay_total_ore', etikett: 'Ack. Semesterersättning', ore: 678_000 + 500_000, text: '11 780,000' },
] as const;

// A3: specen för september räknar juli och september, inte oktober.
const A3: readonly [string, string][] = [
  ['Ack. Bruttolön', '119 780,000'],
  ['Ack. Skatt', '29 286,000'],
  ['Ack. Nettolön', '90 494,000'],
  ['Ack. Arbetsgivaravgift', '37 634,880'],
  ['Ack. Semesterersättning', '6 780,000'],
];

// B1: bara 2026-beskedet. Summorna över båda åren får inte finnas.
const B1: readonly [string, string][] = [
  ['Ack. Bruttolön', '56 500,000'],
  ['Ack. Skatt', '12 943,000'],
  ['Ack. Nettolön', '43 557,000'],
  ['Ack. Arbetsgivaravgift', '17 752,300'],
  ['Ack. Semesterersättning', '0,000'],
];
const B1_BADA_AREN = ['96 500,000', '22 943,000', '73 557,000', '30 320,300'];

beforeAll(async () => {
  user = await registerUser('ackumulerat');

  bolagA = await createCompany(user.token, 'Ackumulerat AB');
  const empA = await atgard(bolagA, 'create_employee', { name: 'Anna Ackumulerad', monthly_salary_ore: 5_650_000, tax_rate: 23 });
  anstalldA = empA.id;
  await atgard(bolagA, 'create_payslip', { employee_id: anstalldA, period: '2026-07' });
  septemberA = (await atgard(bolagA, 'create_payslip', { employee_id: anstalldA, period: '2026-09', include_vacation_pay: true })).id;
  oktoberA = (await atgard(bolagA, 'create_payslip', { employee_id: anstalldA, period: '2026-10', vacation_pay_ore: 500_000 })).id;

  // Manuell skatt på 2025-beskedet, så att fallet inte beror på 2025 års tabell.
  bolagB = await createCompany(user.token, 'Årsgräns AB');
  const empB = await atgard(bolagB, 'create_employee', { name: 'Bertil Årsgräns', monthly_salary_ore: 5_650_000, tax_rate: 23 });
  await atgard(bolagB, 'create_payslip', { employee_id: empB.id, period: '2025-12', gross_ore: 4_000_000, tax_ore: 1_000_000 });
  januariB = (await atgard(bolagB, 'create_payslip', { employee_id: empB.id, period: '2026-01' })).id;
});

type Specdata = Parameters<typeof generatePayslipPdf>[0];

/** Ett fullständigt underlag för renderaren, med lönebeskedets egna tal skilda från ackumuleringens. */
function p1Data(accumulated: Specdata['accumulated']): Specdata {
  return {
    company: { name: 'Påhittat Renderare AB', org_number: '556000-0008' },
    employee: { name: 'Petra Prov', personnummer: '800101-0019', employment_type: 'tillsvidare' },
    payslip: {
      period: '2026-07', payment_date: '2026-07-24',
      gross_ore: 5_650_000, vacation_pay_ore: 0, tax_ore: 1_294_300, net_ore: 4_355_700, tax_source: 'table30',
    },
    accumulated,
    createdDate: '2026-10-20',
  };
}

describe('lönespecens block «Ackumulerat {år}» (Story 4.2, FR-16)', () => {
  it('P1 renderaren ritar rubriken och alla fem paren', async () => {
    const forsta = pdfText(await generatePayslipPdf(p1Data({
      year: 2031, gross_ore: 12_345_678, tax_ore: 2_345_600, net_ore: 9_999_999,
      employer_contribution_ore: 3_878_912, vacation_pay_ore: 1_234_500,
    })));
    const forstaParen = [
      'Ack. Bruttolön123 456,780',
      'Ack. Skatt23 456,000',
      'Ack. Nettolön99 999,990',
      'Ack. Arbetsgivaravgift38 789,120',
      'Ack. Semesterersättning12 345,000',
    ];
    expect(forsta).toContain('Ackumulerat 2031');
    for (const par of forstaParen) expect(forsta, par).toContain(par);
    expect(forsta).toContain('Ack. Förmån0,000');

    // Negativ kontroll: 100 öre mer på varje tal och ett annat år.
    const andra = pdfText(await generatePayslipPdf(p1Data({
      year: 2032, gross_ore: 12_345_778, tax_ore: 2_345_700, net_ore: 10_000_099,
      employer_contribution_ore: 3_879_012, vacation_pay_ore: 1_234_600,
    })));
    const andraParen = [
      'Ack. Bruttolön123 457,780',
      'Ack. Skatt23 457,000',
      'Ack. Nettolön100 000,990',
      'Ack. Arbetsgivaravgift38 790,120',
      'Ack. Semesterersättning12 346,000',
    ];
    expect(andra).toContain('Ackumulerat 2032');
    for (const par of andraParen) expect(andra, par).toContain(par);
    for (const par of forstaParen) expect(andra, par).not.toContain(par);
    expect(andra).not.toContain('Ackumulerat 2031');
  });

  it('A1 specen för tredje lönebeskedet bär blocket «Ackumulerat 2026» med alla fem beloppen', async () => {
    const text = await specText(bolagA, oktoberA);
    expect(text).toContain('Ackumulerat 2026');
    for (const rad of FACIT) expect(text, rad.etikett).toContain(`${rad.etikett}${rad.text}`);
  });

  it('A2 payroll_year_summary och specen ger samma fem belopp', async () => {
    const helaBolaget = await atgard(bolagA, 'payroll_year_summary', { year: 2026 });
    const denAnstallda = await atgard(bolagA, 'payroll_year_summary', { year: 2026, employee_id: anstalldA });
    expect(helaBolaget.payslip_count).toBe(3);
    expect(denAnstallda.payslip_count).toBe(3);
    const text = await specText(bolagA, oktoberA);
    for (const rad of FACIT) {
      expect(helaBolaget[rad.falt], rad.falt).toBe(rad.ore);
      expect(denAnstallda[rad.falt], rad.falt).toBe(rad.ore);
      expect(text, rad.etikett).toContain(`${rad.etikett}${rad.text}`);
    }
  });

  it('A3 specen räknar till och med sitt eget lönebesked', async () => {
    const text = await specText(bolagA, septemberA);
    expect(text).toContain('Ackumulerat 2026');
    for (const [etikett, belopp] of A3) expect(text, etikett).toContain(`${etikett}${belopp}`);
    for (const rad of FACIT.filter((r) => r.falt !== 'vacation_pay_total_ore')) {
      expect(text, rad.etikett).not.toContain(rad.text);
    }
  });

  it('B1 fjolårets lönebesked ingår inte', async () => {
    const text = await specText(bolagB, januariB);
    expect(text).toContain('Ackumulerat 2026');
    for (const [etikett, belopp] of B1) expect(text, etikett).toContain(`${etikett}${belopp}`);
    for (const summa of B1_BADA_AREN) expect(text, summa).not.toContain(summa);
    expect(text).not.toContain('Ackumulerat 2025');
  });
});
