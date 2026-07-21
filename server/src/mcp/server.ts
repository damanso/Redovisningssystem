// MCP-server (stdio) — den tunna transporten som gör Alternativ A i planen
// verklig: Cowork/claude.ai (eller en framtida Hermes-harness) pratar med
// bokföringskärnan som native, typade verktyg.
//
// Designprincip: den här processen är REN transport. Den har ingen databas-
// åtkomst och ingen egen behörighetslogik — den ringer det befintliga HTTP-
// action-API:t med ett agent-token, och ALLA regler (tenant via medlemskap/RLS,
// oföränderlighet, audit, mänskligt godkännande för känsliga actions) tvingas
// på servern precis som förut. Ett känsligt verktyg returnerar därför aldrig ett
// utfört resultat här — det hamnar i godkännandekön och en människa godkänner i
// webbvyn (Att göra).
//
// Konfiguration via env (MCP-klienten sätter dem i sin serverdefinition):
//   REDOVISNING_API_URL      bas-URL till API:t (default http://127.0.0.1:3000)
//   REDOVISNING_AGENT_TOKEN  agent-token (mintat av en ägare, låst till ett bolag)
//   REDOVISNING_COMPANY_ID   bolagets UUID som verktygen ska verka mot
//
// VIKTIGT: stdout är reserverat för MCP-protokollet — logga ALLTID till stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

interface ManifestEntry {
  name: string;
  title: string;
  sensitivity: 'read' | 'write' | 'sensitive';
  requires_approval: boolean;
  input_schema: Record<string, unknown>;
}

const API_URL = (process.env.REDOVISNING_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.REDOVISNING_AGENT_TOKEN;
const COMPANY_ID = process.env.REDOVISNING_COMPANY_ID;

function requireEnv(): void {
  const missing = [
    !TOKEN && 'REDOVISNING_AGENT_TOKEN',
    !COMPANY_ID && 'REDOVISNING_COMPANY_ID',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`[mcp] saknar obligatorisk env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const EXTRA_TOOLS = {
  list_pending_approvals: {
    name: 'list_pending_approvals',
    description:
      'Lista förslag som väntar på mänskligt godkännande i bolaget. Känsliga ' +
      'actions (bokföra, låsa period) utförs aldrig av AI:t direkt — de hamnar ' +
      'här tills en människa godkänner dem i webbvyn.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  self_check: {
    name: 'self_check',
    description:
      'Hälsokoll för MCP-anslutningen: är API:t nåbart, fungerar agent-token, ' +
      'och när går tokenet ut? Kör denna i början av en session för att flagga ' +
      'problem I FÖRVÄG i stället för att upptäcka dem mitt i en körning.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
} as const;

// K5: läser ut exp ur agent-tokenet (utan verifiering — servern verifierar;
// detta är bara transportens egen varningslampa).
function tokenExpiry(token: string | undefined): { expires_at: string; days_left: number } | null {
  try {
    const payload = JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString('utf8')) as { exp?: number };
    if (!payload.exp) return null;
    const expiresAt = new Date(payload.exp * 1000);
    return {
      expires_at: expiresAt.toISOString(),
      days_left: Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    };
  } catch {
    return null;
  }
}

async function selfCheck(): Promise<Record<string, unknown>> {
  const expiry = tokenExpiry(TOKEN);
  let apiReachable = false;
  let apiStatus: string | number = 'unreachable';
  let tokenValid = false;
  try {
    const health = await fetch(`${API_URL}/health`);
    apiReachable = health.ok;
    apiStatus = health.status;
  } catch (err) {
    apiStatus = err instanceof Error ? err.message : String(err);
  }
  try {
    const { status } = await api(`/api/companies/${COMPANY_ID}/actions`);
    tokenValid = status === 200;
  } catch {
    tokenValid = false;
  }
  const warnings: string[] = [];
  if (!apiReachable) warnings.push(`API:t på ${API_URL} svarar inte — är servern igång?`);
  if (apiReachable && !tokenValid) warnings.push('agent-tokenet avvisas — förnya med `npm run mcp:token`.');
  if (expiry && expiry.days_left <= 14) {
    warnings.push(`agent-tokenet går ut ${expiry.expires_at.slice(0, 10)} (${expiry.days_left} dagar kvar) — förnya med \`npm run mcp:token\`.`);
  }
  return {
    api_url: API_URL,
    api_reachable: apiReachable,
    api_status: apiStatus,
    company_id: COMPANY_ID,
    token_valid: tokenValid,
    token_expires_at: expiry?.expires_at ?? null,
    token_days_left: expiry?.days_left ?? null,
    warnings,
    ok: apiReachable && tokenValid && (expiry === null || expiry.days_left > 0),
  };
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function fetchManifest(): Promise<ManifestEntry[]> {
  const { status, body } = await api(`/api/companies/${COMPANY_ID}/actions`);
  if (status !== 200 || !body || typeof body !== 'object' || !('actions' in body)) {
    throw new Error(`kunde inte hämta action-manifestet (HTTP ${status}): ${JSON.stringify(body)}`);
  }
  return (body as { actions: ManifestEntry[] }).actions;
}

function toolFor(a: ManifestEntry): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const tag = a.requires_approval
    ? ' ⚠ Känslig: utförs inte direkt — skapar ett förslag som en människa måste godkänna i webbvyn.'
    : '';
  return { name: a.name, description: `${a.title}.${tag}`, inputSchema: a.input_schema };
}

