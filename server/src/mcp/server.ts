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
} as const;

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
    tools: [...manifest.map(toolFor), EXTRA_TOOLS.list_pending_approvals],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === 'list_pending_approvals') {
        const { body } = await api(`/api/companies/${COMPANY_ID}/approvals?status=pending`);
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
        return textResult(
          `⏳ Kräver mänskligt godkännande. Ett förslag har lagts i godkännandekön ` +
            `(id ${approval.id}). En människa godkänner det i webbvyn under "Att göra" ` +
            `innan det utförs. Ingenting har bokförts ännu.`,
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
}

main().catch((err) => {
  console.error('[mcp] fatalt fel:', err);
  process.exit(1);
});
