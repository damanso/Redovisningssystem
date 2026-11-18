// Privat och företag i samma CRM, steg 2: ytan (Davids beställning 9/11).
//
//   Y  kundkortets relationsdel visar inga privata personer (granskningens fynd, A3)
//   B  märket Privat/Företag på varje åtagande, på Min sida och i åtagandelistan,
//      och filtret Alla/Företag/Privat på båda
//   C  Davids fel 18/11: den valda filterknappen är ifylld och bär aria-current,
//      för status och för sfär, och länkarna behåller det andra filtret
//   D  kundkortets Inaktivera/Aktivera: byter is_active, skriver auditlogg, och
//      rör inte bokförda fakturor eller rapporter
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rad = Record<string, any>;

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body);
async function ok(p: PromiseLike<{ status: number; body: Rad }>): Promise<any> {
  const res = await p;
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
const approve = (id: string) => api.post(`/api/companies/${companyId}/approvals/${id}/approve`).set(auth()).send({});

/** HTML-escapade länkar tillbaka till det webbläsaren följer. */
const avkoda = (s: string) => s.replace(/&amp;/g, '&');

/**
 * Knapparna i en knapprad på Åtaganden: etikett → ifylld, aria-current och länk.
 * null = knappen finns inte.
 */
function knappar(text: string, etiketter: string[]): Record<string, { ifylld: boolean; aktuell: boolean; href: string } | null> {
  return Object.fromEntries(etiketter.map((e) => {
    const m = new RegExp(`<a class="btn (btn--primary|btn--ghost) btn--sm" href="([^"]*)"( aria-current="page")?>${e}</a>`).exec(text);
    return [e, m ? { ifylld: m[1] === 'btn--primary', aktuell: Boolean(m[3]), href: avkoda(m[2]!) } : null];
  }));
}

/** Samma sak för Min sidas filterrader (.on är den ifyllda stilen där). */
function minFilter(text: string, etiketter: string[]): Record<string, { ifylld: boolean; aktuell: boolean; href: string } | null> {
  return Object.fromEntries(etiketter.map((e) => {
    const m = new RegExp(`<a href="([^"]*)" class="(on)?"( aria-current="page")?>${e}</a>`).exec(text);
    return [e, m ? { ifylld: m[2] === 'on', aktuell: Boolean(m[3]), href: avkoda(m[1]!) } : null];
  }));
}

/** Exakt en vald, och den är både ifylld och aria-current; ingen annan är någotdera. */
function baraVald(rad: Record<string, { ifylld: boolean; aktuell: boolean } | null>, vald: string): void {
  for (const [etikett, k] of Object.entries(rad)) {
    expect(k, `knappen ${etikett} finns`).not.toBeNull();
    expect({ etikett, ifylld: k!.ifylld, aktuell: k!.aktuell })
      .toEqual({ etikett, ifylld: etikett === vald, aktuell: etikett === vald });
  }
}

/** Raden i åtagandelistan som bär texten. Layouten lägger roller på tabellens taggar. */
function radFor(text: string, body: string): string {
  const rad = text.split(/<tr\b/).find((r) => r.includes(body));
  expect(rad, `raden för ${body}`).toBeDefined();
  return rad!.split('</tr>')[0]!;
}

/** Kortet på Min sida för ett åtagande. */
function kortFor(text: string, id: string): string {
  const start = text.indexOf(`id="k-${id.slice(0, 8)}"`);
  expect(start, `kortet för ${id}`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('</article>', start));
}

let privatOrg: string;
let foretagOrg: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  user = await registerUser('sfaryta');
  companyId = await createCompany(user.token, 'Locollabs AB');
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });

  foretagOrg = (await ok(act('upsert_crm_organization', { name: 'Nordic Vision Retail AB' }))).id;
  privatOrg = (await ok(act('upsert_crm_organization', { name: 'Svealands Elbolag AB', sfar: 'privat', roll: 'leverantor' }))).id;
  for (const [nyckel, org, body, due] of [
    ['foretag', foretagOrg, 'Skicka offerten till NVR', '2026-11-20'],
    ['privat', privatOrg, 'Byte av elavtal', '2026-11-19'],
    ['avtal', privatOrg, 'Avtalskopior från Svealand', '2026-11-25'],
  ] as const) {
    ids[nyckel] = (await ok(act('record_crm_commitment', {
      organization_id: org, direction: 'we_owe', body, due_date: due,
      occurred_at: '2026-11-10T09:00:00Z', source_system: 'manual',
    }))).id;
  }
  // Ett klart och ett avskrivet, så att alla tre statusvalen har något att visa.
  for (const [nyckel, status] of [['klar', 'done'], ['avskriven', 'dropped']] as const) {
    ids[nyckel] = (await ok(act('record_crm_commitment', {
      organization_id: privatOrg, direction: 'we_owe', body: `Privat och ${nyckel}`,
      occurred_at: '2026-11-10T09:00:00Z', source_system: 'manual',
    }))).id;
    await ok(act('set_crm_commitment_status', { commitment_id: ids[nyckel], status }));
  }
});