function textResult(text: string, isError = false): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

async function main(): Promise<void> {
  requireEnv();
  const manifest = await fetchManifest();
  const byName = new Map(manifest.map((a) => [a.name, a] as const));

  const server = new Server(
    { name: 'redovisning', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...manifest.map(toolFor), EXTRA_TOOLS.list_pending_approvals, EXTRA_TOOLS.self_check],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === 'self_check') {
        return textResult(JSON.stringify(await selfCheck(), null, 2));
      }
      if (name === 'list_pending_approvals') {
        const { status, body } = await api(`/api/companies/${COMPANY_ID}/approvals?status=pending`);
        if (status >= 400) return textResult(`Fel (HTTP ${status}): ${JSON.stringify(body)}`, true);
        return textResult(JSON.stringify(body, null, 2));
      }
      if (!byName.has(name)) return textResult(`Okänt verktyg: ${name}`, true);

      const { status, body } = await api(`/api/companies/${COMPANY_ID}/actions/${name}`, {
        method: 'POST',
        body: JSON.stringify(args),
      });

      // Känslig action → 202 pending_approval. Aldrig utförd av AI:t.
      if (status === 202 && body && typeof body === 'object' && 'approval' in body) {
        const approval = (body as { approval: { id: string } }).approval;
        // K4: beroendehint (t.ex. "fakturan är inte bokförd — godkänn book_invoice
        // först") följer med direkt så agenten kan köa i rätt ordning.
        const dep = (body as { dependency?: { satisfied: boolean; message: string } }).dependency;
        const depHint = dep && !dep.satisfied ? `\n⚠ Beroende: ${dep.message}` : '';
        return textResult(
          `⏳ Kräver mänskligt godkännande. Ett förslag har lagts i godkännandekön ` +
            `(id ${approval.id}). En människa godkänner det i webbvyn under "Att göra" ` +
            `innan det utförs. Ingenting har bokförts ännu.${depHint}`,
        );
      }
      if (status >= 400) {
        return textResult(`Fel (HTTP ${status}): ${JSON.stringify(body)}`, true);
      }
      return textResult(JSON.stringify(body, null, 2));
    } catch (err) {
      return textResult(`Kunde inte nå kärnan: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });

  await server.connect(new StdioServerTransport());
  console.error(`[mcp] redovisning MCP-server igång · ${manifest.length} actions · bolag ${COMPANY_ID}`);
  // K5: flagga tokenutgång redan vid start — inte mitt i en körning.
  const expiry = tokenExpiry(TOKEN);
  if (expiry && expiry.days_left <= 14) {
    console.error(`[mcp] VARNING: agent-tokenet går ut ${expiry.expires_at.slice(0, 10)} (${expiry.days_left} dagar kvar) — förnya med \`npm run mcp:token\`.`);
  }
}

main().catch((err) => {
  console.error('[mcp] fatalt fel:', err);
  process.exit(1);
});
