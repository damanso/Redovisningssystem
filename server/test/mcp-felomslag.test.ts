// Provet för FR-28 och AD-11: ett MCP-anrop som inte kan fullföljas ska ge ett
// fel som namnger adressen och hänvisar till self_check, inom TIMEOUT_MS, vad
// som än går fel på vägen, och ett HTTP-fel med kropp är inget nätverksfel.
// Lagren: den rena formen i karnfel (P), hela anropet i anropaKarnan mot en
// stubbe på riktigt nätverk i testprocessen, med det riktiga nätanropet (F), och
// MCP-servern som barnprocess över stdio mot en stubbkärna, plus källtexten i
// serverns fil, där hamta ska vara den enda vägen ut (E).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TIMEOUT_MS, KarnanNasInte, anropaKarnan, karnfel, type Natanrop } from '../src/mcp/karnanrop.js';

// Filbaserad sökväg, inte cwd: barnprocessen och E0 läser samma källfil.
const SERVERFIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.ts');

const formen = (adress: string, orsak: string) => `Kunde inte nå kärnan på ${adress}: ${orsak} — kör self_check`;

interface Stubbe { bas: string; server: Server; stang: () => Promise<void> }

/** En kärna i testprocessen på 127.0.0.1, port vald av operativsystemet. */
async function stubbe(hanterare: (req: IncomingMessage, res: ServerResponse) => void): Promise<Stubbe> {
  const server = createServer(hanterare);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    bas: `http://127.0.0.1:${port}`,
    server,
    // Utan closeAllConnections väntar close() för evigt på en stubbe som aldrig svarar.
    stang: async () => {
      server.closeAllConnections();
      await new Promise<void>((klar) => server.close(() => klar()));
    },
  };
}

/** Felet som löftet kastar och tiden dit; ett löfte som inte kastar fäller fallet. */
async function fanga(lofte: Promise<unknown>): Promise<{ fel: unknown; ms: number }> {
  const start = performance.now();
  let svar: unknown;
  try {
    svar = await lofte;
  } catch (fel) {
    return { fel, ms: performance.now() - start };
  }
  throw new Error(`väntade ett fel, men anropet gav svaret ${JSON.stringify(svar)}`);
}

/** Det riktiga nätanropet, med en flagga som visar att svarshuvudet kom fram före felet. */
function medHuvudflagga(): { natanrop: Natanrop; huvudetKom: () => boolean } {
  let kom = false;
  return {
    natanrop: async (url, init) => {
      const svar = await fetch(url, init);
      kom = true;
      return svar;
    },
    huvudetKom: () => kom,
  };
}

// Minimal MCP-klient över stdio: nyradsavgränsad JSON-RPC 2.0, av samma slag som i mcp.test.ts.
class McpKlient {
  private buffert = '';
  private vantande = new Map<number, (svar: Record<string, unknown>) => void>();
  private nasta = 0;
  constructor(private barn: ChildProcessWithoutNullStreams) {
    barn.stdout.setEncoding('utf8');
    barn.stdout.on('data', (bit: string) => {
      this.buffert += bit;
      let nl: number;
      while ((nl = this.buffert.indexOf('\n')) !== -1) {
        const rad = this.buffert.slice(0, nl).trim();
        this.buffert = this.buffert.slice(nl + 1);
        if (!rad) continue;
        const svar = JSON.parse(rad) as Record<string, unknown>;
        if (typeof svar.id === 'number' && this.vantande.has(svar.id)) {
          this.vantande.get(svar.id)!(svar);
          this.vantande.delete(svar.id);
        }
      }
    });
  }
  meddela(metod: string): void {
    this.barn.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: metod }) + '\n');
  }
  anropa(metod: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++this.nasta;
    return new Promise((klar, fel) => {
      const timer = setTimeout(() => fel(new Error(`inget svar på ${metod} inom 10 s`)), 10_000);
      this.vantande.set(id, (svar) => { clearTimeout(timer); klar(svar); });
      this.barn.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: metod, params }) + '\n');
    });
  }
}