// ---------------------------------------------------------------------------
// Y: kundkortet
// ---------------------------------------------------------------------------

describe('Y kundkortets relationsdel visar inga privata personer', () => {
  it('Y1 företagspersonen syns, den privata personen på samma organisation gör det inte, och räknas inte', async () => {
    const kund = await ok(act('create_customer', { name: 'Kundkortet AB' }));
    const org = (await ok(act('upsert_crm_organization', { name: 'Kundkortet AB', customer_id: kund.id }))).id;
    await ok(act('upsert_crm_person', { name: 'Fia Företagskontakt', organization_id: org }));
    const privat = (await ok(act('upsert_crm_person', { name: 'Pelle Privatperson', organization_id: org, sfar: 'privat' }))).id;
    // Den privata personens kontakt ska inte bli kundens "senaste kontakt".
    await ok(act('log_contact', { person_id: privat, summary: 'Privat samtal', occurred_at: '2026-11-17T12:00:00Z' }));

    const res = await ua.get(`/app/c/${companyId}/customers/${kund.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fia Företagskontakt');
    expect(res.text).not.toContain('Pelle Privatperson');
    expect(res.text).toMatch(/<h2>Kontaktpersoner<\/h2><span class="muted" style="font-size:12.5px">1 st<\/span>/);
    expect(res.text).not.toContain('Senaste kontakt');
    // Kontrollen: relationskortet (CRM-sidan) visar henne, märkt med sin sfär.
    const kort = await ok(act('get_crm_organization', { organization_id: org }));
    expect(kort.people.map((p: Rad) => [p.name, p.sfar]).sort())
      .toEqual([['Fia Företagskontakt', 'foretag'], ['Pelle Privatperson', 'privat']]);
  });
});

// ---------------------------------------------------------------------------
// B och C: åtagandelistan
// ---------------------------------------------------------------------------

describe('B och C åtagandelistan: märket, sfärfiltret och den ifyllda knappen', () => {
  const lista = (qs: string) => ua.get(`/app/c/${companyId}/commitments${qs}`);
  const STATUS = ['Öppna', 'Klara', 'Avskrivna'];
  const SFAR = ['Alla', 'Företag', 'Privat'];

  it('B1 varje åtagande bär märket Privat eller Företag', async () => {
    const res = await lista('?status=open');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<th[^>]*>Sfär<\/th>/);
    expect(radFor(res.text, 'Skicka offerten till NVR')).toContain('<span class="chip chip--muted">Företag</span>');
    expect(radFor(res.text, 'Byte av elavtal')).toContain('<span class="chip chip--muted">Privat</span>');
    expect(radFor(res.text, 'Avtalskopior från Svealand')).toContain('<span class="chip chip--muted">Privat</span>');
  });

  it('B2 filtret: Privat visar bara privata, Företag bara företag, Alla och utelämnat allt', async () => {
    const texter = async (qs: string) => (await lista(qs)).text;
    const alla = await texter('?status=open&sfar=alla');
    const utan = await texter('?status=open');
    const privat = await texter('?status=open&sfar=privat');
    const foretag = await texter('?status=open&sfar=foretag');
    for (const t of [alla, utan]) {
      for (const b of ['Skicka offerten till NVR', 'Byte av elavtal', 'Avtalskopior från Svealand']) expect(t).toContain(b);
    }
    expect(privat).toContain('Byte av elavtal');
    expect(privat).toContain('Avtalskopior från Svealand');
    expect(privat).not.toContain('Skicka offerten till NVR');
    expect(foretag).toContain('Skicka offerten till NVR');
    expect(foretag).not.toContain('Byte av elavtal');
    // Ett okänt värde är inget fel och inget filter: standardläget.
    const okant = await lista('?status=open&sfar=constructor');
    expect(okant.status).toBe(200);
    expect(okant.text).toContain('Skicka offerten till NVR');
    expect(okant.text).toContain('Byte av elavtal');
  });

  it('C1 Davids fel 18/11: den valda statusknappen är ifylld och bär aria-current, för vart och ett av valen', async () => {
    for (const [qs, vald] of [['', 'Öppna'], ['?status=open', 'Öppna'], ['?status=done', 'Klara'], ['?status=dropped', 'Avskrivna']]) {
      const res = await lista(qs!);
      expect(res.status).toBe(200);
      baraVald(knappar(res.text, STATUS), vald!);
    }
    // Statusvalen visar rätt rader, så att knappen och listan säger samma sak.
    expect((await lista('?status=done')).text).toContain('Privat och klar');
    expect((await lista('?status=dropped')).text).toContain('Privat och avskriven');
  });

  it('C2 samma regel för sfärknapparna, för vart och ett av valen', async () => {
    for (const [qs, vald] of [['?status=open', 'Alla'], ['?status=open&sfar=alla', 'Alla'],
      ['?status=open&sfar=foretag', 'Företag'], ['?status=open&sfar=privat', 'Privat']]) {
      const res = await lista(qs!);
      baraVald(knappar(res.text, SFAR), vald!);
      // Statusraden har fortfarande exakt en vald, oberoende av sfären.
      baraVald(knappar(res.text, STATUS), 'Öppna');
    }
  });

  it('C3 filtren går att kombinera, och varje länk behåller det andra filtret', async () => {
    const res = await lista('?status=done&sfar=privat');
    const status = knappar(res.text, STATUS);
    const sfar = knappar(res.text, SFAR);
    baraVald(status, 'Klara');
    baraVald(sfar, 'Privat');
    expect(status['Öppna']!.href).toBe(`/app/c/${companyId}/commitments?status=open&sfar=privat`);
    expect(status['Avskrivna']!.href).toBe(`/app/c/${companyId}/commitments?status=dropped&sfar=privat`);
    expect(sfar['Företag']!.href).toBe(`/app/c/${companyId}/commitments?status=done&sfar=foretag`);
    expect(sfar['Alla']!.href).toBe(`/app/c/${companyId}/commitments?status=done`);
    expect(res.text).toContain('Privat och klar');
    expect(res.text).not.toContain('Byte av elavtal'); // öppen, inte klar

    // Ett handgrepp på raden leder tillbaka till samma kombination.
    const back = `/app/c/${companyId}/commitments?status=done&sfar=privat`;
    expect(radFor(res.text, 'Privat och klar')).toContain(`name="back" value="${back.replace(/&/g, '&amp;')}"`);
    const ater = await ua.post(`/app/c/${companyId}/commitments/${ids.klar}/reopen`).type('form').send({ back });
    expect(ater.status).toBe(302);
    expect(ater.headers.location).toBe(back);
    await ok(act('set_crm_commitment_status', { commitment_id: ids.klar, status: 'done' }));
  });
});

// ---------------------------------------------------------------------------
// B och C: Min sida
// ---------------------------------------------------------------------------

describe('B och C Min sida: märket på varje kort, sfärfiltret i samma lista', () => {
  const min = (qs: string) => ua.get(`/app/c/${companyId}/min-sida${qs}`);
  const SFAR = ['Alla', 'Företag', 'Privat'];

  it('B3 varje kort bär märket, och privat och företag står i samma lista', async () => {
    const res = await min('');
    expect(res.status).toBe(200);
    expect(kortFor(res.text, ids.foretag!)).toContain('<span class="ms-tagg ms-tagg--sfar">Företag</span>');
    expect(kortFor(res.text, ids.privat!)).toContain('<span class="ms-tagg ms-tagg--sfar">Privat</span>');
    expect(kortFor(res.text, ids.avtal!)).toContain('<span class="ms-tagg ms-tagg--sfar">Privat</span>');
    // En enda sida: båda sfärerna under samma rubrik (Den här veckan).
    expect(res.text.match(/class="ms-grupp">Den här veckan/g)).toHaveLength(1);
  });

  it('B4 filtret gäller samma lista', async () => {
    const privat = (await min('?sfar=privat')).text;
    expect(privat).toContain('Byte av elavtal');
    expect(privat).not.toContain('Skicka offerten till NVR');
    const foretag = (await min('?sfar=foretag')).text;
    expect(foretag).toContain('Skicka offerten till NVR');
    expect(foretag).not.toContain('Byte av elavtal');
    const alla = (await min('?sfar=alla')).text;
    expect(alla).toContain('Byte av elavtal');
    expect(alla).toContain('Skicka offerten till NVR');
  });

  it('C4 det valda sfärvalet är ifyllt och bär aria-current, för vart och ett av valen', async () => {
    for (const [qs, vald] of [['', 'Alla'], ['?sfar=alla', 'Alla'], ['?sfar=foretag', 'Företag'], ['?sfar=privat', 'Privat']]) {
      baraVald(minFilter((await min(qs!)).text, SFAR), vald!);
    }
  });

  it('C5 sfär och organisation kombineras, länkarna behåller det andra filtret, och avbockningen leder tillbaka dit', async () => {
    const res = await min(`?sfar=privat&org=${privatOrg}`);
    const sfar = minFilter(res.text, SFAR);
    baraVald(sfar, 'Privat');
    expect(sfar['Företag']!.href).toBe(`/app/c/${companyId}/min-sida?org=${privatOrg}&sfar=foretag`);
    const org = minFilter(res.text, ['Allt', 'Svealands Elbolag AB']);
    baraVald(org, 'Svealands Elbolag AB');
    expect(org['Allt']!.href).toBe(`/app/c/${companyId}/min-sida?sfar=privat`);
    // Bara organisationer med något i den valda sfären står i raden.
    expect(minFilter(res.text, ['Nordic Vision Retail AB'])['Nordic Vision Retail AB']).toBeNull();

    const back = `/app/c/${companyId}/min-sida?org=${privatOrg}&sfar=privat`;
    expect(kortFor(res.text, ids.privat!)).toContain(`name="back" value="${back.replace(/&/g, '&amp;')}"`);
    const bock = await ua.post(`/app/c/${companyId}/commitments/${ids.privat}/done`).type('form').send({ back });
    expect(bock.status).toBe(302);
    expect(bock.headers.location).toBe(back);
    await ok(act('set_crm_commitment_status', { commitment_id: ids.privat, status: 'open' }));
  });
});

// ---------------------------------------------------------------------------
// D: kundkortets Inaktivera/Aktivera
// ---------------------------------------------------------------------------

describe('D kundkortet: Inaktivera och Aktivera', () => {
  let kundId: string;
  let fakturaId: string;
  const kundRad = async () => (await withAdmin((admin) => admin.query<{ is_active: boolean }>(
    'SELECT is_active FROM customers WHERE id = $1', [kundId]))).rows[0]!.is_active;
  const auditrader = async () => (await withAdmin((admin) => admin.query<{ action: string; user_id: string; details: Rad }>(
    `SELECT action, user_id, details FROM audit_log
     WHERE company_id = $1 AND entity_type = 'customer' AND entity_id = $2 ORDER BY id`, [companyId, kundId]))).rows;
  /** Det bokföringen säger om kunden: fakturan, reskontran, momsen, listan med inaktiva. */
  const bokforingen = async () => ({
    faktura: await ok(act('get_invoice', { invoice_id: fakturaId })),
    fakturor: await ok(act('list_invoices', {})),
    reskontra: await ok(act('accounts_receivable_aging', { as_of: '2026-11-18' })),
    moms: await ok(act('vat_report', { from: '2026-11-01', to: '2026-11-30' })),
  });

  beforeAll(async () => {
    await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    kundId = (await ok(act('create_customer', { name: 'Inaktiveringen AB' }))).id;
    const faktura = await ok(act('create_invoice', {
      customer_id: kundId, invoice_date: '2026-11-02', due_date: '2026-12-02',
      lines: [{ description: 'Konsultation', quantity: 2, unit: 'h', unit_price_ore: 120_000, vat_rate: 25 }],
    }));
    fakturaId = faktura.id;
    const bok = await act('book_invoice', { invoice_id: fakturaId });
    expect(bok.status, JSON.stringify(bok.body)).toBe(202);
    expect((await approve(bok.body.approval.id)).status).toBe(200);
  });

  it('D1 knappen byter is_active åt båda hållen och skriver auditlogg i samma action som AI:t använder', async () => {
    const kort = await ua.get(`/app/c/${companyId}/customers/${kundId}`);
    expect(kort.status).toBe(200);
    expect(kort.text).toContain(`action="/app/c/${companyId}/customers/${kundId}/aktiv"`);
    expect(kort.text).toContain('<input type="hidden" name="is_active" value="false">');
    expect(kort.text).toContain('Inaktivera kund');
    const fore = await auditrader();

    const av = await ua.post(`/app/c/${companyId}/customers/${kundId}/aktiv`).type('form').send({ is_active: 'false' });
    expect(av.status).toBe(302);
    expect(av.headers.location).toBe(`/app/c/${companyId}/customers/${kundId}`);
    expect(await kundRad()).toBe(false);
    const efterAv = await auditrader();
    expect(efterAv.slice(fore.length)).toEqual([
      { action: 'customer.updated', user_id: user.userId, details: { fields: ['is_active'] } },
    ]);

    const inaktivt = await ua.get(`/app/c/${companyId}/customers/${kundId}`);
    expect(inaktivt.text).toContain('<input type="hidden" name="is_active" value="true">');
    expect(inaktivt.text).toContain('Aktivera kund');
    expect(inaktivt.text).toContain('Inaktiv');

    const pa = await ua.post(`/app/c/${companyId}/customers/${kundId}/aktiv`).type('form').send({ is_active: 'true' });
    expect(pa.status).toBe(302);
    expect(await kundRad()).toBe(true);
    expect((await auditrader()).slice(efterAv.length)).toEqual([
      { action: 'customer.updated', user_id: user.userId, details: { fields: ['is_active'] } },
    ]);
  });

  it('D2 en inaktiv kund rör inte den bokförda fakturan eller rapporterna — den försvinner bara ur standardlistan', async () => {
    const fore = await bokforingen();
    expect(fore.faktura.voucher_id, 'fakturan är bokförd').not.toBeNull();
    expect((await ok(act('list_customers', {}))).map((k: Rad) => k.id)).toContain(kundId);

    await ua.post(`/app/c/${companyId}/customers/${kundId}/aktiv`).type('form').send({ is_active: 'false' });
    expect(await kundRad()).toBe(false);
    expect(await bokforingen()).toEqual(fore);
    expect((await ok(act('list_customers', {}))).map((k: Rad) => k.id)).not.toContain(kundId);
    expect((await ok(act('list_customers', { include_inactive: true }))).map((k: Rad) => k.id)).toContain(kundId);

    await ua.post(`/app/c/${companyId}/customers/${kundId}/aktiv`).type('form').send({ is_active: 'true' });
    expect(await kundRad()).toBe(true);
  });

  it('D3 kan inte nås utifrån: annat ursprung, ingen session, en annan användare eller ett okänt värde ändrar ingenting', async () => {
    const fore = await auditrader();
    const vag = `/app/c/${companyId}/customers/${kundId}/aktiv`;

    const csrf = await ua.post(vag).set('Origin', 'https://angripare.example').type('form').send({ is_active: 'false' });
    expect(csrf.status).toBe(403);

    const utanSession = await supertest(app).post(vag).type('form').send({ is_active: 'false' });
    expect(utanSession.status).not.toBe(200);
    expect(utanSession.headers.location ?? '').not.toBe(`/app/c/${companyId}/customers/${kundId}`);

    const annan = await registerUser('sfaryta-annan');
    const annanUa = supertest.agent(app);
    await annanUa.post('/app/login').type('form').send({ email: annan.email, password: PASSWORD });
    const frammande = await annanUa.post(vag).type('form').send({ is_active: 'false' });
    expect([403, 404]).toContain(frammande.status);

    const fel = await ua.post(vag).type('form').send({ is_active: 'kanske' });
    expect(fel.status).toBe(302);
    expect(fel.headers.location).toBe(`/app/c/${companyId}/customers/${kundId}?fel=1`);
    expect((await ua.get(fel.headers.location as string)).text).toContain('class="notice"');

    expect(await kundRad()).toBe(true);
    expect(await auditrader()).toEqual(fore);
  });
});