/** Verktygssvarets text och om det är ett fel; svaret står i meddelandet när det inte har någon text. */
function verktygssvar(svar: Record<string, unknown>): { isError: boolean; text: string } {
  const resultat = svar.result as { isError?: boolean; content?: { type: string; text: string }[] } | undefined;
  const innehall = resultat?.content?.find((c) => c.type === 'text');
  expect(innehall, JSON.stringify(svar)).toBeDefined();
  return { isError: resultat?.isError === true, text: innehall!.text };
}

/** Felet som ett `KarnanNasInte` med rätt adress och orsak, och texten exakt formen av dem. */
function arKarnfel(fel: unknown, adress: string, orsak: string): void {
  expect(fel, String(fel)).toBeInstanceOf(KarnanNasInte);
  if (!(fel instanceof KarnanNasInte)) return;
  expect(fel.adress, fel.message).toBe(adress);
  expect(fel.orsak, fel.message).toBe(orsak);
  expect(fel.message).toBe(formen(adress, orsak));
}

describe('5.6 felets form (karnfel)', () => {
  const ADRESS = 'http://kärnan.test/x';

  it('P0 tidsgränsen i drift är 60 000 ms', () => {
    expect(TIMEOUT_MS).toBe(60_000);
  });

  it('P1 tidsgränsen ger «inget svar inom 60 s» (O1)', () => {
    const fel = karnfel(ADRESS, new DOMException('tiden gick ut', 'TimeoutError'), 60_000);
    arKarnfel(fel, ADRESS, 'inget svar inom 60 s');
    expect(fel.message).toBe('Kunde inte nå kärnan på http://kärnan.test/x: inget svar inom 60 s — kör self_check');
  });

  it('P2 orsakskoden följs av orsakens meddelande (O2)', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    arKarnfel(karnfel(ADRESS, new TypeError('nätanropet föll', { cause }), 60_000), ADRESS, 'ECONNREFUSED (connect ECONNREFUSED)');
  });

  it('P3 orsakskoden skrivs en gång när meddelandet är lika med koden (O2)', () => {
    const cause = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    arKarnfel(karnfel(ADRESS, new TypeError('nätanropet föll', { cause }), 60_000), ADRESS, 'ECONNREFUSED');
  });

  it('P4 ett fel utan orsak ger sitt meddelande (O3)', () => {
    arKarnfel(karnfel(ADRESS, new Error('trasigt svar'), 60_000), ADRESS, 'trasigt svar');
  });

  it('P5 ett värde som inte är ett fel ger sin text (O5)', () => {
    arKarnfel(karnfel(ADRESS, 'boom', 60_000), ADRESS, 'boom');
  });

  it('P6 ett fel utan meddelande ger sitt namn, aldrig en tom orsak (O4)', () => {
    arKarnfel(karnfel(ADRESS, new Error(''), 60_000), ADRESS, 'Error');
  });
});

describe('5.6 hela anropet (anropaKarnan)', () => {
  // Huvudet lovar 64 byte, och bara början av kroppen skickas.
  const HUVUD = { 'Content-Type': 'application/json', 'Content-Length': '64' };
  const BIT = '{"status":';

  it('F1 vägrad anslutning ger formen med ECONNREFUSED, under 5 s', async () => {
    const s = await stubbe(() => {});
    const adress = `${s.bas}/x`;
    await s.stang();
    const { fel, ms } = await fanga(anropaKarnan(fetch, adress, undefined, 10_000));
    expect(fel, String(fel)).toBeInstanceOf(KarnanNasInte);
    if (!(fel instanceof KarnanNasInte)) return;
    expect(fel.adress, fel.message).toBe(adress);
    expect(fel.orsak, fel.message).toContain('ECONNREFUSED');
    expect(fel.message).toBe(formen(adress, fel.orsak));
    expect(ms, fel.message).toBeLessThan(5_000);
  });

  it('F2 en kärna som tar emot och aldrig svarar ger tidsgränsen efter 0.3 s', async () => {
    const s = await stubbe(() => {});
    try {
      const adress = `${s.bas}/x`;
      const { fel, ms } = await fanga(anropaKarnan(fetch, adress, undefined, 300));
      arKarnfel(fel, adress, 'inget svar inom 0.3 s');
      expect(ms, String(fel)).toBeGreaterThanOrEqual(250);
      expect(ms, String(fel)).toBeLessThan(5_300);
    } finally {
      await s.stang();
    }
  });

  it('F3 en kropp som stannar mitt i ger tidsgränsen efter 0.3 s, efter svarshuvudet', async () => {
    const s = await stubbe((_req, res) => {
      res.writeHead(200, HUVUD);
      res.write(BIT);
    });
    try {
      const adress = `${s.bas}/x`;
      const { natanrop, huvudetKom } = medHuvudflagga();
      const { fel, ms } = await fanga(anropaKarnan(natanrop, adress, undefined, 300));
      expect(huvudetKom(), String(fel)).toBe(true);
      arKarnfel(fel, adress, 'inget svar inom 0.3 s');
      expect(ms, String(fel)).toBeGreaterThanOrEqual(250);
      expect(ms, String(fel)).toBeLessThan(5_300);
    } finally {
      await s.stang();
    }
  });

  it('F4 en kropp som bryts mitt i ger formen långt före tidsgränsen, efter svarshuvudet', async () => {
    const s = await stubbe((_req, res) => {
      res.writeHead(200, HUVUD);
      // Förbindelsen bryts först när huvudet och biten har skrivits.
      res.write(BIT, () => res.socket?.destroy());
    });
    try {
      const adress = `${s.bas}/x`;
      const { natanrop, huvudetKom } = medHuvudflagga();
      const { fel, ms } = await fanga(anropaKarnan(natanrop, adress, undefined, 10_000));
      expect(huvudetKom(), String(fel)).toBe(true);
      expect(fel, String(fel)).toBeInstanceOf(KarnanNasInte);
      if (!(fel instanceof KarnanNasInte)) return;
      expect(fel.adress, fel.message).toBe(adress);
      expect(fel.orsak, fel.message).not.toBe('');
      expect(fel.orsak, fel.message).not.toMatch(/^inget svar inom /);
      expect(fel.message).toBe(formen(adress, fel.orsak));
      expect(ms, fel.message).toBeLessThan(5_000);
    } finally {
      await s.stang();
    }
  });

  it('F5 HTTP 400 med felkropp är inget nätverksfel: svaret kommer tillbaka färdigläst', async () => {
    const s = await stubbe((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"validation_error"}');
    });
    try {
      const svar = await anropaKarnan(fetch, `${s.bas}/x`, undefined, 10_000);
      expect(svar).toStrictEqual({ status: 400, ok: false, text: '{"error":"validation_error"}' });
    } finally {
      await s.stang();
    }
  });

  it('F6 HTTP 409 med felkropp är inget nätverksfel: svaret kommer tillbaka färdigläst', async () => {
    const s = await stubbe((_req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end('{"error":"already_booked"}');
    });
    try {
      const svar = await anropaKarnan(fetch, `${s.bas}/x`, undefined, 10_000);
      expect(svar).toStrictEqual({ status: 409, ok: false, text: '{"error":"already_booked"}' });
    } finally {
      await s.stang();
    }
  });
});

describe('5.6 genom MCP-servern', () => {
  const bolag = randomUUID();
  const MANIFEST = {
    actions: [{ name: 'create_receipt', title: 'Skapa kvitto', sensitivity: 'write', requires_approval: false, input_schema: { type: 'object' } }],
  };
  let lage: '400' | '409' = '400';
  let karna: Stubbe;
  let barn: ChildProcessWithoutNullStreams;
  let mcp: McpKlient;

  beforeAll(async () => {
    karna = await stubbe((req, res) => {
      // Connection: close på varje svar, så att ingen förbindelse ligger kvar
      // när stubben stängs i E1 och felet blir den vägrade anslutningen.
      // Begäran läses till slut först, så att stängningen inte bryter den.
      req.resume();
      req.on('end', () => {
        const svara = (status: number, kropp: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify(kropp));
        };
        if (req.method === 'GET' && req.url === `/api/companies/${bolag}/actions`) return svara(200, MANIFEST);
        if (req.method === 'POST' && req.url === `/api/companies/${bolag}/actions/create_receipt`) {
          return lage === '400' ? svara(400, { error: 'validation_error' }) : svara(409, { error: 'already_booked' });
        }
        svara(404, { error: 'not_found' });
      });
    });

    barn = spawn(process.execPath, ['--import', 'tsx', SERVERFIL], {
      cwd: process.cwd(),
      env: { ...process.env, REDOVISNING_API_URL: karna.bas, REDOVISNING_AGENT_TOKEN: 'a.b.c', REDOVISNING_COMPANY_ID: bolag },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    const stderr: string[] = [];
    barn.stderr.setEncoding('utf8');
    barn.stderr.on('data', (d: string) => stderr.push(d));
    barn.on('exit', (kod) => { if (kod) console.error(`MCP-servern avslutades (${kod}): ${stderr.join('')}`); });
    mcp = new McpKlient(barn);
    await mcp.anropa('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    mcp.meddela('notifications/initialized');
  });

  afterAll(async () => {
    barn?.kill();
    if (karna?.server.listening) await karna.stang();
  });

  it('E0 källtexten: hamta är den enda vägen ut, och filen läser ingen kropp och har ingen egen tidsgräns', async () => {
    const kalla = await readFile(SERVERFIL, 'utf8');
    const rader = kalla.split('\n');
    const antal = (kalla.match(/\bfetch\b/g) ?? []).length;
    const traffar = rader.filter((r) => /\bfetch\b/.test(r)).map((r) => r.trim());
    expect(antal, `ordet fetch står ${antal} gånger: ${JSON.stringify(traffar)}`).toBe(1);
    expect(traffar, JSON.stringify(traffar)).toEqual(['return anropaKarnan(fetch, url, init);']);
    const lasningar = rader.filter((r) => r.includes('.text()')).map((r) => r.trim());
    expect(lasningar, `${lasningar.length} läsningar av kroppen: ${JSON.stringify(lasningar)}`).toEqual([]);
    const konstanter = rader.filter((r) => /\bconst TIMEOUT_MS\b/.test(r)).map((r) => r.trim());
    expect(konstanter, `${konstanter.length} egna tidsgränser: ${JSON.stringify(konstanter)}`).toEqual([]);
    expect(kalla).toContain("from './karnanrop.js'");
  });

  it('E2 HTTP 400 återges som i dag, inte som ett nätverksfel', async () => {
    lage = '400';
    const svar = await mcp.anropa('tools/call', { name: 'create_receipt', arguments: {} });
    const { isError, text } = verktygssvar(svar);
    expect(isError, JSON.stringify(svar)).toBe(true);
    expect(text, JSON.stringify(svar)).toBe('Fel (HTTP 400): {"error":"validation_error"}');
    expect(text, JSON.stringify(svar)).not.toContain('Kunde inte nå kärnan');
  });

  it('E3 HTTP 409 återges som i dag, inte som ett nätverksfel', async () => {
    lage = '409';
    const svar = await mcp.anropa('tools/call', { name: 'create_receipt', arguments: {} });
    const { isError, text } = verktygssvar(svar);
    expect(isError, JSON.stringify(svar)).toBe(true);
    expect(text, JSON.stringify(svar)).toBe('Fel (HTTP 409): {"error":"already_booked"}');
    expect(text, JSON.stringify(svar)).not.toContain('Kunde inte nå kärnan');
  });

  // Sist, eftersom stubben inte kan öppnas igen på samma port.
  it('E1 vägrad anslutning ger formen med adressen och ECONNREFUSED, under 5 s', async () => {
    await karna.stang();
    const start = performance.now();
    const svar = await mcp.anropa('tools/call', { name: 'create_receipt', arguments: {} });
    const ms = performance.now() - start;
    const { isError, text } = verktygssvar(svar);
    const borjan = `Kunde inte nå kärnan på ${karna.bas}/api/companies/${bolag}/actions/create_receipt: `;
    expect(isError, JSON.stringify(svar)).toBe(true);
    expect(text.startsWith(borjan), `${text} börjar inte med ${borjan}`).toBe(true);
    expect(text.endsWith(' — kör self_check'), text).toBe(true);
    expect(text, text).toContain('ECONNREFUSED');
    expect(ms, text).toBeLessThan(5_000);
  });
});
